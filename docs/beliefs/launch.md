# Launch and operating handoff

**Owner decisions, 15 October 2026:** Pricing, flexible start, queue removal, programme scope/return, voluntary refunds and history-retention policies are now confirmed in [approved policies and follow-up build](approved-policy-follow-up.md). They are implemented in the follow-up described in [policy verification and operator runbook](policy-verification.md); the earlier owner-task table below is historical where it still calls these choices undecided. External safety, provider, payment, legal and deployment requirements remain outstanding.

## Sequence

1. **Shared safety, before real testers.** Confirm operator and backup ownership, coverage during every permitted call window, response expectations, encrypted review access, keyword test cases, false-positive handling, person-led check-in, and release of holds. Tier-1 messages now enter the durable outbox; tier-2 uses the existing digest. Test the path on fake conversations, including carrier opt-out. Approve the urgent spoken response with an appropriate qualified reviewer. Do not set safety-ready from a code test alone.
2. **Agent pack.** Review the three original scripts against the source/claims ledger. Any further source review must use public accessible material and cannot be described as a representative transcript corpus without that evidence. Use [Speechify API sync](../speechify-api-sync.md) to create/update the separate onboarding/daily/weekly agents, upload prompts and variables, disable provider memory/recording, configure hang-up on voicemail/AMD and set the completion callback. Capture-tool creation/attachment is not automated yet; verify its provider schema and signed callbacks separately. Test complete, interrupted, passed, silent, keyword and mid-call edit flows. Verify real delivery of dynamic variables, tool substitution, session IDs and callback transcript shape. Keep approval flags false until these real-system checks pass.
3. **One-time checkout.** Create a distinct non-recurring product at the existing base monthly amount/currency. Configure its hosted checkout, base monthly price identity, signatures and private-account return route. Retrieve/compare provider price state; test successful/delayed/failed payment, wrong product, duplicate/reordered callbacks, refund, dispute and programme-only identity. Do not collect live money until the call service can actually be delivered.
4. **First controlled pilot.** Run the module independently and with a base subscription. Measure one- and two-decision coverage before offering a three-slot option. Observe weekly reflection and retirement, including missed weeks and reactivated old decisions during an unfinished programme.
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

The main checkout and its preview have not been changed. This checkout retains the baseline module migrations 0023/0024 and adds migration 0025 for nullable occurrence-resume pointers. Apply pending migrations **before** restarting updated control/tick code. Keep all BELIEFS_ launch flags false during deployment. Check health and the ordinary weekly journey before enabling the module.

Use existing server update procedures without printing .env contents or credentials. No live deployment is part of the local test result. On rollback, disable BELIEFS_LIVE_CALLS and BELIEFS_ENABLED first, retain encrypted programme data for recovery, and revert application code. Do not drop the module tables or turn off safety holds as a rollback shortcut.

## Current continuation handoff — 13 October 2026

Recovered and reverified **15 October 2026** in the same checkout, then packaged for PR review on `codex/beliefs-continuation`: the complete package remains in place; the score-range guard and local rerun helper were finished. Fresh typecheck/lint and the disposable-database suite passed **673 tests**, with no failures/skips. See [current verification](continuation-verification.md) for today's browser proof and evidence boundaries. The owner tasks below still apply; this is not a release or approval.

The consolidated [specification](product-spec.md), [actual journey/sendout/recovery map](first-month-map.md), [contracts](contracts.md), three original scripts, [research ledger](research.md), [synthetic text rehearsals](rehearsal.md) and [current local verification](continuation-verification.md) are the review package. The local diff starts at `8cee2a0`; it is not a merged release or a server update. Migration **0025_old_polaris** adds nullable occurrence-resume pointers to the existing enrollment; existing migrations 0023/0024 are retained. No second module implementation or account hierarchy was created.

Owner tasks are outside this local implementation:

