# BRAND.md — how 8&80 looks and sounds

Same standing as SCRIPT.md, for a different surface. SCRIPT.md holds the words the
mentor says; this holds everything a person sees. Both exist so that the decision is
made once and referenced everywhere, rather than remade badly at eleven at night in
whichever file happens to be open.

Nothing here is decoration. Every rule below exists because the alternative would make
the product feel like something it is not.

---

## 1. What this has to feel like

A weekly phone call from someone who remembers. That is the whole promise, and it sets
every constraint below.

**It must not look like a productivity app.** No streaks, no progress rings, no charts of
your consistency, no green ticks. The call already refuses to congratulate people for
showing up; the pixels cannot go behind its back and do it anyway.

**It must not look like marketing.** The recap email arrives because the call promised
it. A header image, a call-to-action button, a footer of social icons — each one turns a
promise kept into a campaign, and the person reading it can tell.

**It must look like someone bothered.** Which is the harder half. Plain is not the same as
empty: a letter with nothing at the top and nothing at the bottom reads as automated, and
this product's entire claim is that it is paying attention.

The target is correspondence. A short note from a person who knows you, on their own
paper.

---

## 2. The name

**8&80** in writing. Never "8and80", never "8 & 80", never "Eight and Eighty".

Said aloud it is "eight and eighty" — see `open.first.greet`, where the mentor says "the
8 and 80 call", because an ampersand has no sound.

The domain is `8and80.me` only because a URL cannot hold an ampersand. That is a
technical fact, not a second name, and it never appears as one in prose.

**The two numbers are never explained in the interface.** Not in the email, not on the
page, not in a tagline. The call explains them by asking the two questions, and a product
that has to caption its own idea has lost the argument.

---

## 3. Colour

Warm neutrals and one accent. The palette below is the one already in the reschedule
page, which was designed for a phone screen at eight in the morning and works.

### Light

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#1a1a1a` | Body text, and the fill of a primary button |
| `--bg` | `#faf9f7` | Page background. Warm white, not `#fff` — paper, not a screen |
| `--quiet` | `#6b6560` | Secondary text: the slot, the duration, anything you could skip |
| `--line` | `#dcd8d2` | Rules and borders. Never a box shadow |
| `--accent` | `#9a5b3d` | One use per view, at most. See below |

### Dark

| Token | Value |
|---|---|
| `--ink` | `#ece9e4` |
| `--bg` | `#171614` |
| `--quiet` | `#9a938c` |
| `--line` | `#3a3733` |
| `--accent` | `#c98a68` |

**Dark mode is not optional.** These calls happen early and the texts arrive late; a
white rectangle at half past six in the morning is a small act of hostility. Every
surface declares `color-scheme: light dark` and defines both.

**The accent is a terracotta, and it is rationed.** One use per view — the commitment in
a recap, and nothing else. A second use halves the first. It is never a background, never
a button fill, never a border for emphasis.

**No other colour exists.** No red for a missed week, no green for a kept one. The
product does not score people, and a colour that means "well done" is the same failure as
a mentor that says it.

---

## 4. Type

System fonts, everywhere, deliberately:

```
ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif
```

A webfont costs a request, a flash of unstyled text, and — on the reschedule page — a
delay for somebody standing in a shop who has thirty seconds and one thumb. It buys a
personality this product does not need. The voice is in the words.

- **Body: 17px, line-height 1.5.** Larger than a web default because these are read on a
  phone, often in a hurry.
- **Headings: 1.5rem, weight 600, letter-spacing -0.01em.** One per view. There is never
  a second level; if a page needs an `h2` the page is doing too much.
- **Never italics for emphasis**, and never bold inside a sentence. If a sentence needs
  emphasis to land, it is the wrong sentence — the same rule SCRIPT.md applies to speech.

---

## 5. The mark

There isn't one yet, and there should not be a logo before there is a product.

When it exists it is typographic: the characters `8&80`, set in the body face, in `--ink`.
No symbol, no infinity loop, no two-figures-holding-hands. The idea is already slightly
too clever; a picture of it would be unbearable.

Until then, the wordmark **8&80** in `--ink` at body weight is the mark.

---

## 6. Each surface

### The recap email

Plain text. No HTML part, no images, no tracking pixel, no unsubscribe footer — it is
transactional correspondence somebody asked for, not a mailing.

Structure, and the reason for it:

1. **The commitment, alone, first.** Finding it is the only reason to open this.
2. What it is for — one line.
3. Logistics — how long you spoke, when the next call is.
4. **A sign-off.** `— 8&80` on its own line.

Point 4 is new, and it is the fix for an email that "arrived blank". A note with nothing
at the end is a machine's output; two characters and a dash are a letter. Nothing more
than that: no name, no title, no "your accountability partner".

The from-name is **8&80**. The subject line carries the commitment's day when there is
one, because that is what makes it findable on a Thursday.

### The reschedule page

Already right, and the source of this palette. It shows the slot and offers three
actions, and nothing else — no name, no history, no commitment. A link may sit in a
message thread for years; the page is built for a stranger to find boring.

### The missed-call text

No branding at all. Sixty characters and a link. A text that introduces itself is a text
that gets reported as spam.

---

## 7. Voice

Deferred to SCRIPT.md §"Voice rules", which binds every word this product says or
writes, including words nobody speaks aloud. In particular: no exclamation marks
anywhere, no congratulation, no therapy register, and never narrating itself.

One addition for written surfaces, where speech rules do not reach:

**Never use the word "journey".** Nor "accountability partner", "unlock", "level up",
"your 8&80 experience". If a sentence would be at home in an onboarding carousel, it is
wrong here.
