import { WebSocket } from 'ws';
import { config } from './config.ts';

/**
 * Can the outside world reach this service?
 *
 * A carrier that cannot reach our media socket produces a call that connects
 * and then sits in silence — indistinguishable, from the phone, from a broken
 * voice model or a bad model id. The commonest cause is mundane: a tunnel
 * hostname changes on every restart, and the stale one stays in .env.
 *
 * Checked before dialling, so a wrong hostname costs a second rather than a
 * phone call.
 */
export interface Reachability {
  ok: boolean;
  step: 'http' | 'websocket' | 'done';
  detail: string;
}

export async function checkReachable(timeoutMs = 10_000): Promise<Reachability> {
  const wss = config.wsPublicUrl().replace(/\/+$/, '');
  const https = wss.replace(/^wss:/, 'https:');

  try {
    const res = await fetch(`${https}/`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    if (!res.ok || !body.includes('"ok"')) {
      return {
        ok: false,
        step: 'http',
        detail: `${https} answered ${res.status}, but not with our service. Something else is on that hostname, or the tunnel points at the wrong port.`,
      };
    }
  } catch {
    return {
      ok: false,
      step: 'http',
      detail: `Nothing answered at ${https}. The tunnel is not running, or the hostname is stale — it changes on every restart.`,
    };
  }

  return new Promise<Reachability>((resolve) => {
    const ws = new WebSocket(`${wss}/media?key=selftest`);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, step: 'websocket', detail: 'HTTP works but the websocket upgrade never completed. Something in the path is refusing to upgrade.' });
    }, timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close(1000);
      resolve({ ok: true, step: 'done', detail: 'A carrier can reach this service.' });
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, step: 'websocket', detail: `Websocket failed: ${e.message}. Check the URL starts wss:// and has no path or trailing slash.` });
    });
  });
}

/**
 * Poll until reachable, or give up.
 *
 * A freshly created quick tunnel prints its URL before the edge routes to it —
 * cloudflared's own banner says "it may take some time to be reachable". A
 * single immediate check therefore always fails, which is worse than no check
 * at all because it blames the hostname.
 */
export async function waitReachable(
  opts: { attempts?: number; delayMs?: number; onAttempt?: (n: number, total: number) => void } = {},
): Promise<Reachability> {
  const attempts = opts.attempts ?? 12;
  const delayMs = opts.delayMs ?? 3000;
  let last: Reachability = { ok: false, step: 'http', detail: 'not checked' };

  for (let i = 1; i <= attempts; i++) {
    opts.onAttempt?.(i, attempts);
    last = await checkReachable(5000);
    if (last.ok) return last;
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}
