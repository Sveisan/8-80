# Unblock — implemented data, event and tool contracts

Backend core, 8 November 2026. Source: `services/voice/src/unblock/{model,protocol,repository,runtime,config,readiness,coverage}.ts`, migration `0030_unblock_programme.sql`. It mirrors [Beliefs](../beliefs/contracts.md) and reuses its helpers (`wording`, `PracticeError`, caller-word matching, agreement guards, `appointmentInput`, shared outbox, caller lock, `call_attempts`). Not a launch approval; no web page, billing flow, Speechify provisioning or preview exists yet.

## Records

| Record | Contents | Notes |
| --- | --- | --- |
| `unblock_enrollments` | Owner hash, `is_current`, unique `checkout_reference`, encrypted `programme_enc` + `revision`, consent version/date, IANA `timezone` (Oslo fallback), weekly weekday/minute, `light_weekdays[]` + `light_minute`, pointers `opening_at`, `next_weekly_at`, `next_light_at`, `standing` (`awaiting_payment` default; claims need `active`), provider/purchase/payment/customer/product/paid/amount fields (set by the later billing flow), `completed_at` | Schedule and pointers are plain columns (like Beliefs); every word the caller said is only in `programme_enc`. Cascades from `callers` |
| Encrypted `Programme`, schema 1 | `state` active/paused/completed; `openingHeld`; `weeksHeld` 0-4; `wishes[]` (version, text, why, at; old versions kept); `blocks[]` (wishVersion, text, kind limit/prediction/unsure, week); `steps[]` (week 1-4, text, outcome done/partly/not/changed/null, outcomeText); `ledger[]` (week, local `occurredOn`, text, source light_call/weekly_call); `closing` (text, carryText); `light` (last spoken choice, `seq`); applied event IDs + digests; optional `contact` (never in voice context) | One aggregate under the caller lock. Altered retries conflict |
| `unblock_sessions` + `call_attempts` | Session ID is the attempt ID; kind opening/weekly/light; `week` (0 opening, 1-4); encrypted snapshot (initial + staged programme + receipts); encrypted coverage; `complete` | Open session: claimed/placed attempt, at most 45 minutes. Closed snapshot keeps revision, kind, week, event IDs, capture kinds, `canonicalVerified` only |

## Arc and scheduling

* The arc position comes only from **verified held calls**, never the calendar: opening (not held) → week `weeksHeld+1` → complete. A missed or unfinished call is not made up: the same stage is offered at the next slot ("no catch-up calls").
* One recurring weekly slot (weekday + local time + zone) serves whichever stage is next (`opening` until held, then `weekly`). An optional first-call date (`opening_at`) may precede it. Claiming an opening call sets the next weekly pointer at least 5 days ahead; after a held opening the first weekly call is the first slot at least 5 days later.
* Light calls: columns `light_weekdays` + `light_minute` (default Mon/Wed/Fri 19:00 at enrolment time, caller changes or declines in the opening call). Placed only after the opening is held, while the programme is active and unfinished, and never when the schedule is empty. Missed evenings produce no call and no text.
* Claim order (same as Beliefs): caller lock `skip locked` → pointers advance **first** → STOP / carrier opt-out / human review / payment (`standing`) / pause / completion block placement → >5 min late, within 45 min of another attempt or of the base weekly slot = `missed` (one neutral recovery notice for opening/weekly only) → unique attempt + session. Placement uses the Speechify outbound endpoint with `Idempotency-Key: unblock:{session_id}`; an unconfirmed request is never redialled (sweep closes it).
* Held-call rule (`callHeld`): opening and weekly need at least one verified save (not only `pause`); week 4 needs the verified `closing`; a light call is held whenever the caller was heard. Only a held opening/weekly call advances the arc. Verified saves from an unheld call are still kept.
* Week-4 held call sets `state=completed`, clears `opening_at`, `next_weekly_at`, `next_light_at` and sends one content-free notice. No further calls are ever claimed.

## Tool: `capture_unblock`

`POST /unblock/tool` (bounded at 24,000 bytes; Speechify `speechify-webhook-test` probes answer `{ok,probe,action_performed:false}` without acting; a webhook envelope `{tool_name:'capture_unblock',arguments:{…}}` is unwrapped, credentials still verified). Flat parameters, exported as `UNBLOCK_TOOL_PARAMS` in `protocol.ts`:

`session_id`, `session_token`, `event_id`, `caller_text` (required); `command` (`wish|block|step|step_outcome|light|closing|light_schedule|pause`), `confirmed` (boolean), `text`, `why_text`, `kind` (`limit|prediction|unsure`), `week` (integer), `outcome` (`done|partly|not|changed`), `outcome_text`, `carry_text`, `days` (comma-separated weekdays; empty = no light calls), `time` (`HH:MM`).

