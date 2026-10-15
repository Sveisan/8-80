# Beliefs policy follow-up — verification and operations

15 October 2026. Implements the [approved owner policies](approved-policy-follow-up.md) on top of PR #6. This is local software evidence. No production deployment, launch flag, provider configuration, real call, message, charge or refund was changed during this work.

## Verification

Run `bash scripts/check-beliefs-local.sh` from the repository root. It starts a disposable loopback PostgreSQL database, applies all migrations, then runs typecheck, lint and the full shared suite with synthetic data and provider fixtures. It ignores inherited test database URLs. Keep the helper’s private log private.

Fresh local results: typecheck and lint passed; **702 tests passed, zero failed/skipped/cancelled**. This includes the shared weekly-product regressions. Drizzle generation also reported no schema drift. The populated upgrade test applies the previous migrations, inserts an existing paid enrollment, appointment and session, then applies migration 0026 and verifies their identity and content survive.

| Risk | Verification |
| --- | --- |
| Forced backlog or false completion | One/two prepared starts; missing confirmation; related additions; queue removal distinct from retirement; immutable prior score versions |
| Purchase overwrite / cross-programme callbacks | Concurrent new-programme requests; legacy checkout reference; late old-purchase refund; contradictory references; historical Stripe and mutable Lemon Squeezy prices/currencies |
| Unauthorized private changes | Owned programme selector, wrong-account access, wrong-purpose cookie, missing identity, CSRF and cross-origin rejection |
| Uncertain return delivery | Explicit one-time booking; duplicate claim/completion; signed caller confirmation; STOP; failed attempt remains unspent without automatic redial; operator release refuses live attempts |
| Refund misrepresentation | Fourteen-day boundary and unknown evidence; duplicate requests; delivery problems outside guarantee; human resolution without silent resume; stale retry cannot reopen resolved request |
| Retention damage | Failed notices defer cleanup; notice identity invalidates old pending reminders; exact-date extension; fair batches; duplicate cleanup; scoped export/delete preserves newer programme and weekly context |

Browser rehearsal on loopback preview covered verified synthetic signup, saved Oslo schedule, simulated payment, one prepared decision with no backlog, a related addition/removal, consecutive weekly reviews and completion, explicit included check-in booking, a chosen retention extension to 29 February 2028, a new unpaid programme and navigation back to retained earlier history. At desktop width 1280 and mobile width 390 there was no horizontal overflow; the application tab reported no warning/error console entries. This is a rehearsal, not actual voice or payment-provider delivery. Minor navigation/copy refinements after the rehearsal are covered by render/route regression checks.

Screenshots contain synthetic content only:

- [Desktop account](qa/policies/account-desktop.png)
- [Mobile account](qa/policies/account-mobile.png)

## Programme identity and migration

Migration `0026_hesitant_colleen_wing.sql` replaces the enrollment phone primary key with a programme UUID, retains the phone foreign key and a unique current-programme selector, backfills session ownership, and adds policy/refund fields. Existing outstanding checkout references stay `beliefs:{phone_hash}` on that original programme; new programmes use `beliefs:{programme_id}`. Existing paid amounts, schedules and encrypted history remain intact. A legacy completion with no known timestamp receives a full twelve-month retention period from first maintenance observation. An unknown first connection is not backfilled from a scheduled call.

For an approved deployment, stop relevant application/tick processes during the schema/code transition, take a private database backup, run the normal migrations before restarting the new code, and check health plus pending migrations. This migration changes the old primary-key assumption: do not run old and new code concurrently or simply roll application code back after multiple programmes exist. Prefer a reviewed forward fix. Any restore requires an agreed outage and reconciliation of purchases/calls since the backup; never drop retained programme data to make an old build fit.

This PR does not deploy or activate Beliefs. The independent weekly checkout was left unchanged.

## Refund and support operations

The account creates a durable request and holds that programme’s future calls. An operator SMS contains no contact or practice wording. A request is **not** a refund, and the application does not call a refund endpoint.

