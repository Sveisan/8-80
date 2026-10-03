# Transactional message delivery

Automatic enrollment, recovery, conversation, feedback, billing and export paths persist encrypted message intent. State and intent commit in the same PostgreSQL transaction wherever the state is local. Provider calls happen after that commit. An external billing action cannot participate in our database transaction: canonical provider reconciliation and an idempotent cancellation recover that boundary.

## What a status means

| State | Meaning / operator response |
| --- | --- |
| `pending` | Not yet attempted or a known retryable refusal. Due work is picked up by the minute tick. |
| `sending` | Request claimed with an attempt record committed before provider I/O. |
| `accepted` | Provider returned success and an identifier. This does not prove delivery to a person. |
| `delivered` | A later provider receipt reports delivery. This does not prove reading or comprehension. |
| `failed` | Known refusal, exhausted attempts, missing configuration/address or expired payload. Inspect reason. |
| `uncertain` | Provider may have accepted a request before a connection or worker failure. Inspect provider records before any retry. |
| `suppressed` | Current preference, account, code, address, safety or appointment state makes the intent stale/inappropriate. |
| `abandoned` | An operator closed an unresolved record without sending again. |

There is no general exactly-once delivery guarantee across PostgreSQL and external providers. Event identities prevent duplicate producer intents. Row claims prevent concurrent workers from sending the same pending row. A committed outcome plus an outbox row closes the old crash-before-send hole; uncertain external effects remain explicit.

Email uses a stable Resend idempotency key and identical persisted recap data. [Resend documents a 24-hour key lifetime](https://resend.com/docs/dashboard/emails/idempotency-keys); automatic retries stop earlier, within the 23-hour payload expiry and with a one-minute margin on the provider window. Do not switch provider accounts, sender, rendering code or mail configuration while retryable messages from the previous configuration remain. Drain or review them first: the wire request must match the original request.

The Twilio adapter assumes no verified create-message idempotency contract. A definitive HTTP 429 can retry; network timeouts, missing receipt identifiers, HTTP 408/5xx and interrupted SMS sends become uncertain. [Twilio message statuses](https://www.twilio.com/docs/messaging/api/message-resource) distinguish queued/accepted from delivered/undelivered. Receipt polling never resends a message. Email receipt polling uses [Resend's retrieval endpoint](https://resend.com/docs/api-reference/emails/retrieve-email). No email open/click events are retained as analytics.

## Suppression, bounds and retention

Before provider I/O the worker locks the caller and rechecks deletion, carrier opt-out, pause for call/welcome/feedback messages, feedback preference and safety flags, current code, billing/trial state, current email address and dated SMS appointment state. Pausing calls does not suppress recaps already owed or transactional billing mail. Feedback considers all accepted SMS in the last half hour, including verification and reply messages.

Default payload life: SMS six hours, email 23 hours; codes ten minutes; feedback no later than six hours after the qualifying call. Accepted/suppressed message bodies and recipients are cleared immediately. Other expired bodies are cleared by the next tick. Status/attempt metadata is pruned after 30 days. Deletion removes both message and attempt rows. Journey counts/milestones have a separate 60-day window. These are job-enforced limits; monitor the tick heartbeat.

The worker claims at most 50 due messages per run. Provider calls have eight-second timeouts. Known retryable failures back off from one minute to 30 minutes, with at most eight attempts before failure. An interrupted `sending` row is recovered after 90 seconds; only an email still inside its verified idempotency window is automatically requeued. Poll accepted receipts every ten minutes for up to 48 hours. An unresolved receipt remains accepted rather than being mislabeled delivered.

The caller lock deliberately spans the bounded provider request so controls/deletion cannot race past the final suppression check. Control operations may wait for that request. Ordering is caller before credential/outbox rows; signup additionally serializes absent-account creation. Scale worker batch sizes only after observing database and provider limits.

## Operator procedure

1. Run `npm run messages` against the intended database. It prints counts and up to 100 unresolved/overdue identifiers, kinds, timestamps and reason codes. It never prints phone numbers, addresses, message bodies or codes.
2. Check the tick heartbeat and provider configuration. Fix a systemic outage before handling individual rows. Do not run a real tick during a local rehearsal: it may place calls as well as send messages.
3. For a known refusal, correct the actual cause. For an uncertain result, inspect the provider's record using the stored provider ID where available and the narrowly authorized account/time context. Confirm whether a request was accepted; absence of a local receipt is not evidence of non-acceptance.
4. Only after establishing that the provider did **not** accept it: `npm run messages -- retry-confirmed-not-accepted <id>`. This records the decision and requeues a still-retained payload. It sends nothing itself. The normal worker applies suppression again. Expired payloads cannot be revived.
5. If a resend is unwarranted, already delivered or cannot be safely resolved: `npm run messages -- close-without-resend <id>`. This clears content and records an explicit closure. Arrange any needed customer recovery through the approved support process; this command does not contact anyone.
6. Verify the resulting state. Alert operationally on uncertain/failed records, overdue pending work, rising retries, missing heartbeat or accepted receipts unresolved after 48 hours. The CLI supplies evidence, not an installed paging integration. Assign its owner and alert destination before rollout.

File preview transports deliberately record `provider_unconfigured`, never `accepted`. Diagnostic replay uses that same safeguard. It must not consume a “delivered” metric through a no-op sender.

## Deployment and rollback

Apply migrations 0013–0019 before starting the new control service and tick. They add access, onboarding, billing/preference fields, message history and measurement; 0019 makes feedback acceptance time nullable so a queued request has no false sent timestamp. Existing historical timestamps are not reinterpreted as provider proof.

Run one scheduler configuration with the intended credentials. Signup's extra rate limits remain process-local; do not scale public signup across replicas until shared enforcement is implemented. Verify sender identity, signed inbound replies, suppression, actual receipts and email reply handling on controlled devices. Verify the selected billing provider and price independently.

Drain/reconcile pending work before changing message providers or rendering configuration. Pause call placement and all old/new ticks during rollback. An old application version uses direct sends and cannot safely drain the new outbox. Leave additive tables/columns intact, preserve unresolved records, and never replay them through both workers. Roll back both Speechify prompts and backend routing together as described in the improvement plan. This PR does not deploy or migrate production.
