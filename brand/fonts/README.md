# Lokale webfonter

Begge fonter er under SIL Open Font License 1.1. Lisensfilene følger fontene.
De hentes aldri fra Google eller andre tredjeparter når en bruker åpner en side.

| Fil | Kilde | Bevarte akser | Låste akser |
| --- | --- | --- | --- |
| `fraunces-latin-v1.woff2` | Google Fonts, `ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf` | opsz 9–144, wght 100–900 | SOFT 50, WONK 1 |
| `bricolage-grotesque-latin-v1.woff2` | Google Fonts, `ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf` | opsz 12–96, wght 200–800 | wdth 100 |

Kildearkiv: https://github.com/google/fonts, hentet 8. november 2026.
FontTools 4.60.2 og Brotli 1.2.1 ble brukt til instansiering, delsett og WOFF2.
Tegnsett: `U+0000-024F,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+FEFF,U+FFFD`.
Dette inkluderer norsk og vest-/sentraleuropeisk latin, tegnsetting og piler.
Andre skriftsystemer bruker systemfallback til egne tegnsett innføres.

Ved oppdatering: hent originalene og lisensene fra kildearkivet, lås aksene
som over med `fontTools.varLib.instancer`, lagre og åpne fonten på nytt,
bruk `fontTools.subset` med tegnsettet over og `layout_features=['*']`,
sett `font.flavor='woff2'` og lagre. Behold vektenes og optisk størrelses akser.
Øk filenes versjonssuffiks og oppdater `styles.ts` og `assets.ts`; fontfilene
serveres med ett års immutable-cache.

Merkets eksisterende SVG-er bruker geometriske streker, ikke fontfiler.
E-post fortsetter å bruke systemfont.