On the deployed server, from the repository with its existing private environment, the operator can list open requests:

```bash
npm run beliefs:requests
```

Output contains internal request/programme/provider purchase identifiers and eligibility dates, not names, phone numbers, API keys or personal practice content. Treat payment identifiers as internal operational data. Resolve eligibility and missing-service/charge questions with the customer, preserving statutory rights separately from the guarantee. The voluntary guarantee remains open when trustworthy first-connection evidence is unavailable. Process an approved actual refund in the provider’s controlled workflow, then verify the signed callback and authoritative purchase state reconcile to `refunded` on that exact programme. Never mark money returned based only on a request or a redirect.

If support resolved the case **without a refund**, and that outcome was confirmed with the customer, use the actual listed request ID:

```bash
npm run beliefs:requests -- close-resolved REQUEST_ID --confirmed-no-refund
```

The command only resolves a still-open case. It restores `active` financial standing only from `refund_requested`, leaves any other payment hold intact, and leaves unfinished practice paused. The customer explicitly resumes; future appointments are recomputed without catch-up calls. Another request after resolution goes through support; stale submissions do not create a new hold.

## Included check-in recovery

The weekly agent has a distinct `call_kind=checkin` branch aiming for three to five minutes, with no review score, discovery, preparation, sale or restart. A caller-confirmed reflection verified against the signed transcript marks the entitlement used. A failed/uncertain placement is not automatically redialled, marked used or silently offered as a fresh booking.

First inspect the provider’s call record and confirm that the uncertain attempt did **not** connect. Only then use the actual programme ID:

```bash
npm run beliefs:requests -- release-checkin PROGRAMME_ID --confirmed-not-connected
```

The command refuses an in-flight or already-used attempt, records the operator confirmation and releases the unused booking entitlement. It places no call. The customer must explicitly choose another appointment. If it connected or evidence is ambiguous, resolve it through support; do not use this release flag to assume non-delivery.

## Retention and erasure operations

Maintenance runs from the existing tick, including when Beliefs call-placement flags are off. Completion establishes a twelve-calendar-month deadline; batches rotate through due programmes so delivery failures cannot starve later notices. One content-free SMS is queued per programme/deadline. Acceptance is not delivery. A delivery receipt is copied into the programme before short-lived outbox pruning can remove it.

Automatic cleanup requires both the chosen deadline and thirty days after a delivered current reminder or explicit private-account acknowledgment. If SMS is opted out, suppressed, failed or unconfirmed, cleanup waits; `beliefs:requests` reports the overdue unacknowledged count. Operators must follow up through the agreed customer support process and direct the owner to the authenticated account. Do not reset opt-out or fabricate delivery evidence. The account offers export, explicit deletion or a later UTC date; an extension resets notice evidence and suppresses pending reminders bearing the previous deadline.

Scoped cleanup replaces this programme’s encrypted practice/session content with a minimal tombstone, clears its buffered webhook deliveries and preserves minimal financial/unused-check-in records. It refuses in-flight sessions. It does not expire unfinished paid progress, clear weekly memories, erase another programme or revoke an unused included check-in. Whole-account deletion is separately confirmed and still erases both products locally. Remote provider erasure, backups and statutory financial retention require the operating-company procedure; local tests do not prove remote erasure.

## Before publication or activation

Keep the existing launch gates off until their actual evidence exists: qualified urgent-response procedure and staffed operator/backup; approved scripts; three synchronized agent packs and updated capture schema; signed callback shape, dynamic variables, voicemail/AMD, interruption and audio checks; real one-time checkout/refund/return tests and price/tax confirmation; approved terms/privacy, provider/backups erasure and financial retention; measured call/support costs and controlled pilot approval. Existing legacy purchases with no stored product identity need provider review if catalogue configuration changes.

These are external activation requirements, not unfinished implementation hidden by passing local tests. The next immediate step is PR review and merge. No terminal action from the owner is needed to review this PR.
