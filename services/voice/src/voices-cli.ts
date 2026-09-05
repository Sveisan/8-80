import { WebSocket } from 'ws';
import { config } from './config.ts';

/**
 * Which voice names this account can actually use.
 *
 *   npm run voices              — probe the known candidates
 *   npm run voices -- ara rex   — probe specific ones
 *
 * /v1/models does not list voice models, let alone voices, so the only honest
 * source is the server itself: ask for a voice and see whether the session it
 * echoes back is the one we asked for. Costs no phone call and no audio.
 */
const CANDIDATES = ['eve', 'ara', 'rex', 'sal', 'leo'];

type Verdict = { voice: string; ok: boolean; rejected: boolean; detail: string };

/**
 * A name no server could have. If this one is not rejected either, the server
 * is not validating the field and "no error" proves nothing — which is the
 * difference between a probe and a placebo.
 */
const CONTROL = 'definitely-not-a-voice-8and80';

async function probe(voice: string): Promise<Verdict> {
  const url = `${config.xai.url}?model=${encodeURIComponent(config.xai.model)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.xai.apiKey()}` } });

  return await new Promise<Verdict>((resolve) => {
    const done = (v: Verdict) => {
      clearTimeout(timer);
      ws.close();
      resolve(v);
    };
    const timer = setTimeout(() => done({ voice, ok: false, rejected: false, detail: 'no answer within 8s' }), 8000);

    ws.once('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { voice } })));
    ws.on('unexpected-response', (_req, res) => done({ voice, ok: false, rejected: true, detail: `HTTP ${res.statusCode}` }));
    ws.on('error', (e) => done({ voice, ok: false, rejected: false, detail: e instanceof Error ? e.message : String(e) }));
    ws.on('message', (raw) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(ev['type'] ?? '');
      if (type === 'error') {
        const err = ev['error'];
        const message = typeof err === 'object' && err !== null ? String((err as Record<string, unknown>)['message'] ?? JSON.stringify(err)) : String(err);
        done({ voice, ok: false, rejected: true, detail: message.slice(0, 120) });
        return;
      }
      if (type !== 'session.updated') return;
      const session = ev['session'] as Record<string, unknown> | undefined;
      const echoed = String(session?.['voice'] ?? (session?.['audio'] as { output?: { voice?: unknown } } | undefined)?.output?.voice ?? '');
      // A server that silently falls back to its default has not accepted ours.
      done(
        echoed.toLowerCase() === voice.toLowerCase()
          ? { voice, ok: true, rejected: false, detail: 'accepted, and echoed back' }
          : echoed
            ? { voice, ok: false, rejected: true, detail: `fell back to "${echoed}"` }
            : { voice, ok: false, rejected: false, detail: 'no error, but the session echo carries no voice' },
      );
    });
  });
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = wanted.length ? wanted : CANDIDATES;

  console.log(`\nProbing ${list.length} voice names against ${config.xai.model}.`);
  console.log('The names come from the client libraries, not from vendor docs, so a');
  console.log('rejection here means "not this name", not "no such voice".\n');

  const results: Verdict[] = [];
  for (const v of list) {
    process.stdout.write(`  ${v.padEnd(10)} `);
    const r = await probe(v);
    results.push(r);
    console.log(r.ok ? '✓ accepted' : `· ${r.detail}`);
  }

  process.stdout.write(`\n  control    `);
  const control = await probe(CONTROL);
  console.log(control.rejected ? '✓ rejected, as it should be' : `· ${control.detail}`);

  const ok = results.filter((r) => r.ok).map((r) => r.voice);
  if (ok.length) {
    console.log(`\nUsable: ${ok.join(', ')}\nSet one with XAI_VOICE_NAME in .env, then run npm run stress.\n`);
  } else if (!control.rejected) {
    console.log('\nInconclusive, and now we know why: a name that cannot exist was not');
    console.log('rejected either, and the session echo carries no voice at all. This server');
    console.log('will not tell us. The only remaining test is the sound itself:\n');
    console.log('  npm run audition\n');
  } else {
    console.log('\nAll rejected while the control was too — these names are wrong. Try others:');
    console.log('  npm run voices -- name1 name2\n');
  }
  process.exit(0);
}

void main();
