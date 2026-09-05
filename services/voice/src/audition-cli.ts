import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { config, repoRoot } from './config.ts';
import { loadScript } from './script.ts';
import { mulawToWav } from './audio/wav.ts';

/**
 * Hear each voice before deciding, without spending a phone call on it.
 *
 *   npm run audition               — the candidate names
 *   npm run audition -- ara rex    — specific ones
 *
 * Each voice says the opening line from SCRIPT.md, recorded at telephone
 * bandwidth because that is the only bandwidth this product has. The files
 * land in runs/ as .wav — play them, pick one, set XAI_VOICE_NAME.
 *
 * This is also the honest test of whether the voice parameter does anything at
 * all: the probe in voices-cli can only read what the server echoes back, and
 * this server echoes no voice. Audio does not lie.
 */
const CANDIDATES = ['eve', 'ara', 'rex', 'sal', 'leo'];

async function say(voice: string, line: string): Promise<Buffer> {
  const url = `${config.xai.url}?model=${encodeURIComponent(config.xai.model)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.xai.apiKey()}` } });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve_, reject) => {
    const finish = () => {
      clearTimeout(timer);
      ws.close();
      resolve_(Buffer.concat(chunks));
    };
    const timer = setTimeout(finish, 20_000);

    ws.once('open', () =>
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            voice,
            instructions: `Say exactly this, once, and nothing else: "${line}"`,
            turn_detection: null,
            audio: { output: { format: { type: 'audio/pcmu', rate: 8000 } } },
            output_audio_format: 'g711_ulaw',
          },
        }),
      ),
    );
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`HTTP ${res.statusCode}`));
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
    ws.on('message', (raw) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(ev['type'] ?? '');
      if (type === 'session.updated') {
        ws.send(JSON.stringify({ type: 'response.create' }));
        return;
      }
      if (type === 'error') {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(ev['error'] ?? ev).slice(0, 200)));
        return;
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        const d = ev['delta'];
        if (typeof d === 'string') chunks.push(Buffer.from(d, 'base64'));
        return;
      }
      if (type === 'response.done' || type === 'response.output_audio.done' || type === 'response.audio.done') finish();
    });
  });
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = wanted.length ? wanted : CANDIDATES;
  const line = loadScript().get('open.first.greet') ?? 'Hi — this is the 8 and 80 call.';
  const dir = resolve(repoRoot, 'runs', 'voices');
  mkdirSync(dir, { recursive: true });

  console.log(`\nAuditioning ${list.length} voices on ${config.xai.model}.`);
  console.log(`Each says: "${line}"\n`);

  for (const voice of list) {
    process.stdout.write(`  ${voice.padEnd(10)} `);
    try {
      const mulaw = await say(voice, line);
      if (mulaw.length === 0) {
        console.log('· no audio');
        continue;
      }
      const file = resolve(dir, `${voice}.wav`);
      writeFileSync(file, mulawToWav(mulaw));
      console.log(`✓ ${(mulaw.length / 8000).toFixed(1)}s  →  runs/voices/${voice}.wav`);
    } catch (e) {
      console.log(`· ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n  open ${resolve(dir)}\n`);
  console.log('Play them. If they are all the same person, this model has one voice and the');
  console.log('name is decoration. If not, set XAI_VOICE_NAME in .env to the one you want.\n');
  process.exit(0);
}

void main();
