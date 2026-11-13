import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { themes } from '../src/design-system/tokens.ts';
import { serveDesignAsset } from '../src/design-system/assets.ts';
import { pageHeaders } from '../src/beliefs/http.ts';
import { button, field } from '../src/design-system/components.ts';

const luminance = (hex: string): number => {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
};
const contrast = (a: string, b: string): number => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

test('both themes keep text, error messages, controls and focus readable on every surface', () => {
  for (const [name, theme] of Object.entries(themes)) {
    for (const background of ['bg', 'card'] as const) {
      for (const role of ['ink', 'quiet', 'link', 'bad'] as const) {
        assert.ok(contrast(theme[role], theme[background]) >= 4.5, `${name}: ${role} on ${background} needs 4.5:1`);
      }
      for (const role of ['control-border', 'accent'] as const) {
        assert.ok(contrast(theme[role], theme[background]) >= 3, `${name}: ${role} on ${background} needs 3:1`);
      }
    }
    assert.ok(contrast(theme['on-accent'], theme.accent) >= 4.5, `${name}: button and selected radio text`);
    assert.ok(contrast(theme.bad, theme['bad-bg']) >= 4.5, `${name}: error notice text`);
  }
});

test('local identity assets have valid formats, cache rules, HEAD support and an exact path allowlist', async () => {
  const server = createServer((req, res) => {
    if (serveDesignAsset(req.url ?? '', res, req.method === 'HEAD')) return;
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const file of ['fraunces', 'bricolage-grotesque']) {
      const url = `${base}/fonts/${file}-latin-v1.woff2`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'font/woff2');
      assert.match(response.headers.get('cache-control')!, /immutable/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'wOF2');
      assert.equal(Number(response.headers.get('content-length')), bytes.length);
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    for (const path of ['/fonts/unknown.woff2', '/fonts/%2e%2e%2f.env', '/fonts/Fraunces-OFL.txt']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const manifestResponse = await fetch(`${base}/brand/site.webmanifest`);
    assert.equal(manifestResponse.headers.get('content-type'), 'application/manifest+json');
    const manifest = await manifestResponse.json() as { icons: { src: string; sizes: string; purpose: string }[] };
    assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
    for (const icon of manifest.icons) {
      const response = await fetch(new URL(icon.src, `${base}/brand/site.webmanifest`));
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
      assert.doesNotMatch(response.headers.get('cache-control')!, /immutable/);
    }
    const touch = Buffer.from(await (await fetch(`${base}/apple-touch-icon.png`)).arrayBuffer());
    assert.equal(touch.readUInt32BE(16), 180);
    assert.equal(touch.readUInt32BE(20), 180);
    const ico = Buffer.from(await (await fetch(`${base}/favicon.ico`)).arrayBuffer());
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    assert.deepEqual([ico[6], ico[22], ico[38]], [16, 32, 48]);
    for (const variant of ['light', 'dark', 'on-gold']) {
      const response = await fetch(`${base}/brand/lockup-${variant}.svg`);
      assert.equal(response.headers.get('content-type'), 'image/svg+xml');
      const text = await response.text();
      assert.match(text, /<path/);
      assert.doesNotMatch(text, /<text|font-family|https?:\/\/[^" ]+\.(woff|ttf)/);
    }
    const head = await fetch(`${base}/favicon.svg`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(`${base}/brand/wordmark-outline.json`)).status, 404);
    assert.match(pageHeaders['content-security-policy'], /font-src 'self'/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('new field primitives preserve arbitrary user text and associate field errors', () => {
  const html = field({ id: 'email', label: 'Email', value: '"><script>alert(1)</script>', hint: 'For your recap.', error: 'Check the address.' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.match(html, /for="email"/);
  assert.match(html, /aria-describedby="email-hint email-error"/);
  assert.match(html, /aria-invalid="true"/);
  const loading = button('Save <changes>', { loading: true });
  assert.ok(loading.includes('Save &lt;changes&gt;'));
  assert.match(loading, /disabled aria-busy="true"/);
});
