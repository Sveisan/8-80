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
| Night `#16211B` | gold | green |
| Green `#4A6656` | gold | green |
| Mist `#ECF0EA` | gold | green |
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
| Gold | `#E2B653` | The ball. Accent and buttons on dark. |
| Green | `#4A6656` | The 88. Accent and buttons on light. |
| Night | `#16211B` | Dark ground — the default. |
| Deep | `#243A30` | Body text on light. |
| Chalk | `#F4F1E8` | Text on dark. Never a background. |
| Mist | `#ECF0EA` | Light ground. Deliberately not cream. |

### Contrast — checked, not asserted

| Pair | Ratio | Use | |
| --- | --- | --- | --- |
| Chalk on Night | 14.7 : 1 | Body text, dark | pass |
| Gold on Night | 8.7 : 1 | Accents and buttons, dark | pass |
| Green on Night | 2.6 : 1 | **Never text** | fail |
| Deep on Mist | 10.6 : 1 | Body text, light | pass |
| Green on Mist | 5.5 : 1 | Headings, links, buttons, light | pass |
| Gold on Mist | 1.7 : 1 | **Never text** | fail |
| Chalk on Green | 5.6 : 1 | Text on green panels | pass |
| Deep on Gold | 6.4 : 1 | Text on gold bands | pass |
| Green 88 on Gold ball | 3.3 : 1 | Graphic — clears the 3:1 non-text bar | pass |

Every ratio in that table was recomputed from the hexes and matches to a rounding place.
It is the reason this palette is the one in the code and not the warmer alternative in §12:
the numbers were done first, and the two failing pairs are named rather than hidden.

The two failures are the important rows. Gold is loud enough to look like a heading colour
on a light ground and is unreadable at 1.7:1; green looks like a sober body colour on dark
and is unreadable at 2.6:1. Both belong to the mark, not to the text.

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

- **Headed, not bare.** The mark and the wordmark at the top; nothing else above the first
  line of content. The wordmark is **live text beside the ball**, so the brand survives
  image blocking — which is the default in Mail.app and Outlook.
- The one thing they committed to comes first, alone, in their own words. Everything below
  it can go unread.
- No button, no banner, no social footer, no "view in browser".
- Ends `— 8&80` and nothing else. No name, no title, no "your accountability partner",
  which would undo in one line everything SCRIPT.md §11 protects.
- **Always send a plain-text alternative part** carrying the same words. A recap that only
  exists as HTML is a recap some people cannot read.
- System font stack — §7's family cannot be self-hosted into a mail client.
- **Light is the default here**, and only here. Night arrives through
  `prefers-color-scheme`, but a client that strips the style block has to be left with a
  complete letter rather than a guess, and the complete letter is the one on Mist.
- The ball is optional and configured, not compiled in (`RECAP_MARK_URL`). A remote image
  in an email tells a server the moment somebody opens their recap, which is a tracking
  pixel whatever we call it. It is left unset until it points somewhere we are content to
  have that. Nothing in the letter depends on it loading.

The words themselves are in SCRIPT.md §12 and are not restated here.

### The reschedule page

Opened one-thumbed, often in a shop, usually within a minute of a text arriving. It has one
job and should be finished in two taps.

Light ground, because it is opened in daylight far more often than the call is taken. Green
buttons — gold fails on Mist. No account, no login, no explanation of the product to
someone who is already a customer.

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
| `mark-192.png` | Email. Transparent, so it sits on either ground |

`mark-mono.svg` resolves `currentColor` from its parent only when inlined; referenced
through `<img>` it falls back to black. Inline it, or set `fill` at the use site.

`mark-192.png` is produced by `brand/render-mark.py`, which reads the geometry out of
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

## 12. Open, and deliberately not settled here

**A warmer palette was proposed alongside this one** — Marigold `#E8A33D` for the 8, Pine
`#2F4A3A` for the 80, over Paper `#F4EDE1` ("pure white kills nostalgia"). It is a real
alternative with a real argument, and it is not what the code uses, for two reasons worth
stating rather than assuming:

- The mark is drawn in `#E2B653` and `#4A6656`. Changing the palette means redrawing every
  asset above and redoing the contrast table; Marigold on Paper is 1.85:1 and Pine on Paper
  8.35:1, so the shape of the rules survives but none of the numbers do.
- The two grounds disagree on purpose. Mist `#ECF0EA` is specified as "deliberately not
  cream"; Paper `#F4EDE1` is specified as cream, deliberately. That is a decision about
  whether 8&80 reads as nostalgic or as clear-eyed, and it is not a decision a colour
  token should make quietly.

Until that is settled, everything ships in the six colours of §6. Switching later is a
palette change, not a rebuild, provided nothing hard-codes a hex outside the token table.
