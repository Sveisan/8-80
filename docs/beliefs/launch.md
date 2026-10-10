# Launch and operating handoff

## Sequence

1. **Shared safety, before real testers.** Confirm operator and backup ownership, coverage during every permitted call window, response expectations, encrypted review access, keyword test cases, false-positive handling, person-led check-in, and release of holds. Tier-1 messages now enter the durable outbox; tier-2 uses the existing digest. Test the path on fake conversations, including carrier opt-out. Approve the urgent spoken response with an appropriate qualified reviewer. Do not set safety-ready from a code test alone.
2. **Agent pack.** Review the three original scripts and obtain the outstanding exact-show transcript evidence. Use [Speechify API sync](../speechify-api-sync.md) to create/update the separate onboarding/daily/weekly agents, upload prompts and variables, disable provider memory/recording, configure hang-up on voicemail/AMD and set the completion callback. Capture-tool creation/attachment is not automated yet; verify its provider schema and signed callbacks separately. Test complete, interrupted, passed, silent, keyword and mid-call edit flows. Verify real delivery of dynamic variables, tool substitution, session IDs and callback transcript shape. Keep approval flags false until these real-system checks pass.
3. **One-time checkout.** Create a distinct non-recurring product at the existing base monthly amount/currency. Configure its hosted checkout, base monthly price identity, signatures and private-account return route. Retrieve/compare provider price state; test successful/delayed/failed payment, wrong product, duplicate/reordered callbacks, refund, dispute and programme-only identity. Do not collect live money until the call service can actually be delivered.
4. **First controlled pilot.** Run the module independently and with a base subscription. Measure two-decision coverage before offering a three-slot option. Observe weekly reflection and retirement, including missed weeks and reactivated old decisions during an unfinished programme.
5. **Commercial release.** Review actual call costs, retention, helpfulness, support workload, terms and provider retention/deletion. Release only after the gates below and genuine call evidence.

## Configuration (names only; keep values on the server)

| Name | Meaning |
| --- | --- |
| BELIEFS_ENABLED | Expose enrollment only after all prerequisites pass |
| BELIEFS_LIVE_CALLS | Allow the shared tick to place module calls |
| BELIEFS_SAFETY_APPROVED | Reviewed procedure and actual human response coverage |
| BELIEFS_SCRIPTS_APPROVED | Original script and source review complete |
| BELIEFS_AGENTS_VERIFIED | Three agents, tools, variables, transcript callbacks and AMD verified |
| BELIEFS_PRICE_VERIFIED | Amount/currency/tax display and one-time checkout verified |
| BELIEFS_PRICE_LABEL | Public amount and currency, no credentials |
| BELIEFS_PRODUCT_ID | Stripe one-time price ID, or Lemon Squeezy one-time variant ID |
| BELIEFS_BASE_PRICE_ID | Stripe existing monthly price ID, or Lemon Squeezy monthly variant ID |
| BELIEFS_CHECKOUT_URL | Provider-owned HTTPS hosted checkout URL |
| BELIEFS_TOOL_SECRET | Independently generated random secret, at least 32 characters; never speak, log or paste it into chat |
| BELIEFS_ONBOARDING_AGENT_ID / DAILY_AGENT_ID / WEEKLY_AGENT_ID | Three distinct agent IDs; each name has the BELIEFS_ prefix |
| BELIEFS_COVERAGE_START / BELIEFS_COVERAGE_END | Human response window in OPERATOR_TZ, HH:mm; 00:00–24:00 only with staffed coverage |
| BELIEFS_SUPPORT_HOURS | Honest public human contact/response hours |

Existing DATA_ENCRYPTION_KEY, PUBLIC_URL, support/company metadata, SMS, payment API/signing, Speechify API/signing and OPERATOR_PHONE/BACKUP must be configured. Presence checks are not proof of a working provider or staffed coverage.

## Agent tool

POST the provided request schema to `https://your-public-origin/beliefs/tool`. The tool name in scripts is `capture_belief`. Session ID and scoped session token are per-call dynamic variables, not static enrollment IDs or shared API credentials. The agent must send these tool arguments from the supplied variables and never speak them. Send the exact caller turn as caller_text. Numeric review week is server-owned, so do not supply it.

The server returns held:true immediately when caller keyword detection fires, or after STOP/human hold. It stages valid commands and returns the latest provisional practice/IDs. Signed completion reconciles the literal caller words before canonical state changes. Tool runtime/provider schema is a deployment verification gate, not assumed proven by local TypeScript tests.

## Provider compatibility

[Speechify outbound call API](https://docs.speechify.ai/voice-agents/api-reference/v1/agents/outbound-calls): dynamic variables and idempotency headers; AMD inherits the verified stored agent configuration. There is no blanket retry of an uncertain ring. Completion signatures reuse the existing verifier.

[Stripe Checkout retrieval](https://docs.stripe.com/api/checkout/sessions/retrieve): verify payment mode, single line item, distinct one-time price, paid intent/charge, amount and monthly reference price. Listen for checkout completed/async success/async failure and charge refund/dispute events at the existing payment webhook.

[Lemon Squeezy orders](https://docs.lemonsqueezy.com/api/orders/the-order-object): verify paid order, one order item/variant, monthly reference amount, no subscription/setup fee/discount and store currency. Listen for order_created/order_refunded. Current compatibility reads still use documented backwards-compatible variant price fields; migrate to [Price objects](https://docs.lemonsqueezy.com/api/prices/the-price-object) before a provider removes those fields. Missing fields fail closed.

No card/address is stored locally. The private purchase record keeps IDs, amount, currency and paid state. Refunds/disputes hold access. Application pause or completion never issues an automatic financial transaction.

## Verification and pilot rubric

Required automated properties: encrypted independent state, scoped account access, OTP product isolation, duplicate callbacks, caller-word reconciliation, no false full-coverage claim, consecutive-period retirement, version resets, bounded active slots, no premature backlog activation, DST/local scheduling, no catch-up ringing, global STOP/shared safety holds, single neutral notices, complete export and erasure.

For real calls, measure:
- percent of selected decisions spoken by the caller, evidence and balanced reflection coverage, and confirmed score coverage;
- day 7/day 28 weekly return and caller-rated usefulness, with withdrawals and passes reported;
- actual call duration at two and three decisions, interruptions, provider latency and silence preservation;
- missed/rejected calls, delivery acceptance versus delivery, retry anomalies and collisions with base calls;
- human review volume, time to review, coverage failures and incorrect keyword holds.

Safety/authorship/privacy failures are release blockers. Engagement and benefit targets should be agreed before a pilot; do not label arbitrary percentages as research-proven.

At the requested rhythm, 28 days can use approximately 93–132 connected minutes (25–30 onboarding, 28 daily calls at 1–1.5 minutes, four weekly calls at 10–15 minutes), before retries, provider overhead and human support. More beliefs can extend the programme. A one-time fee equal to one base month needs a measured cost review; do not assume it is sustainable.

## Deployment and rollback

The main checkout and its preview have not been changed. This branch adds two migrations creating module enrollment/session tables, a global call-stop flag and signup product discriminator. Apply migrations **before** restarting updated control/tick code. Keep all BELIEFS_ launch flags false during deployment. Check health and the ordinary weekly journey before enabling the module.

Use existing server update procedures without printing .env contents or credentials. No live deployment is part of the local test result. On rollback, disable BELIEFS_LIVE_CALLS and BELIEFS_ENABLED first, retain encrypted programme data for recovery, and revert application code. Do not drop the module tables or turn off safety holds as a rollback shortcut.
