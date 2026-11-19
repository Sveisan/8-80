# Unblock launch approval · 15 November 2026

The private signup, scheduling and Stripe test-payment path has been exercised. Public enrolment and live calls remain off. No production configuration or customer records were changed by this work.

## Verified evidence

- A clean checkout runs an HTTPS loopback app with an independent Postgres cluster and encryption key. It refuses production Stripe credentials, live checkout links, a production `.env`, and external database/origin addresses. Calls and email are blocked. SMS is captured for synthetic test identities only; real SMS delivery/sign-in was verified separately on production.
- Signup preserves entered contact details after invalid email, verifies a captured test code, records consent, and opens scheduling. Five calls per month produces the Tuesday/Friday rhythm; the selected opening time and no-light-call preference persist.
- Stripe's real hosted test checkout shows NOK 249/month. The documented declined card leaves access awaiting payment. A successful test payment produces a paid NOK 249 invoice; actual signed `invoice.paid`, `customer.subscription.created` and `checkout.session.completed` deliveries return HTTP 200 and activate the account through the production subscription read.
- The browser returns to the paid account with the selected opening appointment and contact-card preparation. The real Stripe test customer portal opens with the subscription and invoice.
- Pause retains active billing and explicitly explains that billing continues. Resume restores the appointment. Cancellation at period end is confirmed by Stripe and shown by the account, with a signed subscription-update delivery.
- Sign-out and fresh-code recovery reopen the same account with the schedule and cancellation intact. Cleanup immediately cancelled the one task-created test subscription and deactivated checkout; the real `customer.subscription.deleted` event returned 200 and moved the app to `ended`/`completed` with no pending calls.
- Read-only Speechify comparison: opening, regular and light agents match source prompts; required tools are listed. This is not a real-call verification.
- The configured live provider price is active, monthly, NOK 249.00. Its tax behaviour is unspecified; no VAT treatment is assumed here. Legal-controller name, organisation number and address are configured.
- Repository checks: 1,169 unit/integration tests with no skips, four feedback tests, three sandbox-boundary tests; 30 Chromium/WebKit browser checks. The four new coverage tests cover local weekdays, boundaries and invalid-day failure.

Screenshots, provider proof and runtime files are local under `output/`; credentials, claim URLs and provider sessions are excluded from Git. See [the sandbox runbook](sandbox.md).

## Decisions requiring Eirik or an appointed reviewer

| ID | Concrete decision | Required evidence before enabling |
| --- | --- | --- |
| A1 · Content | English-only initial launch, all three call structures and all twelve chapters are owner-approved in the local review source. The [chapter content review](chapters.md) is complete. The weekday daytime schedule and matching day-neutral wording are owner-approved on 19 November 2026 and implemented in the local source. The three private provider scripts/greetings were published and read back on 19 November; revised server chapter context and real-call verification remain pending. | Record the approved versions and change only actually reviewed chapters to `approved`. The local [regular](weekly-script.md) script includes the approved pause/cancellation clarification, age-aware closing reflection capped at 30 local dates, optional step timing, wish-specific next-step prompts and contextual difficult-day response bank. Server review changes are not yet deployed; the three private provider prompts now match the reviewed scripts, including the missing-session guard. A recurring service must not renew into unapproved material. Do not set `UNBLOCK_SCRIPTS_APPROVED` as a substitute for this review. |
| A2 · Response coverage | Approved window: **Monday–Friday, 09:00–17:00 Europe/Oslo**, with call starts through 16:30. Eirik is confirmed as sole operator (19 November 2026), with no independent backup by his explicit choice. Daily Available/Away check-in is owner-approved and implemented locally. The operational procedure and five-minute acknowledgement target are owner-approved and implemented. The core spoken response is also owner-approved and implemented; review emergency routing and obtain the remaining qualified sign-off. | The last recorded deployment check (18 November) had a weekday 09:00–17:00 support label and 09:00–21:00 all-week runtime coverage. The approved local release configuration is weekdays 09:00–17:00 with a 30-minute call-start buffer. Local availability and Unblock-only alert/digest routing are implemented and tested. Incident acknowledgement, failure blocking and private CLI are implemented and tested; actual alert delivery, qualified emergency escalation and deployment alignment remain to be verified. The [operating review draft](operator-review.md) identifies the unresolved spoken procedure. |
| A3 · Commercial terms | Confirm **NOK 249/month**, one opening conversation plus 1–8 regular calls/month at the same price, optional light calls, automatic renewal, pause without pausing billing, cancellation at period end, and refund handling. | Confirm how tax is included/displayed; obtain the qualified consumer/privacy review still required by the [legal drafts](../../legal/README.md). Confirm that the controller and merchant shown at checkout are correct. |
| A4 · Real calls | Approve an agreed window for three owner test calls: opening, regular and light. Existing test recipient: the owner number previously provided in chat. | Verify greeting, caller-ID/contact match, silence/voicemail handling, tool invocation, readback and agreement before saving, signed completion, and clean call ending. The current `UNBLOCK_AGENTS_VERIFIED=false` must remain until this succeeds. |
| A5 · Activation | After A1–A4 pass, explicitly authorise the paid-pilot cohort and production activation. | Confirm approved hours, sole-operator availability/procedure, payment configuration and release, monitoring responsibility, and rollback. Enabling the current public enrolment switch makes signup publicly accessible; it is not an invite-only gate. A private cohort needs a separate access restriction before that switch is enabled. |

