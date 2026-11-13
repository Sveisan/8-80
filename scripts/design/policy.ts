import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { root } from './build.ts';

const violations: string[] = [];
const visit = (dir: string): void => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { if (item.name !== 'design-system') visit(path); continue; }
    if (item.name !== 'page.ts') continue;
    const source = readFileSync(path, 'utf8');
    if (/(?:font-size|font-family|border-radius|padding|margin|gap)\s*:\s*(?:[\d.-]|['"])/.test(source)) violations.push(`${path}: page templates must use shared design styles`);
  }
};
visit(resolve(root, 'services/voice/src'));
const pages = readFileSync(resolve(root, 'services/voice/src/design-system/pages.ts'), 'utf8');
for (const match of pages.matchAll(/\b(font-size|margin(?:-\w+)?|padding(?:-\w+)?|gap|border-radius):\s*([^;{}]+)/g)) {
  if (/-?[\d.]+(?:rem|px)/.test(match[2]!)) violations.push(`pages.ts: ${match[0]} must use a design token`);
}
if (/@media[^{}]+var\(/.test(pages)) violations.push('CSS variables cannot be used in media queries; interpolate the breakpoint tokens.');
if (violations.length) throw new Error(violations.join('\n'));
console.log('Production pages use the shared typography, spacing and shape foundations.');
