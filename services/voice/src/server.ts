import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.ts';
import { log } from './log.ts';
import { loadScript } from './script.ts';
import { runCall } from './call/session.ts';
import { mediaBridge } from './adapters/telephony/index.ts';
import { GrokVoiceProvider } from './adapters/voice/grok.ts';
import type { CallerProfile } from './prompt.ts';
import type { CallMetrics } from './metrics.ts';

/**
 * The long-running voice service. It holds one websocket per active call for
 * the length of that call, which is why this cannot be serverless.
 *
 * This socket must NOT be proxied by Cloudflare — own subdomain, DNS-only.
 */
const pending = new Map<string, CallerProfile>();

/** Metrics from the most recently completed call, for the stress-test report. */
export const completed: { last: CallMetrics | null } = { last: null };

export function expectCall(key: string, profile: CallerProfile): void {
  pending.set(key, profile);
}

export function start(): { close: () => void; port: number } {
  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const wss = new WebSocketServer({ server: http, path: '/media' });

  wss.on('connection', (ws, req) => {
    const key = new URL(req.url ?? '/', 'http://x').searchParams.get('key') ?? '';
    const profile = pending.get(key) ?? { callNumber: 1 };
    pending.delete(key);
    log('media.connection', { known: pending.has(key) });

    void runCall({
      script: loadScript(),
      profile,
      media: mediaBridge(ws),
      voice: new GrokVoiceProvider(),
    })
      .then((m) => {
        completed.last = m;
      })
      .catch((e: unknown) => log('call.failed', { message: e instanceof Error ? e.message : String(e) }));
  });

  http.listen(config.port, () => log('voice.listening', { port: config.port }));
  return { close: () => http.close(), port: config.port };
}

if (import.meta.url === `file://${process.argv[1]}`) start();
