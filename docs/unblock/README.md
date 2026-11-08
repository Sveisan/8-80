# 8&80 Unblock

Design edition, 8 November 2026. This folder is a product specification and three original script packs. Nothing here is implemented beyond `npm run unblock:prompt`, which prints the packs for review. It is not a launch approval, and none of its rules have been tested with a caller.

Read with: [articulations](articulations.md) (the language bank) · [research and boundaries](research.md) · scripts for [opening](opening-script.md), [weekly](weekly-script.md) and [light](light-script.md) calls · [chapters](chapters.md) (one per month, chapter 1 is the arc below).

## Product decision

**See the light in your own life — and take the step that has been waiting.**

Five weeks of phone calls with a beginning and an end. The caller names something they want and have kept as a wish, looks honestly at what keeps it a wish, takes one small step each week, and — throughout — notices the moments in their ordinary days that are already alive. The last call reads those moments back to them in their own words.

Two things are "unblocked", and the module refuses to treat only one of them:

1. **Movement.** A wish held at arm's length because moving toward it risks something. One step per week, chosen by the caller, checked without guilt.
2. **Sight.** A life that already holds more light than a stuck person can see. A short noticing practice, collected into a ledger that only the caller owns.

The 8-year-old supplies the wish and the aliveness. The 80-year-old supplies the regret test and the gratitude. Unblock is the same two mentors, pointed at one question: *what are you here for, and are you living it?*

## How it differs from the other two products

| | Weekly 8&80 | Beliefs | **Unblock** |
| --- | --- | --- | --- |
| Question | What did you commit to, what happened, what's next? | Which assumption is in the way, and what do you decide instead? | What do you actually want, what is already lit, and what is the next step? |
| Shape | Open-ended weekly call | Daily 60–90 s practice + weekly review until retired | Finite arc: one opening call, four weekly calls, one closing call |
| Durable record | One commitment per week | Beliefs, decisions, evidence, scores | One wish, named blocks, weekly steps, a light ledger, a closing reflection |
| End | None — "for as long as it takes" | When every belief is retired or removed | Week 5, by design |

Unblock does not do belief work. When the block the caller names is clearly an assumption about themselves, the guide notes it in the caller's words and stays with the step. The private account — not the call — may mention that Beliefs exists. No sales sentence belongs in a call about what someone is afraid of losing.

Shared with the other products, exactly as Beliefs shares them: brand, verified phone identity, encrypted storage, webhook verification, message outbox, global STOP, human safety holds, full export and deletion. Independent: consent, entitlement, schedule, wish, steps, ledger, completion. No Unblock call increments the weekly call counter or touches weekly memories.

## The arc

| Call | Target | Theme | What the caller leaves with |
| --- | --- | --- | --- |
| Opening | 20–25 min | **The wish.** What have you wanted for a long time and kept as "someday"? Regret test from the 80-year-old, pull test from the 8-year-old | One wish in their words; why it matters; the first step; whether they want light calls |
| Week 1 | 10–15 min | **What keeps it a wish.** What would moving toward it risk? Which parts are real limits and which are predictions? | Named blocks (their words); a step sized to what's real |
| Week 2 | 10–15 min | **Signs.** What has already been pointing this way — moments of aliveness, people, small lucky openings, things they keep returning to? | Signs in their words; a step that follows one |
| Week 3 | 10–15 min | **The hard stretch.** What got harder once they started? What did that teach? Keep, shrink or change the step — or the wish | An honest account of the hard part; the next step or a deliberate pause |
| Week 4 | 10–15 min | **Home.** The light ledger read back. What was already here before the wish? How do they want to live with both? | A closing reflection in their words; one thing to carry. Calls stop |
| Light (optional) | 60–90 s | **What was alive today?** | One line in the ledger |

Each weekly call opens by asking what happened with last week's step. Done, partly, not done and "it changed" are equally valid answers; a step not taken is information, not failure. The guide never praises attendance and never counts.

**The wish may change.** Week 3 explicitly allows changing it. A wish that turns out to belong to someone else is a real finding.

**The ledger is the centrepiece.** Light calls default to three evenings a week at a time the caller chooses; they can choose none. Without light calls, each weekly call asks for one moment from the past week instead, so the ledger is never empty by week 4. The closing call reads back up to five of the caller's own entries, verbatim, chosen by recency and spread — never ranked by the model for "positivity".

## Data (implemented; see [contracts](contracts.md))

```
unblock_enrollment  caller, consent, schedule (weekly day/time, light days/time, zone), state, completed_at
unblock_wish        version, text, why_text, confirmed_at       — new version on change; old kept
unblock_block       wish_version, text, kind: limit|prediction|unsure, confirmed_at
unblock_step        week, text, outcome: done|partly|not|changed|null, outcome_text
unblock_light       occurred_on, text, source: light_call|weekly_call
unblock_closing     text, carry_text
```

