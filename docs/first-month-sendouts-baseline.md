# 8&80 sendouts and navigation inventory

Companion to [the first-month workshop brief](first-month-audit.md). This is the application inventory at commit `2d6b561d76d7`, reviewed 2 October 2026. It covers the public signup path, calls, all 16 SMS template variants, all five email variants, customer navigation and exception paths. Provider-managed messages and production configuration remain unverified.

Use this as the workshop checklist: for every item, agree the trigger, the promise, the next action, the destination, suppression rules and what happens when delivery fails. “Sent” below describes the code path; it does not establish actual delivery.

## Outbound phone calls

| Call | Trigger and experience | Timing, destination and exceptions |
| --- | --- | --- |
| First call | Eligible scheduled caller with callNumber at most one, or a rehearsal flag. Availability check; AI/written-note disclosure; eight/eighty/year goals; read-back; one action; next arrangement. | Next future chosen weekday/time in the stored timezone. The form offers 06:00–22:00 in 15-minute steps. The trial already runs while the caller waits. |
| Returning call | Subsequent completed-call state selects the returning agent. Recall the last commitment, explore done/partly/undone, reflect, choose the next action. | Weekly in the chosen local timezone. No distinct week-two or week-four campaign. Three consecutive undone commitments can change the conversation branch. |
| Agreed callback | A callback extracted from the conversation, a one-off move, or the “later” control writes a new next-call time. | No separate callback-confirmation sendout is guaranteed for a voice reschedule. “Later” adds eight hours. A completed availability-only first call can advance the caller to the returning agent. |
| Technical placement retry | Provider failure classified as not having rung the person. | Up to three placement attempts in the tick, with two- and six-second backoffs. A known unanswered ring does not receive this retry sequence. |
| Missed, failed or abandoned attempt | No answer can lead to a recovery SMS; a call never placed can lead to a different SMS. | An overdue slot outside the two-hour grace window advances without calling or texting. An attempt stale for over an hour is closed without a recovery SMS. Silent calls also have a gap in recovery. |

Eligibility requires an unpaused caller and billing that permits calls: comped, active, past_due, or an unexpired trial. Pausing and billing are separate state. Starting again does not pay an expired trial. Payment does not unpause a caller. Console agent configuration and caller ID determine what actually runs; the repository prompt is not proof of the deployed prompt.

