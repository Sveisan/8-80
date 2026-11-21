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

## Current launch checklist · 19 November 2026

| ID | Decision/status | Remaining evidence before enabling |
| --- | --- | --- |
| A1 · Content and configuration | English-only, all three call structures, all twelve chapters and weekday daytime timing are owner-approved. Norway-only scope and destinations are approved and deployed in PR73. | Preserve the approved versions and verify three private agent prompts/settings/tools against the merged source. Separate unpublished chapter edits are not part of this procedure change. |
| A2 · Safety/privacy operations | Eirik is sole operator by explicit choice. Manual Available/Away, weekday 09:00–17:00 Oslo coverage, start buffer, five-minute ACK target, failure blocking, core speech, routing and all four consolidated procedure decisions are owner-approved. | Implement the [consolidated procedure](escalation-handoff.md), run automated regression/configuration checks and complete the agreed qualified clinical/Norwegian privacy/legal review. This owner approval does not supply a legal basis for disclosure. The deployed contact/window alignment is recorded in the workspace release evidence; the old 18 November mismatch is historical. |
| A3 · Commercial readiness | **Price/package owner-approved 20 November 2026:** NOK 249/month for up to four regular calls, with the opening conversation and optional light calls included. **Tax presentation also owner-approved:** NOK 249 is the total monthly consumer price including applicable VAT, itemised on the receipt. **Merchant/controller owner-approved 21 November:** Nerd Valley AS, its registered address and the configured support email. **Refund/withdrawal policy owner-approved and implemented:** statutory 14-day period, full initial refund even after calls, explicit early-start choice and separate withdrawal controls. Next: exact contractual notice/recipient-rule approval; actual Stripe merchant comparison and the effective provider tax and receipt settings must still be verified. See [tax implementation](tax-presentation.md). Automatic renewal, pause without pausing billing and cancellation at period end remain the established behaviour. | Confirm final price/tax display, merchant/controller identity, subscription/refund terms and the qualified consumer/privacy review in [legal/README](../../legal/README.md). Read current provider configuration; do not infer live tax treatment from the sandbox. |
| A4 · Live testing omitted | Owner explicitly dropped real-call and alert testing and approved implementing that plan. These tests are **waived for the initial launch; live audio and alert delivery are unverified**. | No test window or send is required. Retain automated synthetic tests and private agent configuration readback. Never label the waiver as a passed audio/delivery test. `UNBLOCK_AGENTS_VERIFIED` may later record configuration verification plus this owner waiver; keep it off until approved activation. |
| A5 · Activation | Not authorised. Public enrolment and live calls remain off. | After the remaining A2/A3 work, approve the initial audience, monitoring/rollback and exact activation. The public signup switch is not an invite-only gate; an invite-only launch would need a separate access restriction. |

`UNBLOCK_ENABLED`, `UNBLOCK_SAFETY_APPROVED`, `UNBLOCK_SCRIPTS_APPROVED`, `UNBLOCK_AGENTS_VERIFIED` and `UNBLOCK_LIVE_CALLS` remain off for this release. Automated tests use isolated synthetic flags and transports; these do not activate production or establish human/qualified approval.

## Approved launch call times · 19 November 2026

**Owner-approved.** Exact reply: “Yes, approve the daytime schedule for the initial launch. Let’s confirm primary and backup coverage next.” This approves the timing part of A1 and the window part of A2. Sole-operator ownership is now confirmed; daily availability is also approved and implemented locally; the consolidated response procedure is now owner-approved; qualified review, commercial terms and activation remain separate. Daytime configuration was subsequently deployed in PR67/68; live call and alert tests have now been owner-waived.

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

This implementation work can be handed over when the tested code is merged, the evidence and owner decisions above are recorded, the owner waiver of live-call/alert tests is recorded with those capabilities explicitly unverified, production activation is explicitly authorised and verified, and ongoing support/monitoring has an owner. This file does not approve itself or open enrolment.

## Web-test incident and availability implementation · 19 November 2026

Owner approval of daily check-in/Away is recorded in `operator-review.md`. The private server CLI, migration, placement lock/expiry and no-catch-up behaviour are implemented locally. Test evidence is filtered under `output/unblock-availability-*20261119.json` (not customer records).

The owner’s dashboard Web conversation failed because all three `capture_unblock` requests had empty session IDs and tokens. The server correctly refused them with 401; this was not a successful programme conversation despite the provider transport status. Registered app-created sessions remain mandatory. Never paste session credentials into chat or make the capture endpoint anonymous. The three existing private agents had stale greetings; reviewed scripts/greetings plus a missing-session explanation/end instruction were published and read back, with settings/tools and launch flags preserved. Prompt equality does not prove audible behaviour; the new guard has automated/configuration evidence; a real provider conversation is owner-waived and remains unverified. A blank dashboard Web test cannot exercise the full authenticated journey. If the owner later requests an optional test, use a newly configured isolated session with fresh authorisation.
