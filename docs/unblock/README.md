# 8&80 Unblock

Design edition, 8 November 2026. This folder is the product specification, three original script packs and the chapters. The backend, pages, preview and subscription billing are implemented (see below). It is not a launch approval, and none of its rules have been tested with a caller.

Read with: [articulations](articulations.md) (the language bank) · [research and boundaries](research.md) · scripts for [opening](opening-script.md), [weekly](weekly-script.md) and [light](light-script.md) calls · [chapters](chapters.md) (one per month, chapter 1 is the arc below).

## Product decision

**See the light in your own life — and take the step that has been waiting.**

A monthly subscription of phone calls. Each month is a chapter (see [chapters](chapters.md)) with its own picture and milestone; chapter 1 begins with an opening call. The caller names something they want and have kept as a wish, looks honestly at what keeps it a wish, takes one small step at a time, and — throughout — notices the moments in their ordinary days that are already alive. The last call of every month, the chapter close, reads those moments back in their own words and sums up their month using only what they said.

Two things are "unblocked", and the module refuses to treat only one of them:

1. **Movement.** A wish held at arm's length because moving toward it risks something. One step per week, chosen by the caller, checked without guilt.
2. **Sight.** A life that already holds more light than a stuck person can see. A short noticing practice, collected into a ledger that only the caller owns.

The 8-year-old supplies the wish and the aliveness. The 80-year-old supplies the regret test and the gratitude. Unblock is the same two mentors, pointed at one question: *what are you here for, and are you living it?*

## How it differs from the other two products

| | Weekly 8&80 | Beliefs | **Unblock** |
| --- | --- | --- | --- |
| Question | What did you commit to, what happened, what's next? | Which assumption is in the way, and what do you decide instead? | What do you actually want, what is already lit, and what is the next step? |
| Shape | Open-ended weekly call | Daily 60–90 s practice + weekly review until retired | Monthly chapters: one opening call in month 1, then 1–8 calls a month, the last always the close |
| Durable record | One commitment per week | Beliefs, decisions, evidence, scores | One wish, named blocks, weekly steps, a light ledger, a closing reflection |
| End | None — "for as long as it takes" | When every belief is retired or removed | When the subscription ends (cancel at period end) |

Unblock does not do belief work. When the block the caller names is clearly an assumption about themselves, the guide notes it in the caller's words and stays with the step. The private account — not the call — may mention that Beliefs exists. No sales sentence belongs in a call about what someone is afraid of losing.

Shared with the other products, exactly as Beliefs shares them: brand, verified phone identity, encrypted storage, webhook verification, message outbox, global STOP, human safety holds, full export and deletion. Independent: consent, entitlement, schedule, wish, steps, ledger, completion. No Unblock call increments the weekly call counter or touches weekly memories.

## Subscription and the month

Unblock is its own monthly subscription from day one, separate from the weekly 8&80 subscription (own product, own checkout, own webhook handling; weekly callers and Beliefs are unaffected). One flat price whatever the number of calls: the amount is the provider product's, set by the owner (`UNBLOCK_PRODUCT_ID`, `UNBLOCK_CHECKOUT_URL`, `UNBLOCK_PRICE_LABEL`), never in code.

* **Calls per month: 1 to 8, default 4.** Chosen at signup and changed in the account. A change takes effect from the **next chapter**; the month in progress keeps the number it started with (before the first call of the first month it applies at once). Five or more calls a month use a second regular day, three days after the caller's usual one.
* **A chapter is the billing month**, anchored at first activation. Month 1 is chapter 1 and also has the opening call, which is extra and not counted in the calls per month. After chapter 12 the sequence continues at chapter 2 with a year counter (year 2), because chapter 1 is the first-time arc.
* **Spread.** The month's calls are spread over the caller's regular day and time so the close lands in the last part of the month. A missed call is not made up: the same stage is offered at the next slot. If the month ends (or no later slot is left) before the close, the next slot offers the close, even if it falls in the next month, before the new chapter starts.
* **Pause and resume** stop and restart calls straight away. Pause is calls-only: the billing gateway has no pause-collection call, so billing continues while paused and the account says so. **Cancel** is at period end: calls continue to the end of the paid period, with the last call a close whose sign-off says it is the last for now. **Manage billing** opens the provider portal. If a payment fails the account says so and calls continue while the provider retries, as for weekly 8&80.
* **The next chapter is only offered and managed in the private account**, never sold in a call. No call mentions price, offers or renewal.

