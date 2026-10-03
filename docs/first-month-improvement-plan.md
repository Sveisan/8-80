# 8&80 first-month improvement plan

Started 2 October 2026 from the audit of commit `2d6b561d76d7`. Implementation branch: `codex/first-month-journey`.

The aim is a coherent month in which people understand the service, experience a useful first conversation, see accurate follow-through, and can change or end the arrangement easily. The first release fixes broken promises. Later releases refine the experience using research and measured behavior.

Working activation definition: a meaningful first conversation ends with a read-back the caller accepts and an action they chose. Continuity is demonstrated when a later conversation accurately recalls that action and helps decide the next step. These are workshop hypotheses, not existing analytics events.

The [audit](first-month-audit.md) and [baseline inventory](first-month-sendouts-baseline.md) are included in this repository. The [current journey and workshop kit](first-month-journey.md) describes the proposed experience. They describe the starting revision; this plan records subsequent changes.

## Delivery sequence

| Phase | Scope | Acceptance gate | Status |
| --- | --- | --- | --- |
| 1. Scheduling that keeps its promises | Correct skip; explicit replacement times; real dates in confirmations; late-night booking defaults; selected-time visibility. | A named appointment can be skipped once without altering the weekly arrangement. No vague “later” request silently schedules a call. The selected time remains visible. | Implemented and verified locally |
| 2. A dependable way back | Phone-verified access recovery; fresh control links in recaps; an account home that shows the actual appointment and paused/trial/paid state. | On day 15, a person on a new device can reach and understand their controls without signing up again. | Implemented and verified locally |
| 3. A complete first conversation | Separate onboarding progress from provider call completion; preserve onboarding after availability-only calls; align callbacks and recaps; improve booking and OTP recovery. | Rescheduling a 25-second first call preserves the first-call experience and produces accurate appointment information. | Implemented and verified locally |
| 4. Clear continuation and exit | Visible trial end and price; correct payment-update destination; payment confirmation; distinct pause/cancel/delete behavior; complete export and deletion semantics. | A paid caller can stop renewal deliberately and verify the outcome. Deletion cannot leave an unhandled provider subscription. | Local controls implemented and verified; actual provider, price and policy checks pending |
| 5. Reliable, restrained messages | Durable delivery records, retry/deduplication, correct suppression and destinations, feedback eligibility and recovery. | Every automatic notice has a durable outcome, bounded retries under verified provider semantics, or an explicit suppression/failure/review state. | Implemented and verified locally |
| 6. Coherent interface and measurement | Test the complete month; refine the proposition and screens; measure activation, continuity, control success and delivery; validate with users. | A complete month and recovery branches pass engineering checks; real participants validate expectations before rollout. | Engineering and workshop kit complete; participant validation pending |

Each phase produces a reviewable change and appropriate tests. A completed local change is not a production release. Production configuration and provider behavior must be checked before rollout.

## Phase 1 — scheduling

- **S1 — Skip a named appointment.** The web form names and submits the appointment it showed. The database checks that it is still current under a lock before advancing. Repeated or stale submissions cannot skip an additional occurrence. Preserve the weekly slot and pause state. Confirm the actual next date and timezone.
- **S2 — Keep text intent explicit.** A bare text such as “skip this week” means the current local Monday–Sunday week. After an already missed call it must not remove next week's call. The web action says “Skip this call” and targets its displayed appointment instead of inferring a calendar week.
- **S3 — Require a chosen replacement time.** Remove the eight-hour interpretation of “later”. The web page directs the person to its date/time controls; text replies request a day and time. Existing explicit moves remain available. A legacy “later” form cannot schedule an overnight call.
- **S4 — Correct initial defaults.** After today's final bookable slot, select tomorrow morning, not this morning next week. Apply the same rule to the browser-local default. Show a calendar date in appointment confirmations.
- **S5 — Keep the chosen time visible.** Calculate scroll positioning relative to the time strip on signup and controls; verify phone and desktop widths and keyboard interaction.

Regression cases: upcoming weekly call; one-off callback; already-missed call; duplicate submission; stale page after a move; pause/expired trial; Monday and Sunday boundaries; Oslo daylight-saving transitions; Friday signup after 22:00; time selection on narrow and wide screens.

## Phase 2 — access and account state