All personal text encrypted at rest, caller words only, read-back and explicit agreement before canonical save — the same staged-session and signed-transcript rule Beliefs uses (`docs/beliefs/contracts.md`). The model may classify a block's `kind` only if the caller agrees with the classification; otherwise `unsure`.

Tool: `capture_unblock`, same envelope as `capture_belief` (`session_id`, `session_token`, `event_id`, verbatim `caller_text`, optional `command`). Commands: `wish`, `block`, `step`, `step_outcome`, `light`, `closing`, `light_schedule`, `pause`. Every caller utterance is sent for the shared safety keyword check.

## Sendouts (implemented)

| Moment | Message |
| --- | --- |
| After opening call | One neutral SMS: next call time and the private account route. No wish, no step |
| After each weekly call | None by default. Optional, opt-in: a neutral "your step is in your account" SMS |
| Missed call | One recovery notice; no repeat ringing, no catch-up calls |
| Closing | One content-free SMS that the ledger is in the private account |

No email or SMS contains a wish, block, step or ledger entry, and no bearer link carries one: the SMS route is always `/unblock/access`, which needs a fresh phone code.

The verification codes (join and return) are the only other messages the web pages send. A purchase-confirmation message belongs to the payment seam below and is not built yet.

## Private account and pages (implemented)

| Route | What it does |
| --- | --- |
| `/unblock` | Landing: promise, the opening call, regular calls, light calls, AI disclosure, price label (`UNBLOCK_PRICE_LABEL`, never invented) |
| `/unblock/join` | Preferred name, optional support email, editable +47 phone, adult/AI/service consent; sends a code, creates nothing until it is verified |
| `/unblock/access`, `/unblock/verify` | Returning owner, fresh phone verification; unknown numbers get the identical response and no message. Verification sets a scoped, HttpOnly, one-hour `unblock` cookie |
| `/unblock/schedule` | IANA zone (Oslo fallback), first conversation, regular day/time, light evenings (default Mon/Wed/Fri 19:00, or "No light calls"). All inputs live in one component, `scheduleInputs()`, so a calls-per-month control can replace it |
| `/unblock/account` | The wish and earlier versions, named blocks, steps by week with outcomes, the light ledger, the closing reflection when it exists, next call with move/skip (a light call can only be skipped), pause/resume, full download, whole-account deletion, sign out. A quiet footer line may mention the sibling programme; nowhere else does |

Same invariants as Beliefs: CSRF tokens separated by product, same-site checks, `no-store`/`no-referrer`, escaped caller words, one hashed inline script, rate limits, no personal text in SMS, email or URLs. A weekly call can only be moved later within its own week, because the claim derives the following call from the clock.

**Payment seam.** `src/unblock/payment.ts` (`unblockCheckout`) is a stub: Unblock is moving to a monthly subscription and that work fills it in. Nothing in the pages or routes can set `standing` to `active`; only an authoritative provider state may. The account also holds a labelled, non-working placeholder for subscription controls. The preview simulates payment through the same seam, in memory.

## Review it

`npm run unblock:preview` opens a loopback-only walkthrough at http://127.0.0.1:8771/unblock (`UNBLOCK_PREVIEW_PORT` to change). Use synthetic information and code **000000**. Payment and calls are simulated and nothing leaves the preview; data expires after an hour. Preview controls (in the account, never mounted in production) simulate a held opening or regular call, a light call, or a missed call, so the whole arc can be clicked through, including what the closing call would read back from the light ledger.

`npm run unblock:doctor` reports configuration names and readiness only, never values.

## Open owner decisions

| Decision | Proposed baseline |
| --- | --- |
| Price | One-time, same rails as Beliefs. Amount undecided |
| Length | Opening + 4 weekly calls. A second arc is a new purchase, starting from the old ledger if the caller wants |
| Light call default | Three evenings a week, opt-out in the opening call |
| Language | English scripts here; a Norwegian pack is the likely first launch language and needs its own review — see the Norwegian lines in [articulations](articulations.md) |
| Bridge to Beliefs | Account page only, never in a call |
| Name | "Unblock" internally. Public candidates in [articulations](articulations.md) |

## Release gates

Same gates as Beliefs, unchanged: approved urgent-response procedure and staffed coverage, approved scripts, separately configured and verified voice agents, payment test mode, consent/privacy terms, and a measured pilot. This module talks about what people want and are afraid to lose — that will surface grief, regret and hopelessness more often than a commitment call does. The safety gate matters more here, not less.

What to measure in a pilot, without invented targets: whether callers can name a wish in the opening call; step outcomes by week; light-call answer rate and opt-outs; how the closing read-back lands (one open question, in their words); drop-off by week; connected minutes and cost.
