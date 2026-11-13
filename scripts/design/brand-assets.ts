import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { palette } from '../../services/voice/src/design-system/tokens.ts';

type Output = Map<string, Buffer>;
const svg = (width: number, height: number, body: string, label = '8&amp;80'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>${body}</svg>\n`;

/** All drawings reuse the original mark. The name is outlined from our local Fraunces. */
export function brandAssets(root: string): Output {
  const result: Output = new Map();
  const read = (name: string): string => readFileSync(resolve(root, 'brand/assets', name), 'utf8');
  const shape = (source: string): string => source.slice(source.indexOf('<path'), source.lastIndexOf('</svg>'));
  const regular = shape(read('mark.svg'));
  const small = shape(read('mark-small.svg'));
  const outline = JSON.parse(readFileSync(resolve(root, 'brand/wordmark-outline.json'), 'utf8')) as {
    unitsPerEm: number; advance: number; path: string; bounds: number[]; sourceSha256: string;
  };
  const font = readFileSync(resolve(root, 'brand/fonts/fraunces-latin-v1.woff2'));
  if (createHash('sha256').update(font).digest('hex') !== outline.sourceSha256) throw new Error('Regenerate the wordmark outline after changing Fraunces.');
  const add = (name: string, content: string | Buffer): void => { result.set(`brand/assets/${name}`, Buffer.from(content)); };
  const colour = (drawing: string, ink: string, dot: string = palette.gold): string => drawing.replaceAll(palette.pine, ink).replaceAll(palette.gold, dot);
  const lockup = (ink: string, dot?: string): string => {
    const size = 40, scale = size / outline.unitsPerEm;
    const width = Math.ceil(24 + 72 + 24 + outline.advance * scale + 24);
    const baseline = 48 + ((outline.bounds[1]! + outline.bounds[3]!) * scale) / 2;
    return svg(width, 96, `<g transform="translate(24 26.25) scale(.75) translate(-12 -31)">${colour(regular, ink, dot)}</g><path transform="translate(120 ${baseline}) scale(${scale} -${scale})" fill="${ink}" d="${outline.path}"/>`);
  };
  add('lockup-light.svg', lockup(palette.pine));
  add('lockup-dark.svg', lockup(palette.chalk));
  add('lockup-on-gold.svg', lockup(palette.night, palette.paper));
  const icon = svg(512, 512, `<rect width="512" height="512" fill="${palette.night}"/><g transform="translate(112 169) scale(3) translate(-12 -31)">${colour(regular, palette.chalk)}</g>`);
  add('app-icon.svg', icon);
  const favicon = svg(64, 64, `<rect width="64" height="64" rx="14" fill="${palette.paper}"/><g transform="translate(7.5 17) scale(.5) translate(-11 -30)">${small}</g>`);
  add('favicon.svg', favicon);
  const png = (source: string, width: number): Buffer => Buffer.from(new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng());
  for (const [name, width] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]] as const) add(name, png(icon, width));
  const sizes = [16, 32, 48];
  const images = sizes.map(size => png(favicon, size));
  sizes.forEach((size, i) => add(`favicon-${size}.png`, images[i]!));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i;
    header[at] = size; header[at + 1] = size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i]!.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += images[i]!.length;
  });
  add('favicon.ico', Buffer.concat([header, ...images]));
  add('site.webmanifest', JSON.stringify({
    id: '/start', name: '8&80', short_name: '8&80', lang: 'en', start_url: '/start', scope: '/', display: 'browser',
    theme_color: palette.night, background_color: palette.night,
    icons: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n');
  return result;
}
