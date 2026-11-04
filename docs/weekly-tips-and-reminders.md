# In-call feature tips and one-time SMS reminders

Implemented on 3 November 2026 and revised after owner phone tests on 4 November.
Global activation remains gated by successful live verification. The English
launch copy stays in SCRIPT.md; the scoring below covers its 20 proposed phrases.

## Editorial selection

Scores are editorial assessments of usefulness, brevity, caller control and
whether the capability actually exists. They are not customer ratings or A/B
results. Only scores **strictly greater than 7** enter the live catalogue: 12
phrases. Rejected wording is absent from SCRIPT.md and cannot be selected.

| # | Proposed function or phrase | Score / 10 | Decision and reason |
|---|---|---:|---|
| 1 | Ask how the service works | 7 | Remove after owner feedback: too general to demonstrate a function. |
| 2 | Offer examples of uses for these calls | 7 | Remove: same lack of a concrete function. |
| 3 | Ask for a more direct mentor | 7 | Remove: no saved directness preference. |
| 4 | Think aloud instead of answering questions | 9 | Keep: existing conversational behaviour. |
| 5 | Take one thing at a time | 8 | Keep: clear adjustment within this call. |
| 6 | Ask for more thinking time | 9 | Keep: preserves the existing patience. |
| 7 | Ask for a shorter conversation | 9 | Keep: useful control within the current call. |
| 8 | No requirement to choose an action | 10 | Keep: already supported, removes pressure. |
| 9 | Correct memory; edit saved notes on call page | 10 | Keep: distinguishes conversation from saved-note editing. |
| 10 | Save any topic to revisit next week | 7 | Remove: arbitrary future-topic storage is not supported. |
| 11 | Choose male/female voice on call page | 9 | Keep: only when both female routes exist; applies next call. |
| 12 | Move one appointment or the weekly slot | 10 | Keep: existing account controls; no in-call scheduling promise. |
| 13 | Enable/disable occasional between-call texts | 8 | Keep: existing opt-in, same-number SMS required. |
| 14 | Arrange one text reminder now | 9 | Keep: the new explicitly confirmed one-off tool. |
| 15 | Ask when a reminder would be useful | 7 | Remove from tips: a necessary booking question, not a separate feature. |
| 16 | Choose one-time or recurring reminders | 4 | Remove: recurrence not implemented. |
| 17 | Add time to the calendar | 3 | Remove: calendar integration not implemented. |
| 18 | Arrange an extra check-in phone call | 3 | Remove: outside this tool's scope. |
| 19 | Change or stop the pending reminder in-call | 10 | Keep: full replacement or cancellation, with a server result. |
| 20 | Stop tips without stopping calls | 10 | Keep: persistent, independent preference. |

## Conversation sequence

The server returns one approved phrase. The provider prompt never contains the
entire phrase bank, so rejected or unavailable capabilities are not options.
Two sticky sequences are assigned per account:

- A: voice, scheduling, optional texts, reminder, thinking aloud,
  pace, shorter calls, no action required, correcting memory, reminder control,
  stopping tips.
- B: reminder, scheduling, correcting memory, no action required,
  voice, thinking aloud, shorter calls, pace, optional texts, reminder control,
  stopping tips.

