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

One ball. Two eights. Joined.

- **The 8-ball** — the one object that belongs to both ages. A kid's first pool table, a
  pub game at eighty. Recognisable from across a room.
- **Two 8s, fused** — the 8-year-old and the 80-year-old leaning in until they become one
  shape. Two of you, joined into one.
- **Gold and green** — gold is the child (sunlight, play), green is the elder (calm,
  durable). The gold ball carries the green 88.

Everything in the identity comes from those three sentences. A proposal that cannot be
traced back to one of them is decoration.

---

## 3. The name

**8&80** in writing. Never "8and80", never "8 & 80", never "Eight and Eighty".

Said aloud it is "eight and eighty" — see `open.first.greet` in SCRIPT.md, where the
mentor says "the 8 and 80 call", because an ampersand has no sound.

The domain is `8and80.me` and mail comes from `mail.8and80.me`; that spelling exists
because DNS cannot hold an ampersand, and it never appears in copy.

---

## 4. The mark

A gold ball with a green 88, drawn at the proportion of a real pool ball's numeral.

- **The 88 is 38% of the ball's diameter.** That is the pool-ball number proportion, and
  it is why the mark reads as an object rather than a logo.
- **Clear space: a quarter of the ball's diameter on every side.**
- **Below 32px, use `mark-small.svg`** — the same drawing with the 88 enlarged to 54% so
  the counters survive. The primary mark at 22px turns into a smudge.

It works alone. The lockup adds the name only where people do not yet know it.

---

## 5. Colourways

**The ball never matches the ground.**

| Ground | Ball | 88 |
| --- | --- | --- |
| Night `#1A2920` | gold | green |
| Green `#4A6656` | gold | green |
| Paper `#F4EDE1` | gold | green |
| White | gold | green |
| Gold `#E2B653` | **green** | **gold** |

On gold the whole mark flips, because a gold ball on a gold ground is a hole. The one
exception is deliberate: for a watermark or an embossed card, let the ball match the
ground on purpose so only the 88 remains.

### Six ways to break it

1. A gold ball on a gold ground.
2. Recolouring the 88 to anything but the flip above.
3. Stretching it.
4. Rotating it.
5. Shadows, glows, gradients, or any other effect.
6. `mark.svg` below 32px.

---

## 6. Colour

Six colours, two jobs each. **Dark is the default theme** — almost every habit app is pale
and bright, and 8&80 is the quiet evening call.

| Name | Hex | Job |
| --- | --- | --- |
| Gold | `#E2B653` | The ball. Accent and buttons on dark. Never text on Paper. |
| Green | `#4A6656` | The 88. The wordmark and headings on light. |
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
| Green 88 on Gold ball | 3.3 : 1 | Graphic — clears the 3:1 non-text bar | pass |

Every ratio in that table was recomputed from the hexes. §12 records how this palette was
arrived at — a bake-off on the real surfaces, not a swatch sheet — and what it replaced.

The failures are the important rows. Gold is loud enough to look like a heading colour on a
light ground and is unreadable at 1.6:1; green looks like a sober body colour on dark and is
unreadable at 2.4:1. Both belong to the mark, not to the text.

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
| 72 · 700 | The one line at the top of a page |
| 36 · 700 | Section heads |
| 21 · 700 | Sub-heads |
| 18 · 400 | Body |
| 14 · 400 | The quiet line under a button |

Sentence case everywhere, in type as in voice.

**Where this does not apply: email.** Mail clients cannot use a self-hosted webfont, so
the email stack is a system stack and the wordmark is live text. See §9.

---

## 8. The talking orb

Wherever 8&80 speaks on a screen, the ball becomes the voice. Four states, one calm motion
language — and **waiting is a state in its own right.**

- **Resting** — a slow breath every six seconds. Present, not busy.
- **Speaking** — the ball swells gently with the voice, and the 88 turns toward you, like a
  pool ball rolling to face the table.
- **Listening** — a thin ring in the ink colour answers your voice. The ball itself stays
  still.
- **Waiting** — a gold halo breathes once every five seconds. Still here, in no hurry. **It
  never fills the silence.**

Everything eases; nothing snaps. With `prefers-reduced-motion`, only the rings change.

The waiting state is the identity's whole argument in one animation. SCRIPT.md §5 tells the
mentor to let a pause run; an orb that spun or pulsed through that pause would be arguing
the opposite on the same screen.

---

## 9. Each surface

### The recap email

The call promises it out loud, so it is not a newsletter and it is not optional. It is the
one piece of the product a person keeps.

- **Headed, not bare.** The ball, the wordmark and the date on one line, over a 2px gold
  rule — the one place gold appears on Paper, and the thing that makes it stationery
  rather than a page. The wordmark is **live text beside the ball**, so the brand survives
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
- **`mark-small.png` at 40px**, not `mark.svg`. §4's 32px threshold assumes a screen at a
  known scale; a mail client renders at whatever DPI it likes and Gmail downscales. At 40px
  in an inbox the primary mark's 88 is a smudge and the small one's is legible — checked
  side by side, not assumed.
- **We serve the ball ourselves**, from the control plane at `PUBLIC_URL/mark.png`, and
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
| `mark.svg` | Primary mark, 32px and up |
| `mark-small.svg` | 32px and below — same drawing, 88 at 54% |
| `mark-on-gold.svg` | Gold grounds — ball green, 88 gold |
| `mark-mono.svg` | One colour via `currentColor`, 88 knocked out |
| `mark-email.png` | Email, shown at 40px. `mark-small` at 160px, transparent |

`mark-mono.svg` resolves `currentColor` from its parent only when inlined; referenced
through `<img>` it falls back to black. Inline it, or set `fill` at the use site.

`mark-email.png` is produced by `brand/render-mark.py`, which reads the geometry out of
`mark.svg` rather than restating it, so the export cannot quietly disagree with the
drawing. Its output was checked pixel-for-pixel against a browser's rendering of the same
SVG: everything that differs is antialiasing on an edge, bar nine pixels in thirty-seven
thousand. Regenerate at any size with `python3 brand/render-mark.py 512 > out.png`.

**Not yet in the repo**, and each one blocks something:

- `lockup-light.svg` / `lockup-dark.svg` — mark plus name. Needs the wordmark set in
  Bricolage Grotesque and converted to outlines; the font is not here yet.
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
