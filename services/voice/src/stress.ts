import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, endpointing, repoRoot } from './config.ts';
import { loadScript } from './script.ts';
import { preflight, report } from './preflight.ts';
import { checkReachable } from './reachability.ts';
import { completed, expectCall, start } from './server.ts';
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
  const publicUrl = config.wsPublicUrl();
  const to = config.numbers.stressTarget();
  const from = config.numbers.from();

  const server = start();
  const key = randomUUID();
  expectCall(key, { callNumber: 2, lastCommitment: 'run three times', language: config.language });

  const streamUrl = `${publicUrl}/media?key=${key}`;
  console.log(`\nCalling ${maskTail(to)} from ${maskTail(from)}`);
  console.log(`Media stream → ${streamUrl.replace(key, '…')}\n`);

  // Prove the carrier can reach us BEFORE spending a call. A stale tunnel
  // hostname produces a connected call that sits in silence, and from the
  // phone that is indistinguishable from a broken voice session.
  process.stdout.write('Checking the carrier can reach this service… ');
  const reach = await checkReachable();
  if (!reach.ok) {
    console.log('no.\n');
    console.log(`  ✕ ${reach.detail}\n`);
    console.log('  Nothing was dialled. Fix that and run again.\n');
    rl.close();
    server.close();
    process.exit(1);
  }
  console.log('yes.\n');

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
    console.log('  No objective metrics captured — the call did not reach the media socket.');
  }

  rl.close();
  server.close();
  process.exit(0);
}

function maskTail(n: string): string {
  return n.length <= 4 ? '****' : `${'*'.repeat(n.length - 4)}${n.slice(-4)}`;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
