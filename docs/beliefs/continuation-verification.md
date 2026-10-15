# Current continuation verification — 15 October 2026

The authorized local continuation was recovered from the expired chat and completed in the existing `codex/beliefs-call-rapport` checkout, then packaged for PR review on `codex/beliefs-continuation`. Implementation and verification start from `8cee2a09a6a1342c1a234d4afef122ceb1f889e9`; the PR base `9cdbfb6` has the identical source tree. This is not a deployed release. All test information and preview content are synthetic. No production deployment, provider write, real call/message/charge or launch-flag change was performed.

## Fresh recovery evidence — 15 October

The inherited patch and deliverables were audited against the continuation brief. Two remaining local problems were fixed:

- A literal number in an unresolved range such as “one or two” could be accepted as a weekly score. English/Norwegian ranges now require a subsequent explicit choice or short numeric answer. Tests cover ranges, clarification, a negated choice, and the durable two-period retirement boundary. This finite wording guard is not general language understanding; unclear wording still requires clarification and provider review.
- The owner rerun selected an expired temporary PostgreSQL bundle whose text resources were gone. The helper now checks the resources and can privately extract the exact existing npm-cached PostgreSQL 18.4 archive, restoring its required library aliases. It uses no network or install and changes no shared runtime. The extraction and disposable database are removed after the run; the private log remains.

| Check | Fresh result | Evidence boundary |
| --- | --- | --- |
| `bash scripts/check-beliefs-local.sh` | PASS: typecheck, lint, **673 tests passed; 0 failed, skipped or cancelled** | Final full run after the last protocol change; includes the required disposable-database suite. An earlier successful run also had 673; these are not distinct tests |
| Database | PostgreSQL 18.4, own temporary cluster on loopback port 15674 | Stopped and removed by the runner; no production database |
| Script / diff | `bash -n` and `git diff --check` PASS | Verified before PR publication; no deployment |
| Separate weekly checkout | Clean at `57910c6` | Read-only check; no changes to its code or running preview |
| Browser journey | PASS: synthetic join/code, schedule, fake purchase, outcome, three mapped items, two prepared decisions, understanding, account, move-one, pause/resume and usual-time/back navigation | Only the loopback preview; actual provider payment, OTP delivery and audio remain unverified |
| Browser layout / console | Desktop 1265px content width; mobile 375px content width at a 390×844 viewport, no horizontal overflow; keyboard focus outline 3px; no captured warnings/errors | Browser zone Europe/Oslo; temporary viewport reset. Cross-zone/DST behavior remains covered by local tests rather than travel-device observation |
| External / launch | No provider writes, calls, messages, charges, deployment or flag changes | The external and operating prerequisites below remain unresolved; no approval is inferred from these tests |

