import { WebSocket } from 'ws';
import { config } from './config.ts';
import { start } from './server.ts';

/**
 * npm run checkurl
 *
 * Answers one question: can the outside world reach this service?
 *
 * A call that connects and then sits in silence has several possible causes —
 * a dead tunnel, a wrong hostname, a scheme mistake, a websocket upgrade the
 * proxy will not pass. This distinguishes them in ten seconds, for free,
 * instead of one phone call per hypothesis.
 */
const wss = config.wsPublicUrl().replace(/\/+$/, '');
const https = wss.replace(/^wss:/, 'https:');

console.log(`\nChecking ${wss}\n`);
const server = start();

const fail = (msg: string, hint: string) => {
  console.log(`  ✕ ${msg}\n      ${hint}\n`);
  server.close();
  process.exit(1);
};

await new Promise((r) => setTimeout(r, 300));

// 1. HTTP through the tunnel to our server.
try {
  const res = await fetch(`${https}/`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.text();
  if (!res.ok || !body.includes('"ok"')) {
    fail(
      `HTTP reached ${https} but the reply was not ours (${res.status})`,
      'Something else is serving that hostname, or the tunnel points at the wrong port.',
    );
  }
  console.log('  · HTTP reaches the service');
} catch {
  fail(
    `HTTP could not reach ${https}`,
    'The tunnel is not running, the hostname is stale (it changes on every restart), or it points at a different port than VOICE_SERVICE_PORT.',
  );
}

// 2. The websocket upgrade — what the carrier actually needs.
await new Promise<void>((resolve) => {
  const ws = new WebSocket(`${wss}/media?key=selftest`);
  const timer = setTimeout(
    () => fail('The websocket did not open within 10s', 'The path is reachable over HTTP but the upgrade is being blocked or dropped.'),
    10_000,
  );
  ws.on('open', () => {
    clearTimeout(timer);
    console.log('  · WebSocket upgrade succeeds');
  });
  ws.on('message', (m) => {
    if (String(m).includes('selftest')) console.log('  · Round trip confirmed — a carrier can reach us\n');
  });
  ws.on('close', () => {
    clearTimeout(timer);
    resolve();
  });
  ws.on('error', (e) => {
    clearTimeout(timer);
    fail(`WebSocket failed: ${e.message}`, 'HTTP works but the upgrade does not. Check the URL uses wss:// and has no path or trailing slash.');
  });
});

console.log('  Reachability is fine. If a call still goes silent, the problem is');
console.log('  after this point — the voice provider session, not the transport.\n');
server.close();
process.exit(0);
