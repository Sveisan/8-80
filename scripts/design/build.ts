import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designGuide } from '../../services/voice/src/design-system/guide.ts';
import { FOUNDATION_CSS, CONTROL_CSS, LAYOUT_CSS } from '../../services/voice/src/design-system/styles.ts';
import { palette, space, themes, foundations, breakpoints } from '../../services/voice/src/design-system/tokens.ts';
import { brandAssets } from './brand-assets.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const localFonts = (value: string): string => value.replaceAll("url('/fonts/", "url('fonts/")
  .replaceAll('href="/favicon.', 'href="assets/favicon.').replaceAll('href="/apple-touch-icon.png"', 'href="assets/apple-touch-icon.png"').replaceAll('="/brand/', '="assets/');

export function outputs(): Map<string, Buffer> {
  const files = brandAssets(root);
  files.set('brand/design-system.html', Buffer.from(localFonts(designGuide())));
  files.set('brand/design-system.css', Buffer.from(localFonts(FOUNDATION_CSS + CONTROL_CSS + LAYOUT_CSS)));
  files.set('brand/design-tokens.json', Buffer.from(JSON.stringify({ palette, themes, space, foundations, breakpoints }, null, 2) + '\n'));
  const hashes = Object.fromEntries([...files].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
  files.set('brand/design-assets.json', Buffer.from(JSON.stringify(hashes, null, 2) + '\n'));
  return files;
}

export function build(check = false): void {
  const changed: string[] = [];
  for (const [name, bytes] of outputs()) {
    const path = resolve(root, name);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) changed.push(name);
    } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
  }
  if (changed.length) throw new Error(`Design exports are out of date. Run npm run design:build:\n${changed.join('\n')}`);
  console.log(check ? 'Design exports match their sources.' : 'Built handbook, tokens, stylesheet, outlined lockups and icon package.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build(process.argv.includes('--check'));
