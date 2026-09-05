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

type Verdict = { voice: string; ok: boolean; detail: string };

async function probe(voice: string): Promise<Verdict> {
  const url = `${config.xai.url}?model=${encodeURIComponent(config.xai.model)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.xai.apiKey()}` } });

  return await new Promise<Verdict>((resolve) => {
    const done = (v: Verdict) => {
      clearTimeout(timer);
      ws.close();
      resolve(v);
    };
    const timer = setTimeout(() => done({ voice, ok: false, detail: 'no answer within 8s' }), 8000);

    ws.once('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { voice } })));
    ws.on('unexpected-response', (_req, res) => done({ voice, ok: false, detail: `HTTP ${res.statusCode}` }));
    ws.on('error', (e) => done({ voice, ok: false, detail: e instanceof Error ? e.message : String(e) }));
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
        done({ voice, ok: false, detail: message.slice(0, 120) });
        return;
      }
      if (type !== 'session.updated') return;
      const session = ev['session'] as Record<string, unknown> | undefined;
      const echoed = String(session?.['voice'] ?? (session?.['audio'] as { output?: { voice?: unknown } } | undefined)?.output?.voice ?? '');
      // A server that silently falls back to its default has not accepted ours.
      done(
        echoed.toLowerCase() === voice.toLowerCase()
          ? { voice, ok: true, detail: 'accepted' }
          : { voice, ok: false, detail: echoed ? `fell back to "${echoed}"` : 'not echoed — cannot tell' },
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

  const ok = results.filter((r) => r.ok).map((r) => r.voice);
  console.log(
    ok.length
      ? `\nUsable: ${ok.join(', ')}\nSet one with XAI_VOICE_NAME in .env, then run npm run stress.\n`
      : '\nNone accepted. Either the names are all wrong, or this model exposes one fixed voice.\n',
  );
  process.exit(0);
}

void main();
