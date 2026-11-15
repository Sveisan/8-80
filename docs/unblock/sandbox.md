# Private Unblock sandbox

This runner exercises the production routes and real Stripe test API without opening public enrolment. It binds only to `https://127.0.0.1:8793`, uses a separate local Postgres cluster on port 55586 and database `unblock_sandbox`, and generates its own encryption key. It never loads a production `.env`.

Phone calls and external email are blocked. SMS is captured locally for synthetic numbers `+47923009xx`; it is not a second production SMS-delivery test. The page banner identifies the sandbox. Synthetic readiness flags do not approve scripts, staff coverage or public launch.

## Prepare

Use a clean checkout with its locked dependencies installed. Install an official checksum-verified Stripe CLI in `output/unblock-sandbox/bin/stripe`. Use Stripe's sandbox-only login or claimable-sandbox creation; capture provisioning output privately as `output/unblock-sandbox/stripe-provision.private.json`. Keep permissions at 600 and never print its contents. This task's temporary claimable sandbox is disposable; see the credential note in [launch approval](launch-approval.md).

```sh
node scripts/unblock/provision.mjs
DESIGN_PG_BIN=/path/to/postgres/bin npm run unblock:sandbox
```

The provisioning helper refuses live keys and live payment links. It creates the test product, NOK 249 monthly price, test payment link and local webhook signing credentials. The runner launches the official Stripe listener with test credentials and forwards only the required snapshot events to the local HTTPS endpoint. No public tunnel or public webhook endpoint is created. The controlled local test certificate is trusted only by the isolated test browser; production TLS verification is not weakened.

Without Stripe test credentials, the app can start but enrolment/payment stay unavailable. No fake payment gateway is used by this runner.

## Exercise the journey

Use a reserved test email such as `unblock.qa@example.invalid` and a synthetic phone such as `+4792300901`. Obtain the locally captured code through:

```sh
node scripts/unblock/inspect.mjs code
node scripts/unblock/inspect.mjs state
node scripts/unblock/inspect.mjs hooks
node scripts/unblock/provider-proof.mjs proof
```

The code is written to a private local file, not printed. The fixture routes require the local `fixture.key` capability, accept only synthetic phones, and exist exclusively in this separate development server. They are never mounted by production.

Test a declined card first, then Stripe's documented successful test card. Only actual signed Stripe events plus an authoritative subscription read may grant access. Check the paid account, opening date, frequency, no-light preference, customer portal, pause/resume, period-end cancellation, and recovered access to the same account. The provider proof returns test mode, paid invoice amount/currency and cancellation state without exporting payment sessions or credentials.

## Stop and clean up

After recording proof:

```sh
node scripts/unblock/provider-proof.mjs cleanup
```

This cancels only subscriptions using the task-created test product and deactivates its test payment link. No live object is accepted. Stop the runner with Ctrl-C; it stops its app/listener/database and retains the private test data for inspection. The completed checkout stays disabled after cleanup; explicitly reopen the test link before another authorised test run. Production services are unaffected.

`output/unblock-sandbox/claim.private.json` contains the private claim link and expiry. Claiming or deleting the temporary sandbox requires Stripe Dashboard access. Revoke/retire the exposed temporary test credential there; do not promote this disposable environment to a permanent shared sandbox.

## Checks

```sh
npm run unblock:sandbox:check
DESIGN_PG_BIN=/path/to/postgres/bin node scripts/design/verify.mjs --unit
DESIGN_PG_BIN=/path/to/postgres/bin node scripts/design/verify.mjs --browser -- --grep-invert @visual
```

Owner approvals and voice-call verification remain in [launch approval](launch-approval.md). Keep keys, claim URLs, cookies, captured codes, provider sessions and synthetic state files under ignored, private `output/`, outside commits and PR descriptions.
