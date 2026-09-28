# BRAND.md — how 8&80 looks

Same standing as SCRIPT.md, for a different surface. SCRIPT.md holds the words the mentor
says; this holds everything a person sees. Both exist so the decision is made once and
referenced everywhere, rather than remade badly at eleven at night in whichever file
happens to be open.

The identity itself is not decided here. It was designed, and this file records it so the
code can be checked against it. Where a rule below looks arbitrary, it is load-bearing —
the reason is given.

---

## 1. What this has to feel like

A weekly phone call from someone who remembers. That is the whole promise, and it sets
every constraint below.

**It must not look like a productivity app.** No streaks, no progress rings, no charts of
your consistency, no green ticks. The call already refuses to congratulate people for
showing up; the pixels cannot go behind its back and do it anyway.

**It must not look like marketing.** The recap email arrives because the call promised it.
A call-to-action button, a footer of social icons, an unsubscribe pitch — each one turns a
promise kept into a campaign, and the person reading it can tell.

**It must look like someone bothered.** Which is the harder half, and the half we got
wrong first: the opening recap email went out bare and read as machine output. Plain is
not the same as empty. A letter with nothing at the top and nothing at the bottom is not
restraint, it is absence, and this product's entire claim is that it is paying attention.

The target is correspondence on headed paper. Not a campaign, not a receipt.

---

## 2. The idea

One line. Two loops. No end.

- **An 8 lying down is infinity.** Turn the 8 on its side and it stops being a number and
  becomes "for as long as it takes" — which is what a weekly call is, and why it is weekly
  and not a course with a last lesson.
- **Two loops, two sizes** — the small loop is the 8-year-old, the big one the 80-year-old.
  It is one line: you cannot draw either loop without passing through the other.
- **Gold and green** — gold is the child (sunlight, play), green is the elder (calm,
  durable). The gold dot sits in the small loop: the child, carried inside the whole.

Everything in the identity comes from those three sentences. A proposal that cannot be
traced back to one of them is decoration.

_The mark was a gold 8-ball with a green 88 until 2026-09-27, when it was redrawn as
"Forever", chosen from ten directions. §§4, 5, 8, 9 and 11 were rewritten with it; the
palette in §6 did not change._

---

## 3. The name

**8&80** in writing. Never "8and80", never "8 & 80", never "Eight and Eighty".

Said aloud it is "eight and eighty" — see `open.first.greet` in SCRIPT.md, where the
mentor says "the 8 and 80 call", because an ampersand has no sound.

The domain is `8and80.me` and mail comes from `mail.8and80.me`; that spelling exists
because DNS cannot hold an ampersand, and it never appears in copy.

---

## 4. The mark

**Forever**: one Pine line drawn as a lopsided infinity, a small loop and a big one, with a
Gold dot in the small loop.

- **The small loop is about 60% the height of the big one.** Equal loops are the maths
  symbol; unequal ones are two ages. Do not even them out.
- **The dot sits in the centre of the small loop**, never in the big one and never on the
  line. It is the one piece of Gold in the mark.
- **Clear space: the height of the small loop on every side.**
- **Below 32px wide, use `mark-small.svg`** — the same line, heavier, with a larger dot, so
  the small loop does not close up.

It works alone. The lockup — the mark with **8&80** set beside it in the display serif —
is for places where people do not yet know the name, which is the sign-up page and the
recap letter.

---

## 5. Colourways

**The line is always the colour text would be on that ground; the dot is always Gold** —
except on Gold, where it cannot be.

| Ground | Line | Dot | File |
| --- | --- | --- | --- |
| Paper `#F4EDE1` / white | Pine | Gold | `mark.svg` |
| Night `#1A2920` | Chalk | Gold | `mark-on-night.svg` |
| Green `#4A6656` | Chalk | Gold | `mark-on-night.svg` |
| Gold `#E2B653` | **Night** | **Paper** | `mark-on-gold.svg` |
| Unknown — email, app icons | Pine on a Paper disc | Gold | `mark-badge.svg` |

The badge exists because some surfaces pick the ground for us. A mail client shows the same
image on Paper in light mode and on Night in dark mode, and a bare Pine line vanishes on
Night at 1.6:1; on its own Paper disc it is right on both.

### Six ways to break it

1. A Pine line on Night or Green — it is the ground, darkened, and disappears.
2. A Gold dot on Gold.
3. Evening out the two loops.
4. Moving the dot into the big loop, or doubling it.
5. Stretching, rotating, shadows, glows, gradients, or any other effect.
6. `mark.svg` below 32px wide.

---

## 6. Colour

Six colours, two jobs each. **Dark is the default theme** — almost every habit app is pale
and bright, and 8&80 is the quiet evening call.