| Command | Allowed in | Fields (all quoted from `caller_text` except server fields) |
| --- | --- | --- |
| `wish` | opening; weekly weeks 1-3 (first wish) and week 3 (revision, new version) | `text`, optional `why_text` |
| `block` | weekly weeks 1-3 | `text`, `kind` (default `unsure`); needs an existing wish; linked to current wish version |
| `step` | opening (week 1); weekly weeks 1-3 (week + 1) | `text`; `week`, if sent, must equal the server value |
| `step_outcome` | weekly | `outcome`, optional `outcome_text`; step week is the session week |
| `light` | light, weekly | `text`; server sets `occurredOn` (caller-zone date), source and week; at most 5 per session |
| `closing` | weekly week 4 | `text`, optional `carry_text` |
| `light_schedule` | opening, weekly (days + time); anywhere to stop (no days) | `days`, `time`; chosen days must appear in the caller's words; empty days needs a no/stop word |
| `pause` | opening, weekly | needs pause/stop wording |

Guards: HMAC token per call (`unblock:session:` domain, so Beliefs tokens do not work); every save needs `confirmed:true` and agreement in `caller_text`; caller words must be contained in `caller_text`; `event_id` idempotent, altered retries conflict (`light.occurredOn` is pinned to the first attempt); week, dates and sources never come from the model. Every call (command or not) first runs the shared caller-only safety keyword check: a hit sets `held_for_review`, stores the tier on the attempt, queues a content-free tier-1 SMS and answers `{held:true,…}`; an existing hold/STOP answers `held:true` too. Responses: `{held:false}`, `{held:true,instruction}`, or `{programme,coverage,provisional:true,instruction}`. 401 invalid credential, 409 rejected/closed/stale, 413 oversized.

**Canonical save** happens only in `settleUnblock` (signed Speechify completion, routed before the weekly path): every receipt's `caller_text` must be a whole consecutive span of the **caller** turns whose last turn explicitly agrees without disagreement words; a caller keyword in the completion holds the account and commits nothing; revision/standing/pause/hold changes during the call abort the commit.

A block's `limit`/`prediction` label is only as honest as the script: the server requires explicit agreement for the save but cannot verify that the agreement covered the label, so unlabelled or unclear blocks should be sent as `unsure`.

## Variables and context

Dynamic variables: `unblock_context`, `call_kind` (`opening|weekly|light`), `week` (string: 0 opening, 1-4), `session_id`, `session_token`. `unblock_context` is JSON: `state`, `stage`, `wish` (current version only), `blocks` (current wish), `steps` (with outcomes), `last_step`, `light_calls` (enabled/days/time), `ledger_count`, `ledger_readback` (only in the week-4 weekly call), `call_context` (`preferred_name`, `call_kind`, `week`, `weekly_slot`). Support contact, event IDs, other modules and weekly memories are never included.

`ledger_readback`: at most five entries, verbatim, taken newest-first from each programme week in turn (latest week first) so the selection is both recent and spread over the weeks, then shown chronologically. Selection uses only week and timestamp — never wording.

## Sendouts (outbox kind `unblock`, suppressed under human review; SMS opt-out applies)

| Moment | Text content |
| --- | --- |
| Verified opening | Next call time + private route `/unblock/access`; nothing personal |
| Programme complete | "last call, calls have stopped, everything is in your private account" |
| Missed / unfinished / abandoned opening or weekly call | One "check or change your next Unblock call" notice per attempt; none for light evenings |
| Tier-1 keyword | Operator SMS, kind `safety`, no content |

## Shared integrations

Export: the complete owner download (`includeBeliefs` or `includeUnblock`) decodes `unblock_enrollments` and `unblock_sessions`; base links omit them and say so. Whole-account deletion cascades through `callers` / `call_attempts`. Global STOP, carrier opt-out and `held_for_review` block claims, placement and tool changes. The weekly service tool refuses Unblock session IDs, `settleConversation` routes Unblock completions before the weekly path, and the sweep closes stale Unblock sessions; none of them touch `callers.call_number`, weekly memories or Beliefs records.

## Environment

`UNBLOCK_ENABLED`, `UNBLOCK_LIVE_CALLS`, `UNBLOCK_SAFETY_APPROVED`, `UNBLOCK_SCRIPTS_APPROVED`, `UNBLOCK_AGENTS_VERIFIED`, `UNBLOCK_OPENING_AGENT_ID`, `UNBLOCK_WEEKLY_AGENT_ID`, `UNBLOCK_LIGHT_AGENT_ID`, `UNBLOCK_TOOL_SECRET`, `UNBLOCK_PRICE_VERIFIED`, `UNBLOCK_PRICE_LABEL`, `UNBLOCK_PRODUCT_ID`, `UNBLOCK_CHECKOUT_URL`, `UNBLOCK_SUPPORT_HOURS`, `UNBLOCK_COVERAGE_START`, `UNBLOCK_COVERAGE_END`. All flags default off; `unblockReadiness()` lists what is missing.