The account showed the moved call on **16 October at 09:30 CEST**, with usual daily practice still **08:30**. Fresh synthetic screenshots: [desktop](qa/recovery-account-desktop-2026-10-15.png), [mobile](qa/recovery-account-mobile-2026-10-15.png). The [preview](http://127.0.0.1:8773/beliefs/account) was restarted for review; its data remains ephemeral and disappears on expiry/restart.

No terminal action is needed now. Next owner action: review the outstanding product decisions in [the specification](product-spec.md) and assign the named external reviewers in [launch.md](launch.md). Local implementation and documentation are complete; live readiness is not established.

## Historical execution evidence — 13 October

Final source verification finished on 13 October, before this report was written at approximately 15:17 Europe/Oslo. These counts replace neither historical counts nor external checks.

| Check | Current result | Scope |
| --- | --- | --- |
| `npm run check` | PASS: typecheck, lint, **671 tests passed; 0 failed, skipped or cancelled** | Ran with an explicitly owned disposable PostgreSQL URL, so database tests were required rather than skipped |
| `npm run test:db` | PASS: **671 tests passed; 0 failed, skipped or cancelled** | Separate full invocation against the same isolated temporary cluster; not 1,342 distinct tests |
| Database | PostgreSQL 18.4 native test bundle, loopback port 15673 | Fresh private temporary data; no production connection. Cluster stopped and its data removed after the run |
| Owner rerun helper | Executed successfully during continuation: typecheck/lint/disposable DB suite PASS | `scripts/check-beliefs-local.sh`; ordinary local terminal, no sudo, private log and fixed summaries. Final counts above come from the final two invocations |
| `git diff --check` | PASS | Review formatting; no commit or push |
| Separate weekly checkout | Clean at `57910c6` after continuation | No writes to its source or interference with its running preview |
| Local readiness doctor | Live OFF; external approval/verification prerequisites unmet | Configuration names/status only. This does not report the production server's state |

Detailed execution logs are private temporary files and are not included in the review package. Only counts/status are reported. Test providers are fakes; HTTP response fixtures do not prove provider delivery.

## Implemented and locally exercised

| Area | Current evidence / practical result |
| --- | --- |
| Product independence | Module-only and combined fixtures preserve the base weekly counter, profile, memories, trial and subscription; separate entitlement/consent/schedules. Programme preferred name reaches call context without sharing base memories or support email |
| Onboarding / preparation | Verified partial stages resume; missing outcome, evidence, balance, opportunity or understanding cannot falsely finish. Two active decisions, hard cap three and genuine backlog rule retained; insufficient material has an honest continuation/support explanation |
| Backlog | Ordered selection reserves a vacancy. Queued items cannot be prepared early. Legacy stored preparation becomes preparing when selected and needs fresh confirmation; no automatic activation after retirement |
| Daily / weekly | Pass differs from completed coverage; no daily call without active decisions. Server periods, missing weeks, duplicates, changed versions, simultaneous retirements and completion boundaries exercised; new/revised decisions cannot score in the same weekly session |
| History / return | Changed decisions archive prior evidence, reflection, opportunity and scores privately. Reactivation stays within cap on unfinished programmes; completed programmes cannot reopen through pause/resume/reactivate |
| Authorship / save integrity | Scoped/expired/invalid session checks, empty check rejection, caller-only signed whole-turn spans, brief agreement, final disagreement, changed retries, reserved event IDs and concurrent browser edits. Provisional capture is explicitly distinct from canonical verified save |
| Scheduling | Active usual-time edits require no fictitious onboarding date. Move/skip preserves usual cadence; stale retries and in-flight changes reject. Saved IANA zone, Oslo DST gap, cross-zone base collisions, coverage, STOP/holds and no accumulated catch-up ringing exercised |
| Payments | Authoritative synthetic Stripe/Lemon reads, wrong product/owner, delayed/failed/duplicate/reordered events, partial refund/dispute hold and current paid state. Checkout requires complete readiness. No actual tax/receipt/card/payment transport verification |
| Access / privacy | Product-specific OTP/access expiry, CSRF, private headers, escaped rendering, base-link isolation, full private export and local account deletion. Internal operator notification contacts and nested serialized tool credentials are excluded from customer exports |
| Safety / failures | During/post-call signals, negation/history/third-party/indirect/mis-transcribed examples and known misses, shared holds, STOP precedence, failed/repeated Tier 1 delivery and durable Tier 2 digest tested. Keyword detection remains limited; human acknowledgment and urgent wording are not approved by these tests |
| Placement / sendouts | Timeout/uncertain placement, voicemail/AMD fixtures, duplicate completion, one recovery notice per occurrence, no routine successful daily recap and completion notice replacing normal review notice. No real ringing/audio/SMS is claimed |
| Measurement | Minimized encrypted closed snapshots retain eligibility, versions, capture kinds and canonical verification. Older missing metadata stays unknown. Period-3 context and original weekly questions cover usefulness, burden, concrete change and rhythm; no structured survey or efficacy claim |

Focused additional cases are in `services/voice/test/beliefs-continuation.test.ts` and the expanded `beliefs-db.test.ts`; the full existing weekly/shared suite also passed. Test assertions exercise behavior and failure cases, not only rendered implementation strings.

## Browser and editorial evidence

Final synthetic preview: [Beliefs account](http://127.0.0.1:8773/beliefs/account), with a separate port-scoped preview cookie. No call, SMS or payment transport exists in this preview. Memory expires after one hour and clears on restart.

The final browser walkthrough covered signup, verification/new-code back path, saved Oslo times, simulated purchase, outcome/discovery, two complete decisions, understanding, account and move-one-call. Earlier continuation walkthroughs also covered usual-time editing, daily pass/reflection, weekly review and pause/resume navigation. The production route restrictions and durable effects were exercised separately in the database tests; preview controls are not production capabilities.

At **390 × 844**, the final account had page width 375 with no horizontal overflow. Next call showed 09:30 CEST after moving it, while the saved daily time remained 08:30. At **1280** desktop width, page width was 1265, and keyboard focus on “Move only this call” had a visible solid 3px outline. The temporary viewport override was reset.

- [Actual mobile screenshot](qa/continuation-account-mobile.png)
- [Actual desktop screenshot with keyboard focus](qa/continuation-account.png)

These screenshots contain invented examples only. Browser local-zone display was observed in Europe/Oslo. Cross-zone/DST schedule behavior and the display-only/no-schedule-mutation contract were tested locally; actual travel devices, screen readers, provider audio pacing, thinking silence and interruptions remain external observation tasks.

The three original script packs include ordinary flow and relevant confusion, practical-constraint, missing-content, pass, interruption, stale-backlog, ambiguous-score, failed-check/save, hold and unfinished-close branches. [Constructed text/tabletop rehearsals](rehearsal.md) state their evidence limits explicitly. They are not generated provider dialogue or real audio. The [source/claims ledger](research.md) distinguishes research, communication guidance, transcript/article access and product hypotheses.

## Review scope and compatibility

Migration **0025_old_polaris.sql** adds only nullable daily/weekly occurrence-resume timestamps to the existing enrollment table. Apply pending migrations before updated application code; preserve records on rollback. Optional encrypted history/contact/event-digest fields retain schema 1 compatibility. Existing event IDs without a digest fail closed on retry rather than treating an unknown changed request as identical; old discarded decision history is not reconstructed.

The diff also changes shared Tier 2 digest delivery to use the existing durable outbox, and filters internal operator contacts/serialized credentials in exports. Those shared behaviors deserve reviewer attention even though the separate weekly checkout is untouched. Real delivery acceptance, uncertainty and human response must be checked operationally.

## External and operating evidence still required

| Category | Status / next evidence |
| --- | --- |
| Product decisions | One-time implementation preserved. Direct review needed for the expired subscription difference, insufficient genuine backlog, outdated queued material/removal, completed-programme return, withdrawal/refund and retention policy |
| Safety procedure / coverage | UNAPPROVED / UNVERIFIED. Resolve urgent spoken-guidance conflict with qualified review; name primary/backup, acknowledgment expectations, failure escalation and outside-hours handling |
| Speechify tools / audio | UNVERIFIED for these revised packs. Separately authorize provider writes, verify capture/end-call attachment, exact wrapper/signature/turn shape, variable substitution, effective flow settings, greeting, AMD/voicemail, language, silence and interruption |
| Payment customer delivery | UNVERIFIED externally. Approved distinct one-time product, current amount/currency/tax, receipt/return, delayed/refund/dispute journey in authorized provider test mode |
| Legal / support / erasure | Operating company review of consent, truthful contact/hours, withdrawal terms and retained local/provider/backups data; actual remote erasure workflow |
| Pilot / economics | Agree targets before interpreting coverage, understanding, day-7/day-28 return, burden/usefulness, concrete action, duration, cost and operator workload. Completion is distinct from abandonment; falling scores do not establish effectiveness |
| Release | No merged local release or inspected server update in this side conversation. Review diff and migrations first; separately authorize production/provider changes and activation only after actual external prerequisites |

No terminal action is needed now to read the results. The concrete next owner action is to review [the product decisions](product-spec.md) and assign the qualified safety/provider/payment reviewers in [the operating handoff](launch.md). Its exact local rerun command is safe for the inspected checkout; server commands must be pinned to the actual reviewed merged release and inspected host.

**Local software and review package: complete. Live product readiness: not established.**