| Name | Hex | Job |
| --- | --- | --- |
| Gold | `#E2B653` | The dot. Accent and buttons on dark. Never text on Paper. |
| Green | `#4A6656` | Links and quiet accents on light. |
| Pine | `#2F4A3A` | Body text on light, and the filled button. |
| Night | `#1A2920` | Dark ground — the default. |
| Chalk | `#F4F1E8` | Text on dark. Never a background. |
| Paper | `#F4EDE1` | Light ground. Cream, on purpose. |

### Contrast — checked, not asserted

| Pair | Ratio | Use | |
| --- | --- | --- | --- |
| Pine on Paper | 8.4 : 1 | Body text, light | pass |
| Green on Paper | 5.4 : 1 | Wordmark, headings, links, light | pass |
| Gold on Paper | 1.6 : 1 | **Never text** | fail |
| Paper on Pine | 8.4 : 1 | Text on the filled button | pass |
| Chalk on Night | 13.5 : 1 | Body text, dark | pass |
| Gold on Night | 8.0 : 1 | Accents and buttons, dark | pass |
| Green on Night | 2.4 : 1 | **Never text** | fail |
| Pine on Night | 1.6 : 1 | **Never text** — it is the ground, darkened | fail |
| Chalk on Green | 5.6 : 1 | Text on green panels | pass |
| Night on Gold | 8.0 : 1 | Text on gold bands and buttons | pass |
| Pine line on Paper | 8.4 : 1 | The mark on light | pass |
| Chalk line on Night | 13.5 : 1 | The mark on dark | pass |
| Night line on Gold | 8.0 : 1 | The mark on gold | pass |

Every ratio in that table was recomputed from the hexes. §12 records how this palette was
arrived at — a bake-off on the real surfaces, not a swatch sheet — and what it replaced.

The failures are the important rows. Gold is loud enough to look like a heading colour on a
light ground and is unreadable at 1.6:1; green looks like a sober body colour on dark and is
unreadable at 2.4:1. Neither is ever text; Gold belongs to the mark's dot and to buttons on dark.

Pine and Green are one colour in two stops, and the stops do different work: Green is the
accent you notice, Pine is what you read. Never set a link in Pine — it will be invisible
against the body text beside it.

---

## 7. Type

**Bricolage Grotesque**, one family for everything, self-hosted — never loaded from Google
Fonts, because a weekly call that claims to be private should not tell a third party each
time someone opens their recap.

Its optical-size axis does the work that a second family would otherwise do: heavy and
tight for numbers, open and easy for reading.

| Size · weight | Use |
| --- | --- |
| 72 · 500 | The one line at the top of a page — Fraunces |
| 36 · 700 | Section heads |
| 21 · 700 | Sub-heads |
| 18 · 400 | Body |
| 14 · 400 | The quiet line under a button |

Sentence case everywhere, in type as in voice.

**Forever adds one display face: Fraunces**, a soft old-style serif, for the one line at the
top of a page and the wordmark in the lockup — the same rule, self-hosted, never from Google
Fonts. Everything else stays in Bricolage Grotesque. Until the file is in the repo, those
lines fall back to the system serif (New York on Apple devices), which is close enough to
ship and not the drawing.

**Where this does not apply: email.** Mail clients cannot use a self-hosted webfont, so
the email stack is a system stack and the wordmark is live text. See §9.

---

## 8. The mark in motion

Wherever 8&80 is doing something on a screen — loading, sending, talking, waiting for you —
the mark moves, and it moves one way only: **the loops trade sizes, and the gold goes with
the child.** The small loop swells into the big one while the big one draws in. While it
moves, the small loop fills with Gold — the child's sunlight, and the gold ball the mark used
to be — and the dot inside turns ink so it still shows. At each crossing the gold drains, the
dot turns gold again and carries it through the waist, swelling a little as it passes, and
the new small loop fills once the dot arrives. Halfway it is a plain, symmetric infinity with
a gold dot at its centre. At rest it is the plain mark.

It never spins. A turning mark is a loading wheel, and a loading wheel says "wait for the
machine"; two ages taking turns says "we are on it, together".

One component, five moods — `services/voice/src/signup/mascot.ts`:

| Mood | What it does | Where |
| --- | --- | --- |
| `rest` | Still | Anywhere the mark is just the mark |
| `idle` | Every twelve seconds the gold rises, the loops trade and back, the gold drains | Page headers — alive, never busy |
| `wait` | Trades steadily, 2.8s a round trip | Loading, sending — a pressed button shows it in place of its label |
| `talk` | Trades faster, 1.4s, the dot swelling more at each crossing | The mentor speaking or typing |
| `nudge` | The gold rises, one trade and back, the gold drains, four seconds of rest | Beside the one thing a person needs to do next, like "check your texts" |

The mascot is the mark doing a job, not a character: no face, no eyes, no bounce, no
speech bubble. It only ever says "working" or "your move".

Rules:

- **Waiting is a state, and it is quiet.** `nudge` asks once and then rests for four
  seconds; it never loops continuously beside a person's own task. SCRIPT.md §5 tells the
  mentor to let a pause run, and a mark that pulsed through that pause would be arguing the
  opposite on the same screen.
- **Less motion, when asked.** The animations wait for `begin="indefinite"` and start only
  if `prefers-reduced-motion` is not set, so with the request, or with scripts off, the mark
  stands still and is complete standing still. The standalone files below cannot check, so
  a page using one shows `mark.svg` under `@media (prefers-reduced-motion: reduce)`.
- **SMIL, not CSS.** Safari cannot animate a path's shape from CSS, and the page is most
  often opened on an iPhone.
- **Colour moves, the palette does not.** Gold fills the small loop, the line stays the
  text colour, and the dot inside the gold is ink: Pine on Paper, Night on a dark page. On a
  Gold button the gold becomes Paper and the line Night, as on any Gold ground (§5).
- **Never gold in both loops at once.** Half-strength Gold over Night is olive, which is not
  in the palette; the gold hands over through the dot instead. A test holds this.
- **Never in email or the favicon.** Email cannot animate, and at favicon size the trade is
  a flicker.

Why a warp works where the first attempt, a morph against the mirror image, collapsed into a
vertical bar: the traded drawing is traced in the same order as the original, left loop then
right, each from the crossing, so every point moves only within its own loop. Morphing
against the plain mirror pairs each loop with the other, and halfway every x lands on the
axis.

---

## 9. Each surface

### The recap email

The call promises it out loud, so it is not a newsletter and it is not optional. It is the
one piece of the product a person keeps.

- **Headed, not bare.** The badge, the wordmark and the date on one line, over a 2px gold
  rule — the one place gold appears on Paper, and the thing that makes it stationery
  rather than a page. The wordmark is **live text beside the badge**, so the brand survives
  image blocking, which is the default in Mail.app and Outlook.
- **Dated.** In the caller's zone, day and month only. A letter is dated; a notification
  is not. No weekday: the day their commitment lands on is already in the letter, and two
  weekdays on one page is how the first recap managed to name the wrong one.
- **One focal point.** Their own sentence at 30px, normal weight, everything else stepping
  down hard from it. Normal weight and not bold, because this is a letter quoting them
  back, not a headline announcing something at them. If the one thing and the line about
  how long the call ran look like the same size, the email has failed at its only job.
- No button, no banner, no social footer, no "view in browser".
- Ends under a hairline with `— 8&80` and nothing else. A letter ends; it does not stop.
  No name, no title, no "your accountability partner", which would undo in one line
  everything SCRIPT.md §11 protects.
- **Always send a plain-text alternative part** carrying the same words. A recap that only
  exists as HTML is a recap some people cannot read.
- System font stack — §7's family cannot be self-hosted into a mail client. **Quote the
  family names with single quotes.** `"Segoe UI"` inside a double-quoted `style` attribute
  closes the attribute, the rest of the declaration is parsed as stray attributes, and the
  element loses its size, weight and colour along with its font. The first letter that went
  out did exactly that and arrived looking like unstyled text in every client. There is a
  test that walks every `style` attribute in the output and fails if one ends mid-value.
- **Light is the default here**, and only here. Night arrives through
  `prefers-color-scheme`, but a client that strips the style block has to be left with a
  complete letter rather than a guess, and the complete letter is the one on Paper.
- **`mark-email.png` at 40px** — the badge, not the bare mark. A mail client puts the same
  image on Paper in light mode and on Night in dark mode, and it downscales at whatever DPI
  it likes; the Paper disc keeps the line visible on both, and the badge's heavier line
  keeps the small loop open at 40px.
- **We serve the mark ourselves**, from the control plane at `PUBLIC_URL/mark.png`, and
  not from an image CDN. A remote image in an email tells whoever serves it the moment
  somebody opened their recap, along with their IP. On our own host that is a line in our
  own log that we choose not to write; on a third party's it is a record, on an account we
  may not even own, of when private accountability emails were read. `RECAP_MARK_URL`
  overrides it; no `PUBLIC_URL` means no image, and nothing in the letter depends on one.

The words themselves are in SCRIPT.md §12 and are not restated here.

### The reschedule page

Opened one-thumbed, often in a shop, usually within a minute of a text arriving. It has one
job and should be finished in two taps.

Light ground, because it is opened in daylight far more often than the call is taken. Pine
buttons — gold fails on Paper. No account, no login, no explanation of the product to
someone who is already a customer.

**The exit is on it, named plainly.** "Stop calling me", quiet, under the things somebody
came here to do. Not "manage preferences", which is how a system hides a door. One confirm
step, because the page is opened one-thumbed and often walking, and then the calls end —
no survey, no second ask, no "sorry to see you go". A product that makes leaving feel like
an argument has decided its own retention matters more than the person, which is the one
thing this call claims not to be.