- **A1:** Add a dedicated phone-code recovery flow using the existing verification primitives, with rate limits and clear resend/change-number recovery. Do not restart trials or rewrite schedules during recovery.
- **A2:** Link recaps to a recoverable control destination. Expired browser and SMS-link pages offer a working route back. Keep purpose-scoped credentials and deliberate expiry rather than making bearer links permanent.
- **A3:** Render the actual next appointment, timezone, pause and billing state. Show the appropriate primary action for each state. Reopening a stopped page must still show it as stopped.
- **A4:** Show a masked delivery address; decide the verification level for viewing or correcting private context. Keep sensitive content off lightly authenticated screens.
- **A5:** Add clear completion states and navigation back to the account home after changes.

Tests cover new-device recovery, expired links, wrong and repeated codes, unchanged schedule/trial during recovery, cross-site requests and all account states.

## Phase 3 — first call and first value

- **O1:** Introduce an explicit onboarding-completion model. Decide how existing callers are migrated without replaying onboarding indiscriminately. A call attempt or transport completion cannot itself establish activation.
- **O2:** Classify availability-only rescheduling separately. Preserve first-call routing; schedule the callback before producing appointment information; avoid a normal no-commitment recap for a conversation that never began.
- **O3:** Use the actual next appointment consistently in recap, voice follow-up and account page. Distinguish one-off callbacks from the standing weekly slot.
- **O4:** Preserve booking choices through OTP errors, resend and number corrections. Replace misleading rate-limit success wording with an actionable state that does not expose other accounts.
- **O5:** Clarify the weekly AI-call proposition before booking. Explain duration, recap, free-month terms and eventual cost. Reconcile the required name with its actual use. Keep call disclosure and public wording consistent.
- **O6:** Provide a way to correct a mistaken commitment or remembered goal with suitable verification, rather than an append-only goals box.

Tests cover a 25-second reschedule, a meaningful call without an action, failed or silent calls, duplicate webhooks, partial memory, a changed appointment and an accurate returning conversation.

## Phase 4 — billing, data and leaving

- **B1:** Expose the trial end and continuation choice before expiry in the existing account/recap surfaces. Keep the current 30-day policy until a different policy is agreed. Do not invent pricing or add a card requirement.
- **B2:** Validate the configured checkout provider, price, return path, caller matching and customer portal. “Update the card” must open the appropriate existing customer flow. Missing configuration must not produce a letter referring to an absent link.
- **B3:** Distinguish pausing calls, cancelling renewal, stopping optional contact and deleting data in the interface and copy. Treat explicit subscription-cancellation requests as billing intent; do not acknowledge cancellation after only setting a pause flag.
- **B4:** Make payment and cancellation handling idempotent and confirm the resulting service state and next appointment. Payment must not silently undo a user pause.
- **B5:** Coordinate deletion with provider subscriptions and retention responsibilities before losing the identifiers needed to resolve them. Reconcile the export's “everything” claim with every stored personal-context field. Report export failures honestly.
- **B6:** Reconcile Terms, Privacy, FAQ, script and support instructions with implemented behavior. Obtain appropriate review for policy changes.

Tests use provider test mode or signed fixtures for checkout, duplicate/out-of-order webhooks, payment failure, cancellation, pause plus payment, export and deletion. Live money and customer data are outside local verification.

## Phase 5 — message lifecycle

- **M1:** Introduce a transactional outbox with a stable event identity, channel, recipient, template, attempt history and retry state. Separate intended, accepted and delivered outcomes.
- **M2:** Apply it to recaps, recovery texts, trial/payment notices and feedback. Cover crashes between state changes and sending. Verify provider idempotency capabilities before choosing a retry policy.
- **M3:** Define suppression per message type, including paused callers, carrier opt-out, deletion and feedback flags. Replace the partial text-spacing check with a shared record of actual outbound contact where appropriate.
- **M4:** Cover silent calls, stale attempts and service outages with deliberate recovery rules. Do not automatically ring people outside an agreed arrangement to catch up a backlog.
- **M5:** Repair feedback claim-before-send failure behavior while retaining one successful survey request and the human-review boundary for flagged calls.
- **M6:** Reconcile every template and destination in the inventory: ALWAYS syntax, caller number, reply support, link lifetime, time promises, restart promises and address corrections.

Gate: fault injection proves that retries do not duplicate customer messages or lose required notices; operational monitoring exposes unresolved delivery failures.

