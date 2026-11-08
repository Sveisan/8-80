# Unblock — implemented data, event and tool contracts

Backend core, 8 November 2026. Source: `services/voice/src/unblock/{model,protocol,repository,runtime,config,readiness,coverage}.ts`, migration `0030_unblock_programme.sql`. It mirrors [Beliefs](../beliefs/contracts.md) and reuses its helpers (`wording`, `PracticeError`, caller-word matching, agreement guards, `appointmentInput`, shared outbox, caller lock, `call_attempts`). Not a launch approval; the web pages (`routes.ts`, `page.ts`) and the loopback preview exist, see the [README](README.md); the subscription is `billing.ts` and `payment.ts`; the chapter calendar is `cadence.ts` and `chapters.ts`.

## Records

| Record | Contents | Notes |
| --- | --- | --- |
| `unblock_enrollments` | Owner hash, `is_current`, unique `checkout_reference`, encrypted `programme_enc` + `revision`, consent version/date, IANA `timezone` (Oslo fallback), weekly weekday/minute, `light_weekdays[]` + `light_minute`, pointers `opening_at`, `next_weekly_at`, `next_light_at`, `standing` (`awaiting_payment` default → `active` / `past_due` → `ended`; claims need `active` or `past_due`, and not a cancellation past `paid_until`), provider/purchase/payment/customer/product/paid/amount fields, **subscription**: `subscription_id` (unique), `cancel_at_period_end`, `paid_until`; **chapters**: `anchor_at` (first activation), `chapter_started_at`, `chapter`, `year`, `calls_per_month` (this chapter's, frozen), `pending_calls_per_month` (from the next chapter); `completed_at` (set when the subscription ends) | Schedule and pointers are plain columns (like Beliefs); every word the caller said is only in `programme_enc`. Cascades from `callers` |
| Encrypted `Programme`, schema 1 | `state` active/paused/completed (completed only when the subscription ends); `openingHeld`; `weeksHeld` held calls in the current chapter; `month`, `chapterCalls`, `chapterStartedAt`, `closings[]`; `wishes[]` (version, text, why, at; old versions kept); `blocks[]` (wishVersion, text, kind limit/prediction/unsure, week, month); `steps[]` (month, week = call number 1..calls, text, outcome done/partly/not/changed/null, outcomeText); `ledger[]` (month, week, local `occurredOn`, text, source light_call/weekly_call); `closing` (the current chapter's: text, carryText, month); `light` (last spoken choice, `seq`); applied event IDs + digests; optional `contact` (never in voice context) | One aggregate under the caller lock. Altered retries conflict |
| `unblock_sessions` + `call_attempts` | Session ID is the attempt ID; kind opening/weekly/light; `week` (0 opening, otherwise the call number inside the chapter); encrypted snapshot (initial + staged programme + receipts); encrypted coverage; `complete` | Open session: claimed/placed attempt, at most 45 minutes. Closed snapshot keeps revision, kind, week, event IDs, capture kinds, `canonicalVerified` only |

## Chapters and scheduling

* The position comes only from **verified held calls**, never the calendar: opening (month 1, not counted) → call `weeksHeld+1` of the chapter → chapter complete. Call n of an n-call chapter is the **close** (`week >= chapterCalls`). A missed or unfinished call is not made up: the same stage is offered at the next slot.
* **Chapter = billing month** anchored at first activation (`anchor_at`; `cadence.ts` clamps month ends). The close held completes the chapter; at the next claim after the billing month ends the programme rolls: `month+1`, `weeksHeld=0`, `chapterCalls = pending ?? calls_per_month` (pending cleared), the closing archived. A change to calls per month is `pending_calls_per_month` and applies then; before the first call of month 1 it applies at once.
* **Spread.** One weekly slot (weekday + local time + zone) serves the opening and the regular calls; 5-8 calls a month add a second day three days later (`weekdaysFor`). `planWeekly` spreads the calls still to hold over the slots left in the month (next = slot `floor(m/r) - 1` of `m` left for `r` calls), so the close lands on the last slot. When the billing month is ending or no later slot is left, the claimed call becomes the close (`chapterCalls` is lowered to its number); a missed close is therefore offered at the next slot, even in the next month, before the new chapter starts. A cancellation at period end uses `paid_until` as the end of the month; nothing is planned after it.
* Light calls: columns `light_weekdays` + `light_minute` (default Mon/Wed/Fri 19:00 at enrolment time, caller changes or declines in the opening call). Placed only after the opening is held, while the programme is active and the subscription allows calls, and never when the schedule is empty. Missed evenings produce no call and no text.
* **Scheduling rules** (`scheduleProblem`), shared by the account (schedule, calls per month, move) and by a light schedule spoken in a call (checked in the tool and again when committed): every instant inside staffed coverage, 45 minutes between a light call and any regular call (including the second day, the next month's choice and midnight wrap-around), and 45 minutes from the weekly 8&80 slot.
* Claim order (same as Beliefs): caller lock `skip locked` → subscription allows calls (`active`/`past_due`) → roll the chapter if due → pointers advance **first** (the next regular call is planned assuming this one is held; if not, the next claim plans again from what was held) → STOP / carrier opt-out / human review / pause block placement → >5 min late, within 45 min of another attempt or of the base weekly slot = `missed` (one neutral recovery notice for opening/weekly only) → unique attempt + session. Placement uses the Speechify outbound endpoint with `Idempotency-Key: unblock:{session_id}`; an unconfirmed request is never redialled (sweep closes it).
* Held-call rule (`callHeld`): opening and weekly need at least one verified save (not only `pause`); the close needs the verified `closing`; a light call is held whenever the caller was heard. Only a held opening/regular call advances the chapter. Verified saves from an unheld call are still kept.
* A held close sets the pointer to the first call of the next chapter and sends nothing, unless the subscription is ending: then no call is planned and one content-free notice says it was the last call for now. When the subscription ends (`ended`) the programme completes and every pointer is cleared; a returning subscription starts a fresh billing month.

## Subscription (`billing.ts`, `payment.ts`)

* Checkout: `unblockCheckout(reference)` = the configured hosted link (`UNBLOCK_CHECKOUT_URL`, provider host only) with the enrolment `checkout_reference` (Stripe `client_reference_id`, Lemon Squeezy custom data). Empty unless Unblock readiness holds, including the payment provider key and webhook secret.
* Webhook: the shared `/webhooks/payments` endpoint (signature already verified) calls `syncUnblockSubscription` after the Beliefs handler and before the weekly one. An event is Unblock's when its reference starts `unblock:` or its subscription id is stored on an enrolment; anything else falls through unchanged. The subscription is **re-read from the provider** (`gateway.subscription`) under the caller and enrolment locks and must carry `UNBLOCK_PRODUCT_ID` among its price/variant ids. A different subscription never replaces a live one.
* Standing: `awaiting_payment` → `active` on an active subscription (anchor and chapter clock start, stale `opening_at` and pointers refreshed, one confirmation text); a first payment that never cleared stays `awaiting_payment`; `past_due` keeps calls (as weekly); `ended` completes the programme and clears pointers; `cancel_at_period_end` and `paid_until` come from the provider and re-plan the pointers.
* Account actions (CSRF, session): `calls`, `pause`/`resume` (calls-only, **billing unchanged**: the gateway cannot pause collection), `cancel` (`gateway.cancel`, at period end), `billing` (provider portal, then `?billing=return` re-reads the subscription). `deleteAccount` cancels the Unblock subscription like the weekly one and fails closed if the provider cannot confirm.

## Tool: `capture_unblock`

`POST /unblock/tool` (bounded at 24,000 bytes; Speechify `speechify-webhook-test` probes answer `{ok,probe,action_performed:false}` without acting; a webhook envelope `{tool_name:'capture_unblock',arguments:{…}}` is unwrapped, credentials still verified). Flat parameters, exported as `UNBLOCK_TOOL_PARAMS` in `protocol.ts`:

`session_id`, `session_token`, `event_id`, `caller_text` (required); `command` (`wish|block|step|step_outcome|light|closing|light_schedule|pause`), `confirmed` (boolean), `text`, `why_text`, `kind` (`limit|prediction|unsure`), `week` (integer), `outcome` (`done|partly|not|changed`), `outcome_text`, `carry_text`, `days` (comma-separated weekdays; empty = no light calls), `time` (`HH:MM`).

| Command | Allowed in | Fields (all quoted from `caller_text` except server fields) |
| --- | --- | --- |
| `wish` | opening; weekly non-close calls (first wish); a revision (new version) only where the chapter theme allows it (`saves: wish`, `revisesWish`) or in an open call | `text`, optional `why_text` |
| `block` | weekly non-close calls | `text`, `kind` (default `unsure`); needs an existing wish; linked to current wish version |
| `step` | opening (call 1); weekly non-close calls (call + 1) | `text`; `week`, if sent, must equal the server value |
| `step_outcome` | weekly | `outcome`, optional `outcome_text`; step week is the session week |
| `light` | light, weekly | `text`; server sets `occurredOn` (caller-zone date), source and week; at most 5 per session |
| `closing` | weekly, the close (last call of the chapter) | `text`, optional `carry_text` |
| `light_schedule` | opening, weekly (days + time); anywhere to stop (no days) | `days`, `time`; chosen days must appear in the caller's words and the times must pass the scheduling rules above; empty days needs a no/stop word |
| `pause` | opening, weekly | needs pause/stop wording |

Guards: HMAC token per call (`unblock:session:` domain, so Beliefs tokens do not work); every save needs `confirmed:true` and agreement in `caller_text`; caller words must be contained in `caller_text`; `event_id` idempotent, altered retries conflict (`light.occurredOn` is pinned to the first attempt); week, dates and sources never come from the model. Every call (command or not) first runs the shared caller-only safety keyword check: a hit sets `held_for_review`, stores the tier on the attempt, queues a content-free tier-1 SMS and answers `{held:true,…}`; an existing hold/STOP answers `held:true` too. Responses: `{held:false}`, `{held:true,instruction}`, or `{programme,coverage,provisional:true,instruction}`. 401 invalid credential, 409 rejected/closed/stale, 413 oversized.

**Canonical save** happens only in `settleUnblock` (signed Speechify completion, routed before the weekly path): every receipt's `caller_text` must be a whole consecutive span of the **caller** turns whose last turn explicitly agrees without disagreement words; a caller keyword in the completion holds the account and commits nothing; revision/standing/pause/hold changes during the call abort the commit.

A block's `limit`/`prediction` label is only as honest as the script: the server requires explicit agreement for the save but cannot verify that the agreement covered the label, so unlabelled or unclear blocks should be sent as `unsure`.

## Variables and context

Dynamic variables (unchanged): `unblock_context`, `call_kind` (`opening|weekly|light`), `week` (string: 0 opening, otherwise the call number inside the chapter), `session_id`, `session_token`. `unblock_context` is JSON: `state`, `stage`, `chapter` (`number`, `year`, `title`, `calls_this_month`, `call`), `chapter_theme` (weekly calls), `is_close`, `sign_off` (`mode` continue/paused/ending, `next_chapter_title` after a close, `next_call_local`, `next_call_weekday`), `wish` (current version only), `blocks` (current wish), `steps` (this chapter, with outcomes), `last_step`, `light_calls` (enabled/days/time), `ledger_count`, `ledger_readback` and `month_words` (steps, moments, blocks of this chapter; only in the close), `call_context` (`preferred_name`, `call_kind`, `week`, `weekly_slot`). Support contact, event IDs, other modules and weekly memories are never included.

`ledger_readback`: at most five entries of the current chapter (for the year chapter: of the current year, one per chapter in turn), verbatim, taken newest-first from each call number in turn (latest first) so the selection is both recent and spread, then shown chronologically. Selection uses only call number, chapter and timestamp — never wording.

## Sendouts (outbox kind `unblock`, suppressed under human review; SMS opt-out applies)

| Moment | Text content |
| --- | --- |
| Verified opening | Next call time + private route `/unblock/access`; nothing personal |
| Subscription confirmed | "your Unblock subscription is confirmed" + the private account route |
| Last call of an ending subscription | "last call for now, calls have stopped, everything is in your private account" |
| Missed / unfinished / abandoned opening or weekly call | One "check or change your next Unblock call" notice per attempt; none for light evenings |
| Tier-1 keyword | Operator SMS, kind `safety`, no content |

## Shared integrations

Export: the complete owner download (`includeBeliefs` or `includeUnblock`) decodes `unblock_enrollments` and `unblock_sessions`; base links omit them and say so. Whole-account deletion cascades through `callers` / `call_attempts`. Global STOP, carrier opt-out and `held_for_review` block claims, placement and tool changes. The weekly service tool refuses Unblock session IDs, `settleConversation` routes Unblock completions before the weekly path, and the sweep closes stale Unblock sessions; none of them touch `callers.call_number`, weekly memories or Beliefs records.

## Environment

`UNBLOCK_ENABLED`, `UNBLOCK_LIVE_CALLS`, `UNBLOCK_SAFETY_APPROVED`, `UNBLOCK_SCRIPTS_APPROVED`, `UNBLOCK_AGENTS_VERIFIED`, `UNBLOCK_OPENING_AGENT_ID`, `UNBLOCK_WEEKLY_AGENT_ID`, `UNBLOCK_LIGHT_AGENT_ID`, `UNBLOCK_TOOL_SECRET`, `UNBLOCK_PRICE_VERIFIED`, `UNBLOCK_PRICE_LABEL`, `UNBLOCK_PRODUCT_ID` (the recurring price id / variant id), `UNBLOCK_CHECKOUT_URL` (the hosted subscription link), plus the shared payment provider settings (`BILLING_PROVIDER`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` or `LEMONSQUEEZY_API_KEY` + `LEMONSQUEEZY_WEBHOOK_SECRET`), `UNBLOCK_SUPPORT_HOURS`, `UNBLOCK_COVERAGE_START`, `UNBLOCK_COVERAGE_END`. All flags default off; `unblockReadiness()` lists what is missing.