## The arc of a month

| Call | Target | Theme (chapter 1 shown) | What the caller leaves with |
| --- | --- | --- | --- |
| Opening (month 1 only) | 15–20 min | **The wish.** What have you wanted for a long time and kept as "someday"? Regret test from the 80-year-old, pull test from the 8-year-old | One wish in their words; why it matters; the first step; whether they want light calls |
| Theme 1 | 10–15 min | **What keeps it a wish.** What would moving toward it risk? Which parts are real limits and which are predictions? | Named blocks (their words); a step sized to what's real |
| Theme 2 | 10–15 min | **Signs.** What has already been pointing this way — moments of aliveness, people, small lucky openings, things they keep returning to? | Signs in their words; a step that follows one |
| Theme 3 | 10–15 min | **The hard stretch.** What got harder once they started? What did that teach? Keep, shrink or change the step — or the wish | An honest account of the hard part; the next step or a deliberate pause |
| Close (always the last call) | 10–15 min | **Home.** The light ledger read back. What was already here before the wish? How do they want to live with both? The chapter's picture as a summary of their own month | A closing reflection in their words; one thing to carry |
| Light (optional) | 60–90 s | **What was alive today?** | One line in the ledger |

With four calls a month these are calls 1 to 4. With fewer, the themes are spread (one call: only the close; two: theme 1 and the close; three: themes 1 and 3 and the close); with more, the extra calls are open calls (last step, what is alive, next step). See [chapters](chapters.md).

**The sign-off is personal and true.** The guide uses the caller's preferred name and one thing in their own words from the month, then says what really happens next: the next chapter's title and the real next call day and time (continuing), that calls are paused until they restart in the account (paused), or that this is the last call for now and everything stays in the account (ending). Calls other than the close end with the real next call ("Talk to you on Thursday"). Never a price, an offer or a sales line.

Each weekly call opens by asking what happened with last week's step. Done, partly, not done and "it changed" are equally valid answers; a step not taken is information, not failure. The guide never praises attendance and never counts.

**The wish may change.** Week 3 explicitly allows changing it. A wish that turns out to belong to someone else is a real finding.

**The ledger is the centrepiece.** Light calls default to three evenings a week at a time the caller chooses; they can choose none. Without light calls, each weekly call asks for one moment from the past week instead, so the ledger is never empty at the close. The close reads back up to five of the caller's own entries from that chapter, verbatim, chosen by recency and spread — never ranked by the model for "positivity".

## Data (implemented; see [contracts](contracts.md))

```
unblock_enrollment  caller, consent, schedule (weekly day/time, light days/time, zone), standing, subscription (provider ids, cancel at period end, paid until), calls per month (+ pending for the next chapter), chapter/year/chapter start, anchor, completed_at
unblock_wish        version, text, why_text, confirmed_at       — new version on change; old kept
unblock_block       wish_version, text, kind: limit|prediction|unsure, confirmed_at
unblock_step        chapter, call number, text, outcome: done|partly|not|changed|null, outcome_text
unblock_light       chapter, occurred_on, text, source: light_call|weekly_call
unblock_closing     chapter, text, carry_text   (one per chapter)
```

All personal text encrypted at rest, caller words only, read-back and explicit agreement before canonical save — the same staged-session and signed-transcript rule Beliefs uses (`docs/beliefs/contracts.md`). The model may classify a block's `kind` only if the caller agrees with the classification; otherwise `unsure`.

Tool: `capture_unblock`, same envelope as `capture_belief` (`session_id`, `session_token`, `event_id`, verbatim `caller_text`, optional `command`). Commands: `wish`, `block`, `step`, `step_outcome`, `light`, `closing`, `light_schedule`, `pause`. Every caller utterance is sent for the shared safety keyword check.

## Sendouts (implemented)

| Moment | Message |
| --- | --- |
| After opening call | One neutral SMS: next call time and the private account route. No wish, no step |
| After subscription confirmed | One neutral SMS: choose or check call times, with the private account route |
| After each weekly call | None by default. Optional, opt-in: a neutral "your step is in your account" SMS |
| Missed call | One recovery notice; no repeat ringing, no catch-up calls |
| Last call of an ending subscription | One content-free SMS: the last call for now, everything is in the private account |

