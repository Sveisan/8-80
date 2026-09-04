import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, endpointing, repoRoot } from './config.ts';
import { loadScript } from './script.ts';
import { preflight, report } from './preflight.ts';
import { checkReachable, waitReachable } from './reachability.ts';
import { startTunnel, type Tunnel } from './tunnel.ts';
import { completed, expectCall, lastCall, start } from './server.ts';
import { telephonyProvider } from './adapters/telephony/index.ts';

/**
 * The 8-turn stress test, as a repeatable command rather than a one-off script.
 * Run it again after every endpointing change; the scores are the baseline for
 * tuning and the comparison if the voice stack is ever swapped.
 *
 *   npm run stress
 */
const TURNS = [
  { n: 1, weight: 'decides it', do: 'Start a sentence, then pause for 3 seconds mid-sentence, then finish it.' },
  { n: 2, weight: 'decides it', do: 'Start a sentence, then pause for a full 5 seconds mid-sentence, then finish it.' },
  { n: 3, weight: 'secondary', do: 'Correct yourself: "I did it Tuesday — no wait, Wednesday."' },
  { n: 4, weight: 'secondary', do: 'Say "mhm" while the agent is speaking. It must NOT be treated as an interruption.' },
  { n: 5, weight: 'secondary', do: 'Interrupt it deliberately, mid-sentence.' },
  { n: 6, weight: 'secondary', do: 'Say something quietly difficult. Does the tone shift, or does the script march on?' },
  { n: 7, weight: 'decides it', do: 'Answer a question with one word, then stay silent. Does it fill the silence, or wait?' },
  { n: 8, weight: 'secondary', do: 'Go off on a tangent that goes nowhere. Can it steer back without being rude?' },
];