`UNBLOCK_ENABLED`, `UNBLOCK_SAFETY_APPROVED`, `UNBLOCK_SCRIPTS_APPROVED`, `UNBLOCK_AGENTS_VERIFIED` and `UNBLOCK_LIVE_CALLS` were not changed on production. The sandbox's synthetic readiness values exist only in its separate process and are not approvals.

## Approved launch call times · 19 November 2026

**Owner-approved.** Exact reply: “Yes, approve the daytime schedule for the initial launch. Let’s confirm primary and backup coverage next.” This approves the timing part of A1 and the window part of A2. Sole-operator ownership is now confirmed; daily availability is also approved and implemented locally; response procedure, commercial terms, real-call verification and activation remain separate. Implementation and verification are local; no production settings or live flags have been changed.

- Approved staffed window: Monday–Friday, 09:00–17:00, Europe/Oslo.
- Approved call start times: 09:00–16:30, leaving time for the final conversation before the staffed window ends.
- Approved optional light-call suggestion: Monday/Wednesday/Friday at 16:00. Callers can choose other supported weekday slots or decline; existing 45-minute separation rules still apply.
- Use daytime wording throughout opening/light calls and scheduling. The local default is now 16:00, with day-neutral opening/light wording. The form suggests a weekday first conversation and a 15:00 regular call, displays the actual instants in the caller's timezone and keeps optional light calls off until chosen.

Approved opening explanation:

> Between our regular calls I can ring for about a minute on a few days, just to ask what was alive in your day. Those moments are kept for you and brought together at the end. Would you like that?

Approved day/time suggestions, asked only for missing information:

> Would Monday, Wednesday and Friday suit you, or would you prefer other weekdays?
>
> Around four in the afternoon, or another time within our calling hours?

Approved light-call closing:

> Thank you. Enjoy the rest of your day.

The local implementation applies a 30-minute buffer to slot validation, rescheduling and dispatch, defaults coverage days to weekdays, updates the scheduling UI and opening/light prompts, and provides the approved release settings in `.env.example`. Verify the configured Oslo window and actual alert coverage at deployment before any activation. This owner decision does not confirm staffing or authorise enrolment activation.

## Temporary Stripe sandbox and credential cleanup

The CLI provisioned an unclaimed sandbox expiring **22 November 2026**. A diagnostic redaction rule missed its new `rkcs_test_` key format and exposed a temporary **test-only** key. A replacement provisioning attempt required Dashboard authentication. Consequently this sandbox is disposable only: all test content is synthetic, its test subscriptions are cancelled and its payment link is deactivated after verification. Production credentials were never read into the local sandbox or exposed.

Dashboard sign-in is still needed to claim/delete the temporary sandbox and retire that credential. This cleanup is separate from authorising production enrolment. No test key or claim URL belongs in this repository or a public PR.

## Definition of complete

This implementation work can be handed over when the tested code is merged, the evidence and owner decisions above are recorded, real-call verification passes, production activation is explicitly authorised and verified, and ongoing support/monitoring has an owner. This file does not approve itself or open enrolment.

## Web-test incident and availability implementation · 19 November 2026

Owner approval of daily check-in/Away is recorded in `operator-review.md`. The private server CLI, migration, placement lock/expiry and no-catch-up behaviour are implemented locally. Test evidence is filtered under `output/unblock-availability-*20261119.json` (not customer records).

The owner’s dashboard Web conversation failed because all three `capture_unblock` requests had empty session IDs and tokens. The server correctly refused them with 401; this was not a successful programme conversation despite the provider transport status. Registered app-created sessions remain mandatory. Never paste session credentials into chat or make the capture endpoint anonymous. The three existing private agents had stale greetings; reviewed scripts/greetings plus a missing-session explanation/end instruction were published and read back, with settings/tools and launch flags preserved. Prompt equality does not prove audible behaviour; the new guard still requires a controlled provider conversation. A blank dashboard Web test cannot exercise the full authenticated journey. Use a newly configured, isolated test session for the next agreed test.
