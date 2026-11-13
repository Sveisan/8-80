import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { repoRoot } from '../config.ts';

const files = new Map<string, { file: string; type: string; immutable?: boolean }>([
  ['/fonts/fraunces-latin-v1.woff2', { file: 'fonts/fraunces-latin-v1.woff2', type: 'font/woff2', immutable: true }],
  ['/fonts/bricolage-grotesque-latin-v1.woff2', { file: 'fonts/bricolage-grotesque-latin-v1.woff2', type: 'font/woff2', immutable: true }],
  ['/favicon.svg', { file: 'assets/favicon.svg', type: 'image/svg+xml' }],
  ['/favicon.ico', { file: 'assets/favicon.ico', type: 'image/x-icon' }],
  ['/apple-touch-icon.png', { file: 'assets/apple-touch-icon.png', type: 'image/png' }],
  ['/site.webmanifest', { file: 'assets/site.webmanifest', type: 'application/manifest+json' }],
  ['/brand/site.webmanifest', { file: 'assets/site.webmanifest', type: 'application/manifest+json' }],
  ...['lockup-light.svg', 'lockup-dark.svg', 'lockup-on-gold.svg', 'app-icon.svg', 'favicon.svg'].map(file => [`/brand/${file}`, { file: `assets/${file}`, type: 'image/svg+xml' }] as const),
  ...['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map(file => [`/brand/${file}`, { file: `assets/${file}`, type: 'image/png' }] as const),
]);
const cache = new Map<string, Buffer>();

/** Exact allowlist; request paths can never become filesystem paths. */
export function serveDesignAsset(path: string, res: ServerResponse, head = false): boolean {
  const asset = files.get(path);
  if (!asset) return false;
  let bytes = cache.get(asset.file);
  if (!bytes) { bytes = readFileSync(resolve(repoRoot, 'brand', asset.file)); cache.set(asset.file, bytes); }
  res.writeHead(200, {
    'content-type': asset.type, 'content-length': bytes.length,
    'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600, must-revalidate',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  });
  res.end(head ? undefined : bytes);
  return true;
}