| Owner / location | Concrete task | Prerequisite and evidence to record |
| --- | --- | --- |
| Product owner, specification review | Review the implemented approved policies and pilot economics | Owner choices are recorded in approved-policy-follow-up.md; verify actual provider delivery and customer comprehension before activation |
| Operating company + qualified reviewer | Resolve urgent spoken-guidance conflict; approve procedure and permitted response windows | Named primary/backup, acknowledgment/response expectations, failed-delivery/uncertain alert escalation and outside-hours handling. A configured phone or nightly digest is not proof |
| Voice reviewer / Speechify console or approved test account | Attach verified capture/end-call tools; check effective flow overrides; revise source prompt settings only after separate authorization | Real variable replacement, exact webhook config/signature/wrapper, signed caller-turn shape; AMD/voicemail; original wording, pacing, silence, interruptions, holds and failed checks. Historical settings read-back is not this evidence |
| Payment owner / provider test mode | Verify distinct one-time product against approved base amount/currency; tax, receipt, owner binding, return, delayed/failed/duplicate/reordered payment, refund/dispute | Current authoritative reads and customer journey. Browser return alone cannot confirm paid; no live charges until delivery is possible |
| Privacy/operations owner | Confirm legal/support contact/hours and local/provider/backups retention/erasure | Actual deletion/export across retained records and provider-owned data, without assuming local cascade removes remote financial/legal records |
| Pilot owner | Agree targets, denominators, cost review and withdrawal/completion reporting | Meaningful coverage, understanding, day-7/day-28 return, usefulness/burden, concrete change, durations, cost and operator workload. No success inferred from a score drop |
| Release owner, reviewed deployment terminal | Merge reviewed diff, identify actual release commit, backup privately, apply migrations before services, verify both products | Use the actual reviewed merged commit. Then separately authorize any provider changes, production deployment, real participant calls/messages/charges and activation |

## Exact local terminal rerun

The requested local verification has already been performed; no terminal action is needed to read/review the results. For a repeat on this inspected Mac checkout, copy into the **ordinary local terminal**, without sudo:

```bash
cd /Users/eiriknerdal/Documents/ChatGPT/8and80/belief-module
bash scripts/check-beliefs-local.sh
```

Prerequisites: locked dependencies, Node 22+, an existing PostgreSQL installation/test bundle with `initdb`, `pg_ctl`, `postgres`, `psql`, and free test port 15674. On this Mac, if temporary text resources have expired, the script can privately extract the exact already cached PostgreSQL 18.4 archive using npm's integrity-checking cache reader. It makes no network request or installation, changes no shared cache/runtime and removes its temporary extraction afterwards. It discards inherited TEST_DATABASE_URL and creates/removes its own database through the existing repository runner. Its log is private; copy only the fixed status report, never log contents. This command does not update the server, provider configuration or launch flags.

No server update command is supplied for this unmerged continuation: the current server release/check-out state has not been inspected in this side conversation. Prepare the pinned update only after the reviewed merge and separate deployment authorization, using that actual server path/commit and existing private-backup procedure. Prompt sync `--apply`, tool attachment, `--write-ids`, payment setup and scheduler resume are provider/production mutations, not local review steps.

## Launch / rollback checklist

- Review product and operating decisions above, with named owners and dated evidence.
- Verify actual customer delivery of each independent product and shared STOP/safety controls in an authorized test environment; do not label fake preview payment or historical rehearsal live readiness.
- Confirm approved terms, support hours, coverage, payment/return/refund and provider erasure workflow before enrollment opens.
- Review migration 0025 and private backup/restore rehearsal; apply 0023–0025 where pending before the updated application.
- Run fixed-status health/migration/readiness checks and the ordinary weekly journey with launch flags off.
- Set approval/verification gates only when their real external evidence exists; enabling enrollment/live calls requires separate authorization.
- Monitor transport acceptance/delivery/uncertain/failed states and actual human acknowledgment. Name backup and approved failure escalation; document outside-hours response without promising emergency coverage from a support inbox.
- Roll back by disabling module enrollment/live placement first, preserving global STOP and safety holds. Keep encrypted module records and nullable additive columns for recovery; revert only the reviewed application release. Never drop personal history or clear a hold to restore service.
- Reconcile pending/uncertain provider/payment operations privately before any retry. Do not redial an uncertain ring or repeat an uncertain charge.

Shareable fixed-status vocabulary: `SOFTWARE CHECKS: PASS/FAIL`, `MIGRATIONS: CURRENT/PENDING`, `WEB: HEALTHY/UNCONFIRMED`, `PROVIDER TOOLS: VERIFIED/UNVERIFIED`, `PAYMENTS: VERIFIED/UNVERIFIED`, `SAFETY PROCEDURE: APPROVED/UNAPPROVED`, `HUMAN COVERAGE: VERIFIED/UNVERIFIED`, `BELIEFS LIVE: OFF/ON`, `SCHEDULED CALLS: PAUSED/ACTIVE`. Every status needs current supporting evidence; do not populate a live status from this local handoff.