Pace has two variants (#5/#6). Sequence A selects the
first, B the second. This is a **sequence-level experiment**: it cannot establish
which individual phrase caused a difference.

Offer at most one tip near the natural close of a substantive returning call,
after at least three minutes, and no new topic within six elapsed days of a
confirmed exposure. Skip an unfinished introduction, a difficult disclosure,
driving, haste or a request to end. Contextual restraint is a prompt requirement,
not a claim that code can diagnose the caller's emotional state. A caller may
ask about features or request a reminder during any active weekly call.

A server offer, agent-reported delivery and exact wording found in the signed
settled transcript are separate fields. Only transcript exposure advances the
normal sequence. A clear decline also consumes that topic. Topics and the chosen
arm stay in the account preference record beyond the 60-day analytics window,
so the service does not start repeating declined suggestions. `tips_off` does
not pause calls, opt into/out of between-call texts, or cancel a reminder.

## One pending reminder, changed or cancelled by voice

`weekly_assist` exposes context/status, tip reports, tip preferences,
`reminder_prepare`, `reminder_confirm` and `reminder_cancel`.

Relative requests use `after_minutes` (server clock) or `shift_minutes` plus the
current pending revision (existing due time). They cannot be mixed with each
other or absolute date/time. Proposals return the server-calculated local date,
time and timezone before explicit confirmation. Absolute appointments still use
strict wall-clock validation. Status includes local `date`/`time` as well as UTC
`now`: the owner test found the model had mistaken 10:38 UTC for 10:38 Oslo time,
so the model must not perform that conversion for relative reminders.

1. Agree exact SMS text, full local date and time in the account timezone.
2. Prepare an encrypted ten-minute draft. The existing reminder stays intact.
3. Read back the server proposal: exact text, one SMS, date, time, timezone and
   replacement of an existing pending reminder. Wait for explicit agreement.
4. Confirm the draft. Only `saved: true` confirms an effect. Changes use the same
   prepare/read-back/confirm flow. A revision conflict requires a fresh proposal.
5. To stop it, read status and cancel the current revision. Only `cancelled: true`
   permits a cancellation claim. Provider-accepted, delivered and uncertain
   messages cannot be recalled. A replacement that was already sent while its
   change was being discussed is rejected rather than silently described as changed.

The reminder is one SMS to the existing verified phone, independent of nudge
opt-in. No arbitrary recipients, daily email, recurrence, calendar access, push
notification, generated voice or extra call is introduced. Times must be two
minutes to 30 days ahead and within current trial/paid access. Nonexistent and
repeated daylight-saving times are rejected rather than silently shifted; ask
for an unambiguous different time. User-chosen times are honoured, including
outside the quiet window used for unsolicited optional texts.

The minute tick records one encrypted outbox intent per revision. A reminder
expires 15 minutes after its agreed time; no catch-up burst follows downtime.
Dispatch rechecks revision, pause, STOP, carrier opt-out, safety hold, entitlement,
same-number sender and active calls under the caller lock. Changes invalidate
pending old intent; an old claimed request also fails the revision check. An
uncertain SMS send is never automatically repeated. Provider receipt polling
updates delivery state without resending.

## A/B measurement and automatic optimization

Experiment `weekly-tips-v1` assigns A/B by a stable hash before selection, 50/50
in expectation. Each participant gets an irreversible per-arm enrollment rank;
deleted or expired participants are not replaced by later accounts in the sample.
Assignment happens when the first eligible tip is selected, whether or not the
agent ultimately says it. This is the intent-to-treat denominator.

The prespecified primary measure is any backend `conversation_completed` weekly
event from 24 hours to less than 14 days after assignment. Useful no-action
conversations are included. Backend completion is an operational proxy, not proof
of usefulness, hearing, comprehension or correct memory.

The first 100 randomized participants per arm must all finish 14 elapsed days.
No early winner is selected. The result is evaluated once and frozen, including
an inconclusive result. To promote a winner, both arms must have at least 50
participants with transcript-confirmed exposure, the winner's 95% Wilson interval
for return must lie wholly above the other's, the observed difference must be at
least five percentage points, and its tip-opt-out count must be no greater.
This conservative operational threshold is not a power calculation or a promise
that 200 accounts will resolve a small effect. Inconclusive results retain A/B.

Only **new** assignments use a winning sequence. Existing accounts retain their
arm and progress. No live copy is rewritten from a few responses. A new experiment
requires an explicit version and assignment transition and a new prespecified comparison. Deleted
accounts, 60-day analytics retention and missing exposure can make the fixed sample
unresolvable; the code then withholds a winner. Frozen aggregates contain no caller
identifier. Do not describe a winner as measured retention uplift without reviewing
the cohort and operational limitations.

`npm run quality:tips` prints aggregate sample sizes, mature accounts, returns,
opt-outs, offers, agent reports, transcript exposures and the frozen result. It
does not print numbers, reminder text or transcripts. Reminder outbox status counts
are also reported by arm within retained records; these are intents, not unique
people or reading. Use ordinary message-delivery reports to inspect failures.

## Provider setup and deployment

1. Apply migration `0029_weekly_tips_and_reminders.sql` before the new backend/tick.
2. Set a separate `WEEKLY_TOOL_SECRET` of at least 32 random characters. Keep
   `WEEKLY_TOOLS_READY=0` while configuring. Do not reuse a webhook or payment secret.
3. `npm run quality:tips -- --openapi` emits a standard OpenAPI 3.0.3 operation
   using PUBLIC_URL; it is also served at `/weekly/openapi.json`. Import/configure
   it as **weekly_assist** on every first/return male/female weekly agent.
   Every request copies attempt_id/session_token from the private weekly_context
   dynamic variable, not from caller speech. Do not attach it to Beliefs agents.
   The repository does not assume an undocumented provider tools-write schema.
   Speechify's webhook worker sends `{arguments, timestamp, tool_call_id, tool_name}`;
   the endpoint unwraps `arguments` only for `weekly_assist`, then applies the same
   attempt HMAC and authorization as a direct flat request. Mixed outer credentials
   are refused. The 4 November owner call exposed this transport mismatch: the
   model passed correct credentials, but the flat-only endpoint returned 401.
   The provider's `Speechify-Webhook-Test: true` connection probe always performs
   no action, even if it carries valid action arguments. A successful probe proves
   connectivity only; an actual call must still verify model use and delivery.
4. Sync the weekly prompts and the `weekly_context` variable using the existing
   `speechify:sync -- --group weekly` check/apply workflow. Existing custom variables
   are preserved; the existing 20-variable capacity check still applies.
5. Enable `SPEECHIFY_SEND_VARIABLES=1`, verify matching SMS/caller numbers and
   set `WEEKLY_TOOLS_READY=1` only for the configured backend. With that flag,
   `speechify:sync -- --check` requires weekly_assist as well as end_call on each
   selected weekly agent. Preflight checks the secret, variables and sender.
6. On owner-controlled devices, verify both voices/stages: spoken confirmation,
   received reminder, change, cancellation, stopped tips and signed completion.
   Synthetic tests do not establish model tool compliance or audible delivery.

The tool accepts only a short-lived active weekly attempt with its HMAC credential,
then locks the caller before the attempt, reminder and outbox. Its request ledger
returns the prior response for identical retries and rejects request-ID reuse with
different arguments. No tool accepts a phone number or hash to choose an account.
Status and cancellation remain available during holds; creating/changing reminders
does not. The tool is unavailable when setup is disabled or a call has settled.

Personal reminder, draft, receipt, assignment and exposure records are included
in account export and removed by whole-account deletion. The tick prunes drafts,
one-day receipts, 30-day terminal reminder metadata and 60-day analytics. Content
in ordinary reminder rows is cleared at acceptance/cancellation/suppression or expiry;
encrypted retry receipts can still contain the operation result for their one-day
window. Aggregate counters/results and caller tip preferences have distinct retention.

For rollback disable WEEKLY_TOOLS_READY and restore the previous weekly prompts
together. Drain/reconcile requested reminder outbox records before stopping the
new worker; older workers do not understand the reminder kind. Leave additive
tables in place until pending/uncertain records have been resolved. Do not run
old and new ticks against the same pending messages.

## Local verification

TypeScript, ESLint and diff whitespace checks pass. All **781 tests pass, with
zero skips**, against a disposable PostgreSQL 18 database. The new coverage exercises
real scheduler credential injection, HTTP proposal/confirmation, signed completion
and tip exposure, concurrent workers, replacement/cancellation, uncertain sends,
DST validation, fixed-sample promotion, export and deletion. The CLI's emitted
OpenAPI 3.0.3 JSON parses and declares weekly_assist. Provider transports are synthetic;
production tool binding, spoken compliance and handset delivery still need the
owner-device verification described above.