const SCORES = [
  ['naturalness', 'Voice naturalness'],
  ['latencyFeel', 'Latency feel'],
  ['didItInterrupt', 'Did it interrupt me (5 = never)'],
  ['handledPauses', 'Did it handle my pauses (5 = perfectly)'],
  ['wouldWantWeekly', 'Would I want this call weekly'],
] as const;

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let tunnel: Tunnel | undefined;
  const ep = endpointing();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  // Always the repo root, so runs collect in one place however it was invoked.
  const dir = resolve(repoRoot, 'runs');

  console.log('\n8&80 stress test');
  console.log('─'.repeat(64));
  console.log(`turn-taking:  ${config.turnTaking}${config.turnTaking === 'local' ? ' (ours — provider VAD disabled)' : ' (provider server_vad — debug only)'}`);
  console.log(`sensitivity:  ${ep.sensitivity}  →  base ${ep.baseSilenceMs}ms · trailing ${ep.trailingClauseMs}ms · short-answer ${ep.shortAnswerMs}ms · max ${ep.maxWaitMs}ms`);
  console.log(`variants:     ${config.variants.nothing} · ${config.variants.nextAsk} · ${config.variants.closeQ}`);
  console.log('─'.repeat(64));
  console.log('\nThe 8 turns to perform. 1, 2 and 7 are the ones that decide this:\n');
  for (const t of TURNS) {
    console.log(`  ${t.n}. ${t.weight === 'decides it' ? '★' : ' '} ${t.do}`);
  }

  console.log('\nPreflight\n');
  if (!report(preflight())) {
    rl.close();
    process.exit(1);
  }

  const script = loadScript();
  console.log(`\nSCRIPT.md: ${script.size} keyed lines loaded.`);

  // Resolve every required setting before opening a socket or dialling anyone.
  // VOICE_WS_PUBLIC_URL is read again after the reachability step, since a
  // freshly started tunnel replaces it.
  const to = config.numbers.stressTarget();
  const from = config.numbers.from();

  const server = start();

  // Prove the carrier can reach us BEFORE spending a call. A stale tunnel
  // hostname produces a connected call that sits in silence, and from the
  // phone that is indistinguishable from a broken voice session.
  process.stdout.write('Checking the carrier can reach this service… ');
  let reach = await checkReachable();

  // Quick tunnels change hostname on every restart and die when the window
  // closes, so a stale one in .env is the normal state of affairs rather than
  // a mistake. Start a fresh one and carry on.
  if (!reach.ok && reach.step === 'http') {
    console.log('no.');
    console.log('  The public hostname is not answering. Starting a fresh tunnel…');
    try {
      tunnel = await startTunnel(config.port);
      process.env['VOICE_WS_PUBLIC_URL'] = tunnel.url.replace(/^https:/, 'wss:');
      console.log(`  Tunnel up: ${tunnel.url}`);
      // The URL is printed before the edge routes to it. Wait for it.
      process.stdout.write('  Waiting for it to become reachable');
      reach = await waitReachable({ onAttempt: () => process.stdout.write('.') });
      console.log('');
      process.stdout.write('  ');
    } catch (e) {
      console.log(`  Could not start one: ${e instanceof Error ? e.message : String(e)}`);
      console.log('  Install it with `brew install cloudflared`, or set a reachable');
      console.log('  VOICE_WS_PUBLIC_URL yourself.\n');
    }
  }

  if (!reach.ok) {
    console.log('no.\n');
    console.log(`  ✕ ${reach.detail}\n`);
    console.log('  Nothing was dialled.\n');
    tunnel?.stop();
    rl.close();
    server.close();
    process.exit(1);
  }
  console.log('yes.\n');

  const key = randomUUID();
  expectCall(key, { callNumber: 2, lastCommitment: 'run three times', language: config.language });
  const streamUrl = `${config.wsPublicUrl().replace(/\/+$/, '')}/media?key=${key}`;
  console.log(`Calling ${maskTail(to)} from ${maskTail(from)}`);
  console.log(`Media stream → ${streamUrl.replace(key, '…')}\n`);

  lastCall.reset();
  const telephony = telephonyProvider();
  const call = await telephony.placeCall({
    to,
    from,
    ringSeconds: config.ringSeconds,
    streamUrl,
  });

  console.log('Ringing. Answer, run the 8 turns, then hang up.\n');
  await rl.question('Press Enter once the call has ended… ');

  const metrics = completed.last;

  console.log('\nScores, 1-5.\n');
  const scores: Record<string, number> = {};
  for (const [key_, label] of SCORES) {
    const a = await rl.question(`  ${label}: `);
    scores[key_] = Number(a.trim());
  }
  const notes = await rl.question('\n  Anything that stood out (free text): ');

  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `stress-${runId}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        runId,
        endpointing: ep,
        turnTaking: config.turnTaking,
        variants: config.variants,
        callId: call.id ? 'placed' : 'unknown',
        scores,
        notes,
        objective: metrics?.summary() ?? null,
        turns: metrics?.turns ?? [],
      },
      null,
      2,
    ),
  );

  if (metrics?.trace) {
    const tracePath = resolve(dir, `trace-${runId}.json`);
    writeFileSync(
      tracePath,
      JSON.stringify(
        {
          id: `real-${runId}`,
          description: 'Recorded from a real call. Timing only — no words, no audio.',
          durationMs: metrics.trace.durationMs,
          sensitivity: metrics.trace.sensitivity,
          suspectedCutsAtMs: metrics.trace.suspectedCutsAtMs,
          segments: metrics.trace.segments,
          trueEndMs: null,
          labelled: false,
          note: 'Set trueEndMs to when you actually finished speaking, then move this into test/fixtures/ to make it a regression test.',
        },
        null,
        2,
      ),
    );
    console.log(`Saved ${tracePath}  (${metrics.trace.segments.length} segments, ${metrics.trace.suspectedCutsAtMs.length} suspected cuts)`);
  }

  console.log(`\nSaved ${path}`);
  if (metrics) {
    const s = metrics.summary();
    console.log(`  time-to-first-audio   ${s['timeToFirstAudioMs'] ?? '—'} ms`);
    console.log(`  median endpoint wait  ${s['medianEndpointLatencyMs'] ?? '—'} ms`);
    console.log(`  false interruptions   ${s['falseInterruptions']}`);
    console.log(`  backchannels ignored  ${s['backchannelsIgnored']}  (turn 4 should raise this, not bargeIns)`);
    console.log(`  cost                  ${JSON.stringify(s['cost'])}`);
  } else {
    console.log(diagnose());
  }

  rl.close();
  tunnel?.stop();
  server.close();
  process.exit(0);
}

/**
 * A silent call has several causes and they feel identical on the phone. Say
 * which one it was, in words, rather than leaving it in a JSON log nobody reads.
 */
function diagnose(): string {
  const m = completed.last;

  if (!lastCall.mediaConnected) {
    return [
      '',
      '  Diagnosis: the carrier never opened the media stream.',
      '',
      '  Reachability passed before dialling, so the tunnel was alive then.',
      '  Most likely: you answered before the stream started, the tunnel died',
      '  mid-call, or Twilio rejected the stream. Twilio console →',
      '  Monitor → Logs → Calls → this call shows its own error.',
      lastCall.error ? `\n  The service also reported: ${lastCall.error}` : '',
    ].join('\n');
  }

  if (m?.voiceError) {
    return [
      '',
      '  Diagnosis: audio reached us, but the voice provider rejected the session.',
      `\n  It said: ${m.voiceError}`,
      '',
      '  Usually the model id or the voice name. Try XAI_VOICE_MODEL and',
      '  XAI_VOICE_NAME against what the xAI console actually lists —',
      '  both are config, no code change. See docs/VERIFY.md.',
    ].join('\n');
  }

  if (m && !m.voiceReady) {
    return [
      '',
      '  Diagnosis: audio reached us and the provider raised no error, but it',
      '  never produced any speech.',
      '',
      '  Suspect the model id first — an unknown model can open a socket and',
      '  then simply never answer. XAI_VOICE_MODEL is config, not code.',
    ].join('\n');
  }

  return '  No objective metrics captured.';
}

function maskTail(n: string): string {
  return n.length <= 4 ? '****' : `${'*'.repeat(n.length - 4)}${n.slice(-4)}`;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
