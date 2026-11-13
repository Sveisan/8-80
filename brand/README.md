# brand/

`design-system.html` is the current living product handbook: principles, both themes,
typography, spacing, components, states, page patterns and growth rules. Run
`npm run design:preview` to open it alongside synthetic product pages, or
`npm run design:build` to regenerate the HTML, CSS and JSON token exports.

`BRAND.md` at the repo root records the identity. `docs/design-system.md` records
implementation, the site audit and extension rules. `guide.html` is an archived
identity study, clearly marked with a link to the current handbook.

`assets/` contains the Forever marks, outlined logo lockups, favicons, home-screen icons
and webmanifest. `ASSETS.md` lists the finished exports and their use. `fonts/` contains
the local variable WOFF2 files, licenses and build notes. `render-mark.py` exports the
email PNG. `design-assets.json` records SHA-256 hashes of the generated package.

Source of truth for product foundations: `services/voice/src/design-system/tokens.ts`.
Do not edit the generated HTML, CSS or JSON by hand.