No email or SMS contains a wish, block, step or ledger entry, and no bearer link carries one: the SMS route is always `/unblock/access`, which needs a fresh phone code.

The verification codes (join and return) are the only other messages the web pages send. 

## Private account and pages (implemented)

| Route | What it does |
| --- | --- |
| `/unblock` | Landing: promise, the opening call, regular calls, light calls, AI disclosure, price label (`UNBLOCK_PRICE_LABEL`, never invented) |
| `/unblock/join` | Preferred name, optional support email, editable +47 phone, adult/AI/service consent; sends a code, creates nothing until it is verified |
| `/unblock/access`, `/unblock/verify` | Returning owner, fresh phone verification; unknown numbers get the identical response and no message. Verification sets a scoped, HttpOnly, one-hour `unblock` cookie |
| `/unblock/schedule` | IANA zone (Oslo fallback), first conversation, **calls per month (1–8)**, regular day/time, light evenings (default Mon/Wed/Fri 19:00, or "No light calls"). All inputs live in one component, `scheduleInputs()` |
| `/unblock/account` | The wish and earlier versions, named blocks, steps by week with outcomes, the light ledger, the closing reflection when it exists, this month's chapter, closings per chapter, next call with move/skip (a light call can only be skipped), the **subscription card** (status line, calls per month, pause/resume, cancel at period end, manage billing), full download, whole-account deletion (which also cancels the Unblock subscription), sign out. A quiet footer line may mention the sibling programme; nowhere else does |

Same invariants as Beliefs: CSRF tokens separated by product, same-site checks, `no-store`/`no-referrer`, escaped caller words, one hashed inline script, rate limits, no personal text in SMS, email or URLs. A regular call can only be moved later, before the following planned call, because the claim plans the following call from the clock.

**Billing.** `payment.ts` builds the hosted subscription checkout carrying the enrolment's `checkout_reference`; `billing.ts` handles the shared `/webhooks/payments` endpoint's Unblock events (recognised by that reference or a stored subscription id), always re-reading the subscription from the provider under the caller lock and requiring it to be the configured Unblock product. Standing: `awaiting_payment` → `active` / `past_due` (calls continue, as weekly) → `ended`. Nothing in the pages or routes can set `standing`. The preview simulates standing in memory through the same page.

## Review it

`npm run unblock:preview` opens a loopback-only walkthrough at http://127.0.0.1:8771/unblock (`UNBLOCK_PREVIEW_PORT` to change). Use synthetic information and code **000000**. Payment, subscription standing and calls are simulated and nothing leaves the preview; data expires after an hour. Preview controls (in the account, never mounted in production) simulate a held opening or regular call, a light call, a missed call, the next billing month starting, or the subscription ending, so a whole month can be clicked through, including what the close would read back from the light ledger.

`npm run unblock:doctor` reports configuration names and readiness only, never values.

## Owner decisions (settled) and still open

| Decision | Status |
| --- | --- |
| Pricing | Monthly subscription, flat price whatever the calls per month; the amount is the provider product's. Month 1 = chapter 1. The earlier one-time purchase is dropped |
| Calls per month | 1–8, default 4, caller's choice at signup and in the account; applies from the next chapter. Open: the exact price and whether the label should say "from" |
| Light call default | Three evenings a week, opt-out in the opening call |
| Language | English scripts here; a Norwegian pack is the likely first launch language and needs its own review — see the Norwegian lines in [articulations](articulations.md) |
| Bridge to Beliefs | Account page only, never in a call |
| Name | "Unblock" internally. Public candidates in [articulations](articulations.md) |

## Release gates

Same gates as Beliefs, unchanged: approved urgent-response procedure and staffed coverage, approved scripts, separately configured and verified voice agents, payment test mode, consent/privacy terms, and a measured pilot. This module talks about what people want and are afraid to lose — that will surface grief, regret and hopelessness more often than a commitment call does. The safety gate matters more here, not less.

What to measure in a pilot, without invented targets: whether callers can name a wish in the opening call; step outcomes by call; light-call answer rate and opt-outs; how the close and its sign-off land (one open question, in their words); which calls-per-month callers choose and keep; drop-off by month; connected minutes and cost.
