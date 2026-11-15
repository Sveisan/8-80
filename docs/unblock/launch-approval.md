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
| A1 · Content | Approve English as the initial language, the [opening](opening-script.md), [regular](weekly-script.md) and [light](light-script.md) packs, and the [chapter content](chapters.md). All 12 source chapters currently remain `draft`. | Record the approved version and change only actually reviewed chapters to `approved`. A recurring service must not renew into unapproved material. Do not set `UNBLOCK_SCRIPTS_APPROVED` as a substitute for this review. |
| A2 · Response coverage | Proposed window: **Monday–Friday, 09:00–17:00 Europe/Oslo**, with Eirik as primary and a named backup supplied by the owner. Approve the urgent-response procedure with an appropriately qualified reviewer. | The current public support label is weekdays 09:00–17:00, while runtime call coverage is 09:00–21:00 on all days; no backup is configured. The new `UNBLOCK_COVERAGE_DAYS` control can align runtime days once this code is merged and the window is approved. The [operating review draft](operator-review.md) identifies the unresolved spoken procedure. |
| A3 · Commercial terms | Confirm **NOK 249/month**, one opening conversation plus 1–8 regular calls/month at the same price, optional light calls, automatic renewal, pause without pausing billing, cancellation at period end, and refund handling. | Confirm how tax is included/displayed; obtain the qualified consumer/privacy review still required by the [legal drafts](../../legal/README.md). Confirm that the controller and merchant shown at checkout are correct. |
| A4 · Real calls | Approve an agreed window for three owner test calls: opening, regular and light. Existing test recipient: the owner number previously provided in chat. | Verify greeting, caller-ID/contact match, silence/voicemail handling, tool invocation, readback and agreement before saving, signed completion, and clean call ending. The current `UNBLOCK_AGENTS_VERIFIED=false` must remain until this succeeds. |
| A5 · Activation | After A1–A4 pass, explicitly authorise the paid-pilot cohort and production activation. | Confirm approved support hours/backup, payment configuration and release, monitoring responsibility, and rollback. Enabling the current public enrolment switch makes signup publicly accessible; it is not an invite-only gate. A private cohort needs a separate access restriction before that switch is enabled. |

`UNBLOCK_ENABLED`, `UNBLOCK_SAFETY_APPROVED`, `UNBLOCK_SCRIPTS_APPROVED`, `UNBLOCK_AGENTS_VERIFIED` and `UNBLOCK_LIVE_CALLS` were not changed on production. The sandbox's synthetic readiness values exist only in its separate process and are not approvals.

## Temporary Stripe sandbox and credential cleanup

The CLI provisioned an unclaimed sandbox expiring **22 November 2026**. A diagnostic redaction rule missed its new `rkcs_test_` key format and exposed a temporary **test-only** key. A replacement provisioning attempt required Dashboard authentication. Consequently this sandbox is disposable only: all test content is synthetic, its test subscriptions are cancelled and its payment link is deactivated after verification. Production credentials were never read into the local sandbox or exposed.

Dashboard sign-in is still needed to claim/delete the temporary sandbox and retire that credential. This cleanup is separate from authorising production enrolment. No test key or claim URL belongs in this repository or a public PR.

## Definition of complete

This implementation work can be handed over when the tested code is merged, the evidence and owner decisions above are recorded, real-call verification passes, production activation is explicitly authorised and verified, and ongoing support/monitoring has an owner. This file does not approve itself or open enrolment.