## Phase 6 — workshop, design and measurement

Use the audit's two-hour workshop with product, design, engineering and someone who hears customer conversations. Walk through a happy month and the missed-first-call, day-15 recovery, paused-paid and trial-expiry branches.

Decisions to record before the affected implementation:

1. Confirm the activation and continuity definitions and the intended initial audience.
2. Decide whether the trial remains 30 days or promises a number of meaningful conversations; define treatment of service failures.
3. Decide whether first appointment and recurring slot are separate choices.
4. Confirm price, billing period, cancellation timing and the exact meaning of pause.
5. Decide which personal context may be viewed or corrected under each verification level.
6. Decide whether reminders are optional, contextual or absent. Start with quiet between calls; add messages only for a demonstrated need.
7. Confirm the language/voice choices that are actually supported.

Design booking, confirmation, the returning account page and recovery together. Keep one clear primary action per state and the current restrained visual direction. Test with first-time visitors and returning callers; measure task completion, wrong turns and expectation mismatches.

Instrument a minimal privacy-conscious funnel: landing → booking submitted → phone verified → appointment due/rang → meaningful first call → recap delivered → meaningful return call → trial ended → continuation. Also measure time to value, memory accuracy, appointment reliability, control-task success and delivery failures. Establish a baseline before setting numerical targets or claiming conversion improvements.

## Release gates

- Source/type/lint checks and focused regression tests pass; database-dependent changes are exercised against a disposable database where available, and any unrun checks are explicit.
- Desktop and phone layouts, keyboard use, error states and back navigation are checked for changed screens.
- The deployed commit, active voice agents/prompts, dynamic variables, caller/SMS number match, inbound SMS, email delivery, checkout/portal and support process are verified in a controlled environment.
- Review migrations, rollback and customer impact for each phase. Keep changes small enough to isolate failures.
- No automatic production deployment or real sendouts are part of this initial local implementation.

## Progress log

