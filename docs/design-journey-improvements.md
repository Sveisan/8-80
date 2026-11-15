# Design and journey improvements · 15 November 2026

The weekly and Unblock journeys now explain the offer before booking, preserve work after validation failures, and make the next call and next action easier to find. Public weekly copy uses **“A weekly phone call”**, with a separate, visible **“Calls are with an AI”** disclosure before booking.

## Changes from the design review

| Review area | Implemented behavior |
| --- | --- |
| Support links | Weekly, account and legal pages exclude their email links from Cloudflare email obfuscation; Unblock protects each contact block and shows the address. The strict script CSP stays in place. This follows [Cloudflare’s documented HTML exclusion](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/). |
| Failed forms | Unblock contact and schedule errors retain editable values and consent, identify the invalid control, open its enclosing details and focus it. Schedule errors return to the schedule form. No OTP, CSRF token or submitted event/revision is echoed as a retained editable value. |
| Offer and disclosure | Weekly calls, Unblock and account access have consistent navigation. Weekly booking explains the call, approximate duration, recap and AI identity before the form. Optional voice, text and calendar preferences sit after the essential choices. |
| First-call handoff | Unblock reviews the chosen opening conversation and regular rhythm before checkout. Once payment is verified, the account explains what to expect and offers the existing contact card when a calling number is configured. The confirmation text includes the upcoming appointment, a permanent account route and contact-card link. |
| Closed enrolment | The page offers a human contact route while readiness checks continue to prevent paid enrolment. It does not collect a new waitlist or bypass operational approval. |
| Schedule complexity | New Unblock bookings start with no optional light calls. Choosing light calls reveals their evenings and time. A confirmed timezone, change control and live summary explain the opening date, regular days, monthly count, additional regular day for five or more calls, and optional light evenings. |
| Current commitment | Unblock puts the current agreed step near the next call, with history under a disclosure. Weekly account copy names commitments and goals. |
| Pause, cancellation and deletion | A paused Unblock account explicitly says billing continues; cancellation shows the end of the paid period. Whole-account deletion explains its scope across programmes. |
| Verification and recovery | Unblock shows a masked destination, explains expiry and recovery, uses distinct signup/account button labels and offers a dedicated resend that preserves signup details. Previous codes are invalidated and repeated resends are throttled. |
| Rescheduling | Weekly controls preview the dated appointment and distinguish one occurrence from the usual weekly time. Unblock describes its existing later-only move constraint accurately. |
| Mobile usability | Weekday labels remain on one line at normal and enlarged text sizes; narrow layouts reflow. Mobile feedback sits in document flow. Unblock sign-out uses secondary styling. |
| Policy coverage | The draft privacy and terms pages now describe Unblock data, monthly billing, optional calls, pause versus cancellation, and account access/deletion. They retain their draft status and do not replace owner/legal or paid-pilot approval. |

The initial review overlooked an existing Unblock payment-confirmation text. This change extends that text rather than adding a second message. Provider signature checks, authoritative subscription reads, product scoping, secure cookies, CSRF checks and launch-readiness gates remain authoritative.

## Verification

Run the repository’s full check plus browser suite against a disposable Postgres database:

```sh
DESIGN_PG_BIN=/path/to/postgres/bin node scripts/design/verify.mjs
```

When approving intentional screenshot changes, the visual references must be generated on the repository’s supported macOS/architecture:

```sh
DESIGN_PG_BIN=/path/to/postgres/bin node scripts/design/verify.mjs -- --update-snapshots
```

Verified on macOS 26.6.2 arm64 with Postgres 18.6:

- TypeScript, lint, design policy and generated design-export checks.
- 1,104 unit/integration tests with no database skips, plus four feedback tests.
- 63 browser checks: Chromium desktop and WebKit mobile journeys/accessibility, plus light/dark visual references at phone and desktop widths.
- Weekly: booking, verification, recovery, field-error retention, account access, commitment and scheduling controls.
- Unblock: retained contact and schedule errors, incorrect/correct OTP, paid access only after a signed provider event and authoritative subscription read, first-call preparation and contact card, persisted agreed step, later reschedule, pause/resume, cancellation, sign-out and recovered access to the same account state.
- Narrow layout checks at 320px and 375px with 100% and 200% text, including weekday text bounds; keyboard and automated accessibility checks.

Browser fixtures exercise production routes and real temporary database writes. SMS, email, subscription-provider reads and calls use synthetic adapters; no live call is placed and no real payment is created. Only the local HTTPS fixture ignores its self-signed certificate. Test endpoints exist exclusively in `tests/design/server.ts` and never in production routing. Cloudflare’s deployed edge behavior still needs a post-deployment smoke check. This work does not deploy the branch or approve the paid pilot.
