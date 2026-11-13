# 8&80 brand exports

The original Forever drawing remains in `assets/mark.svg`. All new exports reuse it;
the favicon uses the heavier `mark-small.svg`. The product handbook includes a visual
gallery of the finished files.

| File in assets/ | Use |
| --- | --- |
| lockup-light.svg | Pine name and mark, Gold dot, on Paper or a light surface |
| lockup-dark.svg | Chalk name and mark, Gold dot, on Night |
| lockup-on-gold.svg | Night name and mark, Paper dot, on Gold |
| app-icon.svg | Square vector master, Night background, Chalk mark, Gold dot |
| apple-touch-icon.png | 180 × 180 home-screen icon; let iOS mask the corners |
| icon-192.png / icon-512.png | 192 × 192 and 512 × 512 browser icons |
| icon-maskable-512.png | 512 × 512 icon; artwork inside the central safe circle |
| favicon.svg | Static, heavier small-format drawing on rounded Paper |
| favicon.ico | Embedded 16, 32 and 48 px PNG images |
| favicon-16.png / favicon-32.png / favicon-48.png | Individual raster favicons |
| site.webmanifest | Browser metadata and relative links to the web icons |

The lockups contain vector paths, including the name. They need no installed fonts.
Preserve their aspect ratio and built-in clear space. Do not crop, stretch, animate or
recolour the files. Use at least 160 CSS px width for the full lockup. Below that, use
the mark alone. The app icon is a full square with an opaque ground, suitable for masks.
The favicon must stay static.

## Rebuild and check

```sh
npm ci
npm run design:build
npm run design:check
```

`scripts/design/brand-assets.ts` builds SVG, PNG, ICO and manifest deterministically
using the pinned Resvg renderer. `brand/design-assets.json` contains SHA-256 checksums
of every generated export, including the handbook, CSS and tokens. CI fails when
committed exports differ from the source; it never overwrites them automatically.

The name is Fraunces 500 at optical size 36. `wordmark-outline.json` records its paths,
metrics and the SHA-256 of the licensed WOFF2 source. After deliberately changing that
font, regenerate this source with Python and `fonttools[woff]` installed:

```sh
python3 brand/create-wordmark.py
npm run design:build
```

Ordinary builds need only Node. Font licenses and the font build procedure are in
`fonts/README.md`. Review changed logos and screenshot differences before accepting
new outputs. Existing email and animated mark exports keep their own build commands
documented in `BRAND.md`.
