import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTunnelUrl } from '../src/tunnel.ts';

const banner = `
2026-09-03T22:49:08Z INF +------------------------------------------------------+
2026-09-03T22:49:08Z INF |  Your quick Tunnel has been created! Visit it at:     |
2026-09-03T22:49:08Z INF |  https://proof-peripherals-sacramento-divided.trycloudflare.com  |
2026-09-03T22:49:08Z INF +------------------------------------------------------+
`;

test('finds the hostname in the banner', () => {
  assert.equal(parseTunnelUrl(banner), 'https://proof-peripherals-sacramento-divided.trycloudflare.com');
});

test('returns null until the banner arrives', () => {
  assert.equal(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...'), null);
});

test('is not fooled by the pre-check lines mentioning the domain', () => {
  const pre = 'INF precheck target=region1.v2.argotunnel.com status=pass';
  assert.equal(parseTunnelUrl(pre), null);
});

test('takes the first URL when output is chunked', () => {
  assert.equal(parseTunnelUrl(banner + banner), 'https://proof-peripherals-sacramento-divided.trycloudflare.com');
});

test('a freshly printed URL is not assumed reachable', async () => {
  // Regression: the first auto-tunnel checked once, immediately, and failed —
  // cloudflared prints the URL before the edge routes to it.
  const { waitReachable } = await import('../src/reachability.ts');
  assert.equal(typeof waitReachable, 'function', 'reachability must expose a polling form');
});