[Selection and placement](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/loop/tick.ts#L45) · [Scheduling and grace window](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/schedule/scheduler.ts#L57) · [Callback write](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/schedule/scheduler.ts#L260) · [Outcome classification](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/call/outcome.ts#L76) · [Stale-attempt sweep](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/loop/sweep.ts#L16)

## Signup and recovery SMS

The following is the current template text. Braces denote values inserted at runtime. Control links use `/r/{token}`, expire seven days after minting, and open the controls, export and deletion actions. There is no sliding extension on use.

| Template and exact copy | Trigger | Destination and delivery behavior |
| --- | --- | --- |
| **sms.code** — “{{code}} is your 8&80 code.” | Accepted signup-code request. | User enters it on the verification screen; no link. Code lasts ten minutes with five attempts. A fresh request replaces the pending code. Rate-limited requests show “just sent” without sending. |
| **sms.welcome** — “8&80 here. Your first call is {{when}}. If that's wrong, or you'd rather not: {{link}}” | Successful phone verification; also available through operator enrolment. | Seven-day control link. Day/time wording rather than a full calendar date. Ordinary send failure does not undo signup; carrier opt-out pauses calls. |
| **sms.missed** — “Rang just now. Didn't leave a message — nobody wants that. Move it or skip this week: {{link}}” | A call classified as unanswered/missed reaches the recovery path. | Seven-day control link. One claimed nudge per call attempt. No link means no text. Voicemail behavior needs a live provider check. |
| **sms.failed** — “Couldn't get a call through to you just now — my end, not yours. Back to the usual time next week, or pick another: {{link}}” | The placement path exhausts attempts without getting through. | Seven-day control link; same per-attempt claim. Failure is logged; no delivery retry queue was found. |
| **sms.slot.link** — “You mentioned moving the call. You can set a new time here, and it sticks: {{link}}” | Completed call extracts a request to change the regular slot. | Seven-day control link. Takes precedence over the missing-email text when both apply. |
| **sms.email.ask** — “There's no email on file, so the recap has nowhere to go. Add one here and it arrives after the next call: {{link}}” | Completed call, no email, and no slot-change request taking priority. | Same control page and email field. Ordinary public signup requires email, so this mainly serves operator/legacy or otherwise missing-email records. No automatic resend of the previous recap. |

[OTP and welcome dispatch](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/signup/routes.ts#L90) · [Pending-code rules](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/signup/pending.ts#L7) · [Welcome handling](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/sms/welcome.ts#L19) · [Recovery and assistance dispatch](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/sms/missed.ts#L16) · [SMS copy](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/SCRIPT.md#L1097)

## Feedback SMS

| Variant and exact copy | Selection | Destination |
| --- | --- | --- |
| **sms.feedback.1** — “One call in, so two questions about me for a change: {{link}}” | Eligible caller's cumulative completed count is one. | Fourteen-day feedback link, /f/{token}. |
| **sms.feedback.4** — “Four calls in, so two questions about me for a change: {{link}}” | Eligible caller's count is four. This is a variant, not a second campaign after the first survey. | Same feedback form. |
| **sms.feedback** — “{{count}} calls in, so two questions about me for a change: {{link}}” | Fallback when no exact count variant exists. | Same feedback form; does not open account controls. |

The default threshold is one completed call, configurable with FEEDBACK_AFTER_CALL; a value below one disables it. The latest completed call must have ended at least 15 minutes and less than six hours ago, last at least three minutes, and have neither the “moved during the call” nor “no commitment was reached” note. Paused callers and anyone with an existing feedback row are excluded. A short or interrupted call can defer eligibility to another call, while still contributing to the count.

The intended 30-minute separation is implemented against call_attempts.sms_sent_at, not a universal log of OTP, welcome and reply texts. A safety_tier value, when present on the eligible call, creates a permanent skipped feedback record; this review did not establish a working upstream flag-writing process. The feedback row is claimed before sending. Send failure marks it failed and still prevents a later automatic retry. A carrier opt-out pauses calls.

The form asks what made the user pick up, what nearly made them not pick up, and an optional “anything else”. All three fields are optional, with up to 4,000 characters each; an empty submission is accepted. On supported browsers a dictation affordance uses browser speech recognition. Reopening the valid link shows previous answers and permits replacement. Submission goes to a thank-you state. Opening and submission are recorded; common link-preview agents are excluded from open counts.

[Complete feedback eligibility and dispatch](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/feedback/feedback.ts#L43) · [Feedback copy variants](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/SCRIPT.md#L1823) · [Feedback page](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/feedback/page.ts#L22) · [Feedback routes](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L329)

## SMS replies and web action acknowledgements

These templates are outbound SMS when an inbound text reaches /webhooks/sms and matches a known caller and slot. The browser control page reuses the parser and response text with a silent SMS adapter: its actions show an on-page response rather than sending another text. Actual inbound SMS capability must be verified because the script also describes a non-replyable sender.

| Template and exact copy | Action actually performed | Workshop implication |
| --- | --- | --- |
| **sms.stopped** — “Done. I won't ring again. Text START if you want it back.” | STOP-like intent sets paused=true. “Cancel my subscription” also reaches this branch. | Calls pause; provider billing is not cancelled. START advice requires a replyable sender. |
| **sms.started** — “Back on. Next call {{when}}.” | Clears pause and resets the weekly slot to its next future occurrence. | Billing eligibility is unchanged; the message can promise a call to an expired trial. |
| **sms.moved** — “{{when}}, then. Your usual slot stays as it is — say ALWAYS if you'd rather move it for good.” | A recognized day/time writes a one-off next-call override. | ALWAYS on its own is not understood; it needs day/time too. The one-off move does not clear a pause. |
| **sms.moved.always** — “Moved for good. {{when}} from now on.” | A day/time with permanent intent changes the recurring slot. | Setting a slot also clears pause. This consequence is not explained in the acknowledgement. |
| **sms.later** — “Right. I'll have another go this evening.” | Sets next call to now plus eight hours. | Can produce a next-day overnight callback; no quiet-hour adjustment. |
| **sms.skipped** — “Consider it skipped. Talk next week.” | Returns an acknowledgement without a scheduler write. | Fits an already-advanced missed slot, but does not cancel a still-upcoming occurrence or override. |
| **sms.unparsed** — “That one's beyond me, sorry. A day and a time works, or SKIP to leave this week.” | No schedule mutation. | Provides syntax guidance, but references the ineffective skip path. |

Acknowledgement delivery failure is logged without rolling back the scheduling change. Carrier refusal can prevent the STOP confirmation from arriving. This keeps the action from depending on the acknowledgement, but requires the web state to reflect the action reliably.

[Parser and supported intents](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/sms/reply.ts#L30) · [Actions and acknowledgements](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/sms/missed.ts#L145) · [Inbound route](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L299) · [Silent adapter for web actions](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L469) · [Reply copy](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/SCRIPT.md#L1124)

## Email sendouts

| Variant and visible content | Trigger and destination | Suppression, failure and navigation |
| --- | --- | --- |
| **Commitment recap** — subject “The one thing — {{day}}”; “You said”, the agreed action, “That's the one I'll ask you about”, duration and next slot, signed 8&80. The day suffix is removed when no day was extracted. | Immediately after a completed call is recorded, to stored email. | No email means no recap. No account/control link. Logistics use the usual slot, which can differ from a callback or one-off arrangement. Send errors are logged without a durable retry. |
| **No-commitment recap** — subject “This week's call”; “No one thing this week — we'll pick it up next time”, then logistics. | Completed outcome without a commitment, including an availability-only reschedule classified as completed. | Same destination and failure behavior. Can promise the usual slot while a callback has been scheduled. A sub-minute conversation is described as a minute. |
| **Trial ended** — subject “That's the free month”; says the month is up and calls stop; action “Pick it up here”. | Expiry sweep transitions trialing callers to ended, then attempts one email to stored email. | Hosted checkout URL from configuration, carrying caller identity. No separate paused-user exclusion. Missing checkout URL removes the action but leaves copy referring to a link. Email failure does not restore trial eligibility and has no notice retry. |
| **Payment failed** — subject “Your card didn't go through”; says calls carry on during payment retries; action “Update the card”. | Billing webhook changes a matched caller into past_due from another state, then emails the stored address. | Calls remain eligible while past_due. A later new transition can notify again. Uses the same configured checkout builder as trial continuation, not an application customer-portal route. Validate that destination before relying on the “update” promise. Send failure is logged. |
| **Personal data export** — subject “Everything 8&80 has about you”; “This is all of it”, labelled facts, call history and any submitted feedback. | Explicit export action from a valid SMS control link; sent to stored recap email. Browser-cookie access alone is refused. | No attachment or controls link. Includes profile, slot, count, latest commitment, joined date, billing summary, up to 100 call metadata rows and feedback. It does not enumerate all stored eight/eighty/goals/belief context. The page says “On its way” even if no email exists or sending fails. |

The export's “everything” promise needs reconciliation with the actual export fields. Deletion and export wording should be reviewed together with the provider-retention and billing behavior; this is a source-level consistency finding, not a legal conclusion.

[Recap composition](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/recap/compose.ts#L69) · [Settlement send](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/loop/settle.ts#L83) · [Trial expiry](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/billing/trials.ts#L18) · [Checkout and billing letters](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/billing/notice.ts#L18) · [Payment notice](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L506) · [Export contents](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/legal/export.ts#L18) · [Export success handling](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L428)

## Customer navigation inventory

There is no app installation or conventional navigation menu in this flow. Navigation moves between a small set of web pages, the SMS inbox, phone calls, email and hosted checkout.

| Entry or route | Available actions and next screen | Limits and alternate states |
| --- | --- | --- |
| GET / | Booking form; closed FAQs; footer Terms and Privacy. A valid browser cookie redirects to /me. | Public signup must be open and SMS configured. Otherwise the signup path returns 404. |
| GET /start | Always enters the signup form, even with an existing browser session. | Existing users can repeat signup; this is not a dedicated access-recovery flow. |
| POST /start | Validate name, phone, email, weekday, time and timezone; then show code screen. | Validation errors preserve most form values. Failed code send shows an error/support contact. Rate-limited requests show the code screen without a new send. |
| Code screen / POST /start/verify | Enter six digits; auto-submit or use button. Success redirects to /me and sets seven-day browser access. | Wrong, expired, unknown and exhausted codes have errors. “Start again” returns to the landing form. No dedicated resend or edit-number action retaining the booking. |
| GET /me before first call | Appointment confirmation; save contact; move booking; set recap email; stop. | First-call move changes the recurring slot too. Before-first skip/later are not shown and web actions are ignored. The fresh confirmation and later revisit use different headings. |
| GET /me after first call | “Move this week's call”; later today; choose day/time; optional every-week checkbox; add to goals; update email; skip; stop. | Normal GET shows a blank email field, usual slot and regular controls rather than actual paused/billing state. Existing goals and commitment are not visible. |
| GET /r/{token} | Same personal controls; also export and delete. | Valid for seven days. The token is purpose-specific; browser and feedback tokens cannot substitute. Expired/malformed/wrong-purpose access shows a gone state with no renewal action. |
| GET /contact.vcf | Download/import an 8&80 contact with number and brand image into the device address book. | Available when a valid configured number exists. No proof in the app that the contact was saved. The actual call/SMS number match needs device testing. |
| Move one call | Choose weekday/time and submit without every-week selection. | On-page confirmation; next-call override changes, usual slot stays. The before-first page instead forces a recurring change. |
| Move every week | Select “Every week from now on”, choose day/time, submit. | Changes weekly slot and clears pause. A short confirmation replaces the form. |
| Try again later today | Submit later action on the returning page. | Adds eight hours and shows the “this evening” acknowledgement, with no exact date/time. |
| Skip this week | Submit skip on the returning page. | Shows success text but makes no scheduler write. |
| Save email | Validate and save the address. | Validation error or saved text renders in the page. Does not verify the new address or resend an old recap. |
| Add to goals | Append a short entry after the first call. | Entry limited to 400 characters, combined context capped at 2,000. No view/edit/remove interface for previous entries. |
| Stop → confirmation | Choose yes to pause, or no to return to controls. | Paused result offers start again and, for SMS-link access, deletion. No subscription cancellation. Reopening the URL returns ordinary controls. |
| Start again | Resume from the stopped result. | Clears pause and resets the weekly slot; billing can still block calls. |
| Export | SMS-link holder requests export to stored recap address. | Browser-only page directs the user to a text link. Success UI is not a delivery confirmation. |
| Delete → confirmation | SMS-link holder confirms local deletion or keeps the record. | Deletes local caller-related records. No provider billing-cancellation call; the final “Gone” screen has no recovery. Browser-only access is refused. |
| GET /f/{token} → POST | Read/write optional feedback, optionally dictate where supported, then thank-you page. | Fourteen-day token. Valid revisits permit changes. Expired link has a separate feedback-gone state. No bridge to account controls. |
| GET /terms and /privacy | Read legal pages from signup/footer links. | Claims about cancellation, every-text access and data scope need reconciliation with implementation. |
| Trial/payment email → external checkout | Follow the configured hosted payment URL. | Price, return screen, receipts, portal and provider dunning were not inspected. Successful webhook updates billing but there is no application payment-success page/message in this route set. |
| Missing browser access | /me shows the unknown-browser explanation and tells the person to use a text link. | Does not send a fresh link. Root / may offer signup again instead. |
| Other or invalid HTTP routes | 404; unsupported method or cross-site POST can be rejected. | No customer help center or general account-recovery route was found. Support is an email address in error/legal copy. |

[Route dispatch](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L150) · [Personal-page actions](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/control.ts#L386) · [Page controls and result states](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/link/page.ts#L100) · [Signup views](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/signup/page.ts#L103) · [Access purposes and expiry](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/link/token.ts#L25) · [Contact card](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/link/vcard.ts#L28)

## State changes that span more than one channel

| User intent | What the code does | What to verify or decide |
| --- | --- | --- |
| Re-sign up with an existing number | Updates profile and slot, unpauses, sends welcome and grants browser access. Existing trial/subscription conditions prevent an automatic fresh free month. | A returning paid or expired user should see their real state rather than onboarding-style confirmation. |
| Stop calls | Sets pause; no provider cancellation. Trial clock continues, and expiry email does not filter paused callers. | Define call pause, all-contact preferences and subscription cancellation separately. |
| Carrier SMS opt-out | Several outgoing paths recognize provider refusal and pause calls. | This may occur only on a later send; verify inbound STOP handling and sender capability live. |
| Pay after expiry | Vendor webhook marks billing eligible; user pause remains. | Confirm when the next call is actually due. Eligibility alone is not appointment confirmation. |
| Delete local profile | Removes local records and identifiers. | Handle any provider subscription and retained provider data deliberately before promising total completion. |
| Repeat delivery/failure | Per-attempt SMS and feedback claims prevent duplicates, but claims made before send can consume the only attempt. | Durable retry and deduplication need one shared delivery model. |

[Trial-start guard](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/store/postgres.ts#L198) · [Billing application and local deletion](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/store/postgres.ts#L255) · [Scheduler slot write](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/schedule/scheduler.ts#L143)

## What was not found as a standard application sendout

No routine pre-call reminder, preparation email, day-two or day-seven drip, progress digest, advance trial-end notice, application payment-success message, cancellation receipt, automatic win-back sequence, push notification or calendar invitation was found in the reviewed application send paths. Absence from this repo does not establish absence in payment-provider or external marketing tools.

Operator tools can enrol callers and send the welcome, and can send a synthetic recap to a supplied test address. These are manual operational paths, not extra scheduled lifecycle campaigns. No such tool was used to contact a real person in this audit.

[Operator enrolment](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/enrol-cli.ts#L135) · [Manual recap utility](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/recap-cli.ts#L18)

## Production checks before calling this the live journey

Confirm the deployed revision; signup-open setting; active first and returning Speechify agents; prompt and dynamic-variable delivery; timezone and caller ID; real SMS sender type and reply routing; delivery status callbacks; Resend sending domain and reply handling; checkout price, portal, return URL and vendor emails; actual cancellation and support processes.

The runtime degrades missing SMS or email configuration to files for some operational paths. Public signup checks SMS configuration, but a composed recap or log entry alone does not prove an email left the system. Preflight/doctor checks exist; their successful execution and production values were not inspected. [Mailer selection](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/recap/mailer.ts#L26) · [SMS selection](https://github.com/Sveisan/8-80/blob/2d6b561d76d7d749fc2eb5be3317ec69377a97c2/services/voice/src/sms/index.ts#L36)

## Workshop output template

For each changed touchpoint, record: **user state → trigger → promised outcome → primary action → destination → actual next appointment → suppression → failure recovery → owner → measurement**. Resolve the critical behavior mismatches in the main brief first, then test whether the calmer, clearer journey helps people understand the value and stay in control.