- **2 October 2026:** Complete source audit and local document recovery available. Branch created. Phases 1–3 implemented locally; phases 4–6 remain planned.
- **Phase 1 completed:** S1–S5 are implemented. Skip uses a database row lock and checks the named occurrence; SMS skip respects the current local week. Repeated/stale web requests do not skip additional appointments. “Later” requests a specific time without changing the schedule. Signup defaults advance to tomorrow after the final available time. Appointment copy includes dates and timezone. Time-strip centering works on the checked desktop and phone widths.
- **Additional boundary protection:** The new returning-page next-call line only shows a future appointment that pause and billing permit. Skipping the final trial appointment confirms that no calls remain in the free month instead of promising a post-trial call. Local-midnight conversion uses a 00–23 hour clock to avoid advancing a calendar day accidentally.
- **Validation:** `npm run check` passed: typecheck, lint and **481 tests, 0 failures, 0 skips**, using a disposable local PostgreSQL 18.4 database. Test runtime came from [embedded-postgres](https://github.com/leinelissen/embedded-postgres); it was installed under `/private/tmp`, not added to application dependencies. Regression coverage includes duplicate submissions, stale pages, missed calls, one-off callbacks, pause/trial expiry, week boundaries and daylight saving. Browser checks covered signup, returning controls and first-call confirmation at 1280 and/or 390 pixels; selected times were visible, the phone views had no horizontal overflow, and arrow-key time selection worked. Evidence is in `audit/phase1-check.log` and `audit/phase1-*.png` in the workspace.
- **Phase 1 release state:** Local, uncommitted changes on the implementation branch; phase 1 required no schema migration. The original audit remains a snapshot of the starting commit.
- **Phase 2 completed locally:** A1–A5 are implemented. The remaining personal-context viewing/editing policy stays a workshop decision; this phase keeps that content off the control page. Details and release requirements follow.
- **Next:** Phase 3: first-call continuity, meaningful onboarding completion and accurate callback/recap promises. Billing cancellation/deletion, durable delivery and workshop policy decisions remain in their planned phases.

## Phase 2 delivery record — 2 October 2026

| Journey | Implemented behavior |
| --- | --- |
| Return from a recap | Both HTML and plain text link to `/me`. The destination contains no phone number or bearer credential. |
| New device or expired session | `/me` and expired SMS links offer `/access`. The signup page has a returning-caller link; the home address opens recovery when signup is closed. |
| Phone verification | Recovery has separate storage from signup. Codes work once, expire after ten minutes and allow five attempts. Requests are limited to three per number per hour, at least a minute apart; number limits persist across service restarts. Client send and verification limits are also applied. |
| Resend, typo or failed delivery | Resend and number correction are visible. An early resend keeps the existing code-entry form. Unknown numbers receive the normal generic response without being enrolled or texted. A configured-provider failure is shown as a failure and invalidates the challenge. |
| Successful recovery | The caller's full stored row and any pending signup remain unchanged. A fresh reschedule credential opens the controls, and a separate week-long browser cookie remembers the device with narrower permissions. |
| Paused or expired account | The page reads current state on every visit. A paused first-call page also stays paused. Resume is explicit and available only while billing permits calls. Trial end date and timezone, active subscription, overdue payment and complimentary status are shown separately from pause. |
| Appointment promises | Only an eligible future appointment is shown. Web moves are checked atomically against pause and the requested time's trial eligibility; a stale or concurrent move cannot unpause calls. |
| Delivery address | A recognisable masked address is shown. The full address, stored commitments and goals do not appear in the page markup. |
| Completion | Move and skip confirmations link back to the same authorised controls. Saving an address and pause/resume render the resulting account state. |

The new schema migration is `0013_access_codes.sql`, with its generated Drizzle snapshot and journal entry. Recovery rows contain hashed phone identifiers and hashed codes, never plaintext numbers or codes. The tick removes rows one hour after their latest request; account deletion also removes them. Recovery credential creation and account deletion use the same caller-row lock so concurrent deletion cannot leave new access behind.

Fresh phone verification gives the same account-control authority as a newly issued SMS link. Remembered browsers still cannot export or delete directly; they offer fresh verification. Existing export completeness, billing-provider deletion and delivery guarantees remain phase 4/5 work, not claims made by this release.

Validation: `npm run check` passes typecheck, lint and **503 tests, 0 failures, 0 skips**, against a disposable local PostgreSQL 18.4 database. New checks exercise recovery without reenrolment, code expiry/replay, concurrent sends and verification, deletion races, purpose separation, client and phone limits, malformed/oversized forms, SMS failure, expired credentials, cross-site posts, trial boundaries, masked HTML and state persistence. The real browser test exposed and fixed `Origin: null` on forms using the existing `no-referrer` policy: it is accepted only with browser-provided same-origin Fetch Metadata.

Browser verification used synthetic accounts and fake SMS, with no real calls, emails or texts. At 390px, recovery → early resend → verification → paused account → explicit resume → skip → confirmation → back → pause → reopen completed successfully. Desktop controls were checked at 1280px; tested pages had no horizontal overflow. Keyboard focus moved from code entry to its submit button. Evidence: workspace `audit/phase2-check.log`, `audit/phase2-*.png`, and `audit/phase2-preview.mts`.

### Phase 2 release requirements

1. Apply `npm run db:migrate` before updating the control service and tick. The added table is independent of existing caller data; migration execution has been verified locally.
2. Confirm the production `PUBLIC_URL`, SMS credentials and sender, HTTPS cookie behavior, support address and proxy client-address handling. Client limits trust the last forwarded hop only from the local proxy. Check the actual proxy chain with separate clients before release.
3. Perform a controlled real-device delivery and recovery check, including carrier opt-out, an expired link and a browser opened from a recap. Provider delivery and production configuration have not been verified here.
4. Keep the current trial and subscription policies. Expired and overdue accounts offer the configured support contact; an unverified checkout or customer portal is not presented as a working continuation flow.
5. For rollback, revert the application code, invalidate/clear recovery challenges and leave the additive table empty until the feature is restored. Existing caller data needs no schema rollback.

**Release state:** Local, uncommitted changes on `codex/first-month-journey`. The migration was applied only to disposable test schemas. No production deployment or real customer sendout has occurred.



## Phase 3 delivered — first-call continuity

Implemented locally on 2 October 2026. These changes cover O1–O6; the actual paid price and checkout remain Phase 4 work. This is not a production release or a claim of improved conversion.

| Situation | Result now |
| --- | --- |
| A first call is moved after 25 seconds | Store the callback before sending its dated confirmation. No ordinary recap or call-counter advance. The callback still uses the first-call agent. |
| The introduction ends before confirmation | Keep onboarding pending or in progress. Carry any stored map/action into the continuation instead of treating the call count as completion. |
| The caller confirms the map but declines an action | Complete the introduction. Choosing an action remains voluntary; this does not satisfy the workshop's proposed activation definition by itself. |
| A normal conversation ends with a callback | Both confirmation and recap use the accepted callback date and timezone. The recurring slot stays separate. |
| No eligible next call exists | Do not promise a next-week call. The voice prompt has an unscheduled close; the recap omits the appointment promise. |
| Signup code is wrong, expired or too frequently requested | Preserve the number, email, weekly day/time and timezone. Offer resend or booking correction. Send limits and verification limits explain the relevant wait without claiming a new text was sent. |
| An existing caller goes through signup again | Treat successful verification as access recovery. Preserve their trial, pause, slot and context; do not send another welcome. |
| Welcome SMS fails after verification | Keep the successful booking and open its confirmation with a delivery notice. Carrier opt-out still pauses calls. |
| A remembered commitment or goal is wrong | A fresh phone code opens a private editing session for 15 minutes. Changes apply to subsequent calls; stale forms cannot overwrite newer notes. Finish closes the session immediately. |

The booking screen now explains the weekly AI call, roughly ten-minute first call, shorter later calls, email recap, 30-day free period, no card requirement and continuation choice before payment. The unused required name field is removed. A paid amount is not invented.

### Model and limits

- Caller progress is explicit: `pending`, `in_progress`, `complete`, or `legacy`. Completion requires the full map read-back, a caller turn, and the new confirmation line in a later agent turn. This is a transcript-based flow marker, not evidence that the person obtained value or that the model interpreted every answer correctly. Review real consented examples before rollout.
- Migration `0014_onboarding_progress.sql` preserves returning routing for existing callers whose call counter exceeds one, marking them `legacy` with no invented completion timestamp. It cannot retrospectively identify every old availability-only call. Review that cohort separately before choosing any remedial outreach or replay.
- The short-call boundary remains 90 seconds. A short call without a map or commitment is interrupted; with a callback agreement it is rescheduled. A longer exchange without an action can remain a completed conversation while onboarding stays unfinished. Empty or missing caller speech does not establish a verified conversation. These are explicit, testable heuristics for the workshop to refine.
- Saved context is carried forward. Speech before a usable read-back is not newly inferred or retained by this change. An interruption before the first stored map may require asking for those missing parts again.
- Private-note review uses the recommended fresh-code/15-minute-session design as a local working assumption. The user has not selected a different verification option; the workshop should confirm this choice. Ordinary SMS/account credentials never expose these fields. An edited commitment clears its old named deadline; blank input removes the corresponding note.
- OTP drafts are recoverable for an hour through an opaque capability. Codes expire after ten minutes, allow five guesses and are consumed atomically. Once the draft itself expires, the page directs the person back to booking without claiming their choices are still saved. Scheduled cleanup removes old drafts. Signup's request counters remain process-local; making limits consistent across multiple replicas remains an operational follow-up.
- Durable delivery, crashes during settlement, delayed provider events, silent-call recovery and provider suppression remain Phase 5 work. These changes do not claim exactly-once delivery under crashes or prove that a provider-accepted text reached a phone.

### Verification and evidence

`npm run check` passes against disposable PostgreSQL 18.4: TypeScript, lint and **525 tests, zero failures, zero skips**. The added regressions cover callback continuity, partial/unconfirmed memory, confirmation without an action, duplicate provider events, no caller speech, real next appointments, trial eligibility, the actual migration on pre-upgrade rows, concurrent OTP verification, preserved signup choices, resend limits, welcome failures and private-note authorization/conflicts/expiry/deletion.

Browser checks used synthetic accounts and fake sendouts at 390px and 1280px. The tested path was booking → wrong code → early resend → edit number → preserved time → verification → accurate confirmation; then account → fresh verification → view/correct notes → save → finish → fresh verification required again. Phone layouts had no horizontal overflow; time selection and the note-save action worked with the keyboard. Screenshots were visually inspected. No real calls, emails, texts or payments were made.

Workspace evidence: `audit/phase3-check.log`, `audit/phase3-migration-check.log`, `audit/phase3-*.png` and the synthetic `audit/phase3-preview.mts`. Reviewable provider prompts and their variable lists are in `audit/phase3-first-prompt.txt`, `audit/phase3-returning-prompt.txt` and the corresponding `*-variables.txt` files.

### Phase 3 release requirements

1. Apply the additive 0013 and 0014 migrations before starting services that read the new fields. The upgrade/backfill was tested on synthetic existing callers. Review a production backup and counts by onboarding state before rollout.
2. Coordinate the service/tick deployment with **both** Speechify prompts and variable declarations. First-call variables: `onboarding_progress`, `own_eight`, `own_eighty`, `own_goals`, `last_commitment`, `next_appointment`, `booked_slot`. Returning variables: `next_appointment`, `call_number`, `last_commitment`, `last_belief`, `weeks_undone_running`, `own_eight`, `own_eighty`, `own_goals`, `last_day`. Keep dynamic-variable sending enabled. The script's `next_slot` placeholder is filled from provider variable `next_appointment`; they must not share a name.
3. Freeze new call placement during that coordinated update. An old first-call prompt never speaks the new completion marker; deploying only the backend would leave new introductions unfinished. Verify an interrupted introduction, a confirmed introduction without an action, a callback and an expiring-trial close on a controlled real device before reopening enrollment.
4. Confirm HTTPS, cookie scope and expiry, actual SMS delivery, cleanup scheduling and the updated factual Privacy wording. The memory session is separate from the week-long ordinary browser session. The support and paid-continuation flow still need Phase 4 review.
5. Roll back code and both prompts together with call placement paused. Leave additive columns in place. Do not resume ordinary call-counter routing for new `in_progress` callers without review, because the old code would lose their continuity. No production migration or provider change was performed here.

The Phase 4 delivery record follows. Phases 5 and 6 are recorded at the end of this document. The open billing release checks below remain mandatory before paid enrollment.

## Phase 4 delivery record — 3 October 2026

The billing and account-exit controls are implemented locally. No payment provider is configured in this workspace, and no actual price, product, tax display or hosted checkout has been verified. B1's actual price presentation and B2's end-to-end provider validation remain open release checks. B6's operational copy is updated as a draft; this is not legal approval.

| Journey | Implemented behavior |
| --- | --- |
| Before the free month ends | Account controls show the trial end; call recaps include its date. The 30-day, no-card trial policy is preserved. |
| Choose continuation | “See the price and continue” appears only with a provider-owned HTTPS checkout URL, the selected provider's API key and webhook secret, and an HTTPS public account URL. These checks establish configuration presence, not a verified price or functioning provider account. With missing configuration, the page offers support. No amount is invented. |
| Pay or change the card | Trial/payment notices lead to recoverable `/me` controls. Existing subscribers use their customer portal rather than another checkout. Phone-verified authority is required for billing management and cancellation. |
| Return from the provider | A return URL does not grant access. The page retrieves the current subscription if it is already linked; otherwise it shows confirmation as pending. |
| Receive duplicate or delayed payment events | Read authoritative provider state under the caller-row lock. An old “paid” event cannot restore a subscription the provider now reports as ended. Provider failures return a retryable response. Ordinary duplicate events do not repeat transition confirmations. |
| Pay while calls are paused | Preserve the pause. The confirmation explains that payment does not restart calls; an explicit eligible restart is required. |
| Cancel renewal | Show one deliberate confirmation, then ask the provider to stop renewal. Preserve available paid access and the existing pause state. Show the provider's end date/time. An unconfirmed response is reported as unconfirmed. |
| Cancel by text | Explicit subscription intent such as “CANCEL MY SUBSCRIPTION” invokes billing cancellation. Bare STOP/CANCEL retains carrier call-stop semantics and explains the separate renewal action. Twilio signatures are verified before account mutations. |
| Paid access ends | The scheduler, account page, skips, moves and restarts enforce the paid boundary, even before a final provider event arrives. SMS START cannot promise an ineligible appointment or restart an ended account. |
| Stop optional contact | A separate feedback preference suppresses future survey selection without changing calls, recaps, booking texts, verification codes or billing notices. |
| Ask for a copy | Export includes remembered map/action/goals/belief, onboarding and billing state, complete call-attempt history, feedback, linked retained transcript deliveries, pending signup and access-expiry metadata. Authentication codes and bearer credentials are excluded. Failed delivery gives a retry/support page rather than claiming success. |
| Delete the account | Stop future calls immediately, then require provider confirmation of non-renewal before erasing the application records and credentials. If billing cannot be confirmed, keep the account paused and retain the identifiers needed to resolve it. Provider transaction records remain with the provider; deletion does not automatically refund payment. |

### What remains for provider validation

Neither Stripe nor Lemon Squeezy is selected by this work. Both adapters have fixture coverage. Hosted checkout remains the existing provider-owned model; the application does not create a fresh checkout session or retrieve its price for an inline price display.

Before opening paid enrollment, record the chosen provider, actual product and recurring amount/currency/interval, tax handling and customer-facing terms. Use provider test mode to complete a real hosted checkout from a synthetic account, confirm caller-reference matching, and return to `PUBLIC_URL/me?billing=return`. Verify the portal configuration, card update, renewal cancellation, paid-period end, failed payment, paused payment, delayed confirmation and deletion. Test API credentials and webhook subscriptions together. Presence of environment variables must not be treated as this sign-off.

The application refuses to silently replace a live subscription with a different purchase. Reused or concurrently opened hosted links can still create an extra subscription at the provider. Resolve those purchases explicitly; this implementation does not guarantee prevention or automatic refunds. Keep the webhook endpoint on one selected provider. Switching providers while both retain active subscribers requires a plan for receiving both vendors' events and reconciling the existing cohort.

### Verification

`npm run check` passes TypeScript, lint and **549 tests, zero failures, zero skips**, against disposable PostgreSQL 18.4. Added checks cover canonical current state, signed duplicate and delayed webhooks, retry after provider outage, API request shapes and allowed destinations, cancellation/portal behavior, pause preservation, paid-period boundaries, incoming SMS signatures on a separate webhook hostname, deletion failure/success, complete export, feedback preference, and applying the actual migrations to synthetic pre-upgrade rows.

Browser checks used fake providers and synthetic accounts at 390px and 1280px. Checked cancellation → confirmation → retained pause; optional feedback changes; export failure and back navigation; provider portal failure; deletion failure with stopped calls and retained controls; successful deletion and revoked links; pending payment; trial date and expired paid access. The checked layouts had no horizontal overflow, the cancellation form supported keyboard navigation, and screenshots were visually inspected. External provider navigation and actual sendout delivery were not exercised.

Workspace evidence: `audit/phase4-check.log`, `audit/phase4-journey-test.log`, `audit/phase4-preview.mts` and `audit/phase4-*.png`. The original workshop brief and sendout inventory still describe the audited starting revision; this delivery record describes the local changes.

### Release requirements and remaining limits

1. Apply additive migrations `0015_billing_lifecycle.sql` and `0016_feedback_preference.sql` after 0013/0014 and before updated services run. The migration classifies recognised Stripe and Lemon Squeezy identifiers but does not invent renewal dates or cancellation state. Reconcile existing subscribed accounts with the provider before enabling call placement; newly added defaults alone cannot establish whether an older subscription was already cancelled.
2. Configure the selected provider's checkout URL, API key and signing secret, the HTTPS `PUBLIC_URL`, and the provider's return URL/customer portal. API access must support subscription retrieval, cancellation and portal management. Complete the provider/price checks above before exposing paid checkout to customers.
3. Configure `TWILIO_SMS_WEBHOOK_URL` to the exact public URL registered in Twilio if its host differs from the account site. Otherwise signature validation uses `PUBLIC_URL` plus the request path. Check a real signed delivery through the deployed proxy. Unsigned requests are rejected before any changes.
4. Review Terms and Privacy for the selected provider and operating company, including withdrawal information, pricing disclosures and retention. The code changes do not establish legal compliance. No new price, discount, win-back offer or change to the 30-day trial was introduced.
5. The Phase 5 outbox below now closes the local state-to-notice crash gap. Export size/provider delivery still needs controlled provider validation. External acceptance can remain uncertain; the system does not promise universal exactly-once delivery.
6. Provider requests have bounded timeouts and hold a caller-row lock while synchronising. Queueing, reconciliation after prolonged outages, actionable alerts and persistent records of failed deletion requests remain operational follow-ups. A provider response lost after successful cancellation is shown as unconfirmed; retry reads current provider state before repeating the mutation.
7. Rollback requires care: older code does not enforce the new paid-period boundary and can delete billing identifiers without cancellation. Pause call placement and disable destructive controls before reverting; preserve the additive columns and provider identifiers until reconciled. Review any cancellation already accepted by the provider before resuming old code.

Provider contracts were checked against primary documentation: Stripe documents unordered webhook delivery and recommends fetching current resources when needed ([webhooks](https://docs.stripe.com/webhooks)); the adapter uses period-end cancellation ([subscription update](https://docs.stripe.com/api/subscriptions/update)) and customer-specific portal sessions ([portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create)). Lemon Squeezy describes cancelled subscriptions retaining access until their end ([subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object)), its cancellation operation ([cancel subscription](https://docs.lemonsqueezy.com/api/subscriptions/cancel-subscription)) and signed customer portal URLs ([customer portal](https://docs.lemonsqueezy.com/guides/developer-guide/customer-portal)). Incoming SMS validation uses the Twilio SDK and configured public request URL ([webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)).

**Release state:** Local, uncommitted work on `codex/first-month-journey`. No production migration, deployment, customer sendout, provider-account change or real payment has occurred. The following delivery record supersedes that intermediate state; provider, pricing and policy decisions remain open.


## Phases 5 and 6 delivery record — 3 October 2026

The automatic message lifecycle, engineering validation and workshop materials are complete for PR review. This closes local implementation, not the provider sign-off or participant research gates. No production change or actual customer contact was made.

- State and queued notices commit together for new enrollment, call settlement, trial expiry, canonical billing updates, feedback and inbound scheduling replies. An injected database failure rolls back the call counter and settlement claim with its message. Externally accepted billing actions are recovered by canonical reconciliation rather than a false distributed-transaction claim.
- Queued, accepted, delivered, uncertain, failed and suppressed outcomes are distinct. Resend retries carry stable keys within its documented window. Ambiguous SMS results require operator review. A file/no-op diagnostic transport cannot claim production delivery.
- Before a send, recheck account deletion, carrier opt-out, call pause, feedback preference, persisted safety flags, code validity, billing state, email changes and dated SMS appointment changes. Feedback uses shared SMS contact history and cannot outlive its six-hour relevance window. Silence and stale calls receive a recovery route, without an automatic late call.
- Private payloads are encrypted and cleared after acceptance/suppression or expiry cleanup. Delivery metadata lasts 30 days; new operational milestones/counts last 60. Deletion and export cover the new records without exporting codes or bearer links. Feedback has no sent timestamp before provider acceptance.
- `npm run messages` provides delivery diagnostics and deliberate resolution commands. `npm run journey` provides an aggregate baseline and cohort read-back proxies. It contains no account identifiers in its output and makes no unique-visitor, retention-uplift or user-value claim.
- The [current journey](first-month-journey.md) includes all application sendout families, destinations, recovery routes, a two-hour workshop, decision log and task-based research protocol. Feedback completion/expiry returns to controls. Existing calm visual styling is preserved across booking and recovery states.
- CI now runs typecheck, lint and all tests with PostgreSQL. An explicitly configured but unreachable test database fails the check rather than silently skipping it.

### Final verification

`npm run check` passes TypeScript, lint and **564 tests, zero failures, zero skips** on disposable PostgreSQL 18.4. The month simulation exercises five weekly calls, context continuity, duplicate settlement, delivered recaps and the exact 30-day stop. Additional failure tests cover queue concurrency, transaction rollback, lost email responses, uncertain SMS, provider receipts, retry bounds, suppression, retention and deletion. Provider integrations use signed/test fixtures and fake transports.

Browser review at 390px and 1280px checked code uncertainty → valid verification → booked controls, visible time selection, keyboard movement, paused paid controls → deliberate cancellation → still-paused confirmation, and trial controls. Tested layouts had no horizontal overflow. Screenshots were visually inspected. Earlier phase records retain their separate recovery, memory editing, scheduling and deletion-failure checks. See [QA evidence](qa/README.md).

### Remaining release gates

Actual voice/SMS caller identity, reply behavior, provider acceptance/delivery, email reply handling, hosted checkout/portal and actual price, prompt deployment, policy review, monitoring ownership and human usability research must be completed before rollout. Keep public signup to one replica while its supplementary signup limits are process-local. No provider, pricing or trial-policy choice has been invented. See [deployment and rollback](message-delivery.md#deployment-and-rollback).
