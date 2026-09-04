import { config } from './config.ts';
import { waitReachable } from './reachability.ts';
import { start } from './server.ts';

/**
 * npm run checkurl
 *
 * Proves the public path in seconds, without dialling anyone.
 */
console.log(`\nChecking ${config.wsPublicUrl()}\n`);
const server = start();
await new Promise((r) => setTimeout(r, 300));

process.stdout.write('  Probing');
const r = await waitReachable({ attempts: 8, onAttempt: () => process.stdout.write('.') });
console.log('');
if (r.ok) {
  console.log('  · HTTP reaches the service');
  console.log('  · WebSocket upgrade succeeds');
  console.log('  · Round trip confirmed — a carrier can reach us\n');
  console.log('  If a call still goes silent, the fault is past the transport:');
  console.log('  the voice provider session, not the tunnel.\n');
} else {
  console.log(`  ✕ ${r.step === 'http' ? 'HTTP' : 'WebSocket'} check failed\n      ${r.detail}\n`);
}

server.close();
process.exit(r.ok ? 0 : 1);