The page after it carries the way back, and that is not a courtesy. Somebody who stopped by
texting STOP has a number the carrier will no longer deliver to, so START can never reach
them; this link is all they have.

### The missed-call text

Plain text. No link shortener, no emoji, no brand name in the body — it is a message from
someone who just tried to ring you.

---

## 10. Voice

The visual voice rules are the same rules as the spoken ones, and they live in SCRIPT.md
§§1–13. The short version, because it governs button labels and error strings too:

- Never an exclamation mark.
- Never "amazing" or "great job".
- Never congratulate someone for showing up.
- Sentence case everywhere.
- Buttons say exactly what happens.
- Errors explain and fix. They do not apologise.
- Honest about being an AI, always.
- When someone goes quiet, wait.

---

## 11. Files

In `brand/assets/`:

| File | Use |
| --- | --- |
| `mark.svg` | Primary mark on Paper or white, 32px wide and up |
| `mark-small.svg` | Below 32px wide — same line, heavier, larger dot |
| `mark-on-night.svg` | Night and Green grounds — Chalk line |
| `mark-on-gold.svg` | Gold grounds — Night line, Paper dot |
| `mark-mono.svg` | One colour via `currentColor`, line and dot alike |
| `mark-badge.svg` | The mark on its own Paper disc, for grounds we do not choose |
| `mark-email.png` | Email, shown at 40px. `mark-badge` at 160px, transparent outside the disc |
| `*-animated.svg` | The web header only. The same drawing, turning. |

`mark-mono.svg` resolves `currentColor` from its parent only when inlined; referenced
through `<img>` it falls back to black. Inline it, or set `stroke` and `fill` at the use
site. The sign-up page inlines the mark with a `currentColor` line for the same reason, so
one drawing follows the theme.

The animated files are written by `npm run animate-mark` from
`services/voice/src/signup/mascot.ts`, the same choreography the pages use, so a file and a
page cannot disagree; rerun it after any change to the mark or its motion. For each of
`mark`, `mark-on-night`, `mark-on-gold` and `mark-badge` it writes `-animated.svg` (the
`idle` mood) and `-loading.svg` (the `wait` mood). They keep the static mark's proportions: a
warp never leaves the mark's own box. §8 has the rules.

`mark-email.png` is produced by `brand/render-mark.py`, which reads the circles and the
path out of the SVG rather than restating them, so the export cannot quietly disagree with
the drawing. Regenerate it with `python3 brand/render-mark.py 160 > brand/assets/mark-email.png`
after any change to `mark-badge.svg`; its output was compared by eye against a browser's
rendering of the same SVG on Paper and on Night when the mark was redrawn.

**Not yet in the repo**, and each one blocks something:

- `lockup-light.svg` / `lockup-dark.svg` — mark plus name. Needs the wordmark set in
  Fraunces and converted to outlines; the font is not here yet.
- `fonts/Fraunces.woff2` — the display serif Forever pairs with (§7), self-hosted. Until it
  lands, the sign-up page's headline and wordmark render in the system's serif.
- `fonts/BricolageGrotesque.woff2` — the variable font, self-hosted. Until it lands, any
  page that names Bricolage Grotesque is silently rendering in a system fallback.
- App icons and a favicon. `render-mark.py` will produce them at any size; what is missing
  is the decision about the rounded-square iOS ground, which is a design question and not
  an export.

---

## 12. How the palette was settled

Two grounds were specified, each deliberately: Mist `#ECF0EA`, "deliberately not cream",
and Paper `#F4EDE1`, "pure white kills nostalgia". That is not a swatch disagreement, it is
a question about whether 8&80 reads as nostalgic or as clear-eyed, and it was settled the
only way that question can be — by rendering the actual recap and the actual reschedule
page in each and looking at them side by side.

What came out of it:

- **Paper won the ground**, light and dark alike. Mist is the cooler, cleaner one and it
  reads as a product; Paper reads as something that was written to you.
- **Night went with it**, from `#16211B` to `#1A2920`, which is Pine darkened rather than a
  near-black. The dark theme is the ground the mark sits on, not the absence of one.
- **Gold and Green survived** the alternative Marigold and Pine at the top of the palette.
  Marigold is the more orange of the two and the ball is drawn in Gold; nothing was gained
  worth redrawing every asset for.
- **Pine came in below them**, as the ink on Paper and the filled button. It was the one
  thing the alternative palette had that this one did not: a green heavy enough to carry a
  button without looking soft.

The alternative's own weakness is worth recording, because it is the failure mode to watch
for in any future proposal. As proposed it had two colours and a ground, so the accent and
the body text were the same colour — meaning a link and the sentence around it would have
been indistinguishable. Two colours are a mood. A palette needs the stops.
