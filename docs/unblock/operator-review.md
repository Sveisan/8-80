# Unblock operator procedure · approved operating controls

**Operating controls, core response, Norway routing and consolidated safety/privacy procedure owner-approved, 19 November 2026.** This record makes the owner decisions explicit. The current policy and private command reference are [the consolidated procedure](escalation-handoff.md). Qualified review remains required before safety approval/activation; this record is not clinical triage.

## Approved ownership and hours

- Sole operator: Eirik, confirmed by the owner on 19 November 2026 for the initial launch. The owner clarified “Same” as “Sole operator”.
- Backup: none appointed, by the owner's explicit choice. This supersedes the earlier draft request for a named backup; do not keep requesting a backup name. Daily availability is approved and implemented locally; the five-minute acknowledgement and failure-to-Away rule are also owner-approved; the core speech, routing and four operating-policy decisions are now approved; qualified review remains separate.
- Owner-approved staffed period (19 November 2026): Monday–Friday, 09:00–17:00, Europe/Oslo. Calls start 09:00–16:30; optional light calls are suggested for Mon/Wed/Fri at 16:00.
- Approved release settings, to apply after staffing/procedure and release checks: `UNBLOCK_COVERAGE_DAYS=1,2,3,4,5`, `UNBLOCK_COVERAGE_START=09:00`, `UNBLOCK_COVERAGE_END=17:00`.
- The owner approved a five-minute acknowledgement target and Away on alert/acknowledgement failure. Qualified review must settle the exact emergency response when Eirik cannot respond. Calls should not be offered outside the agreed staffed coverage.

## Daily availability rule · approved 19 November 2026

**Owner-approved and implemented locally.** Exact reply: “Yes, approve the daily check-in and Away rule. Go ahead and implement it, then let’s review the urgent-response procedure next.” The weekday hours remain the maximum window; placement also requires today’s explicit check-in.

- Eirik marks Unblock **Available** each working day before calls may start. Without that day's check-in, no opening, regular or light call starts.
- Marking **Away** immediately blocks new Unblock call starts. It does not abruptly end an active conversation.
- The availability check-in expires at 17:00 Europe/Oslo and requires a fresh manual check-in for the next working day. The existing 16:30 last-start limit and all other release/consent/STOP/review gates remain authoritative.
- Returning to Available does not release individual safety holds or override a caller's STOP request.

The qualified response procedure must still cover an active incident or unexpected inability to respond. Billing/refund treatment for operator-caused downtime remains part of the separate commercial decision; this availability decision does not approve a billing policy. Before launch, verify the availability control and pending/due-call handling. No new person or public launch activation is authorised by this decision.

## Private operator control · implemented locally

After migration `0037_unblock_availability`, the persistent singleton starts Away. Use an authenticated server SSH session; there is no public operator endpoint:

```sh
npm run unblock:availability --workspace services/voice -- --status
npm run unblock:availability --workspace services/voice -- --available
npm run unblock:availability --workspace services/voice -- --away
```

Available can be set on an Oslo working day before 17:00, including before 09:00. Calls still require the 09:00–16:30 start window, every readiness gate, payment/consent and individual STOP/review checks. Repeated Available during the same active check-in preserves its original start. A restart does not refresh it. Away is confirmed only after an already-started provider placement request finishes (bounded timeout); subsequent placements are blocked. An active conversation keeps its safety tool and signed completion.

Slots due before the current check-in are missed, including a short Away interval; they are not caught up after returning. Regular/opening missed slots use the existing neutral account notice; light slots are skipped silently. Billing is unchanged pending the commercial decision.

`UNBLOCK_OPERATOR_PHONE` must be configured privately to Eirik's agreed alert contact. It has no fallback to shared weekly/Beliefs operators. Unblock's urgent alert and weekday 09:00–17:00 daily review reminder are scoped to that contact; Unblock cases are excluded from the shared digest. No real alert delivery or acknowledgement has yet been verified. The incident system now supplies acknowledgement and operational failure blocking; the operating policy and core speech are now approved; qualified review remains separate. Live alert tests were owner-waived, so delivery and acknowledgement remain unverified.

## Urgent-response operational procedure · owner-approved 19 November 2026

**Approved by Eirik:** “Yes, approve the operational procedure with the five-minute acknowledgement target. Go ahead and implement it, then let’s review the exact spoken response next.do the merge”. The operational workflow below is implemented. The five-minute target is an operator commitment, not a clinical recommendation or a promise of a callback to the caller. The core wording is now owner-approved; routing and the remaining branches stay under review.

1. **Pause and hold.** On a safety hold, stop programme questions and put future calls for that caller on hold. The keyword detector is a precaution, not a diagnosis or proof of immediate danger. Do not automatically resume when the operator becomes Available.
2. **Calm spoken response.** Owner-approved core wording: “Let’s pause here. What you’ve said matters. This automated call can’t provide emergency support. If you’re in immediate danger, please contact emergency services now.” Do not promise a live transfer, a callback time or that someone is already responding. The qualified reviewer must settle any direct clarification, jurisdiction-specific wording, local resources and the safe call-ending/handoff behaviour before publication.
3. **Alert the sole operator.** Send Eirik a private, content-free urgent alert; keep identity, transcript and incident notes in the private review system. Owner-approved target: acknowledge within **five minutes** during coverage and review immediately. Emergency action must not wait for this target if an immediate danger is already known.
4. **Failed alert or missed acknowledgement.** Owner-approved rule: set global Unblock Away, block new calls, retain the individual's hold, and raise a persistent incident for Eirik. There is no independent backup. An active caller must receive the reviewer-approved emergency direction; the service must never suggest that an unattended queue is emergency support. Availability alone cannot resolve an existing incident. Delivery acceptance is not delivery or human acknowledgement.
5. **Human decision and controlled return.** Eirik reviews privately and follows the qualified, jurisdiction-appropriate escalation procedure. Contacting emergency services and any disclosure of caller data need a reviewed basis and practical instructions. Record the minimum necessary outcome privately; no automatic texts to the participant, release, billing change or restart. Release a safety hold only after the required review, while preserving STOP and carrier opt-out. Resolve the operational incident separately before a deliberate return to Available.

The operating policy is owner-approved. Clinical exception handling and the legal basis/conditions for disclosure still require the agreed qualified review. The existing pack remains private-test-only until this is settled. Do not copy the weekly “same evening” response target into Unblock.

Primary background checked on 19 November 2026: [Helsenorge guidance for helping someone at risk](https://www.helsenorge.no/en/psykisk-helse/suicidal-thoughts-and-suicide/how-to-help-others/) supports taking disclosures seriously, listening, and promptly contacting emergency services for acute risk. It does not validate an automated voice service or this proposed acknowledgement target. Do not infer a caller's current country from their telephone number, language or timezone; the reviewer must define supported jurisdictions and the fallback for an unknown location.

## Existing application behaviour to verify

1. Each caller utterance is checked through the shared safety mechanism. Ambiguous words are clarified using the script's existing question rather than treated as a diagnosis.
2. A held response stops programme questions. The call follows the separately approved urgent-response wording; that wording remains an unresolved requirement here.
3. Future calls are held. Shared STOP and carrier opt-out remain authoritative. No automatic resume or billing change is inferred from a safety hold.
4. The operator alert contains no wish, step or transcript content. Only assigned operators open the private record/provider transcript needed for review.
5. The appointed operator follows the approved response procedure and records the decision privately. A hold is released only after the required human review; a STOP request is not overridden by that release.
6. The owner confirms how an incident, failed alert or absent backup is escalated. The reviewer supplies the exact urgent spoken wording, escalation action and jurisdiction handling before release.

## Provisioning check before launch

The local Unblock alert code now requires its own explicit operator contact, and shared digests exclude Unblock cases. Before deployment, verify the scoped contact and private review access without a send. Live alert and acknowledgement tests were explicitly waived by the owner; do not record them as passed. Do not inherit a shared backup or change weekly 8&80/Beliefs recipients or access implicitly. The ownership decision is not evidence of configured contact details, delivery, permissions or an approved response procedure.

## Review record required

Record the procedure version, reviewer and owner names, approval date, sole-operator acceptance, availability rule, staffed window and acknowledgement target. Automated tests cover held conversations, suppression, incident outcomes and controlled release. Live calls/alert delivery tests were owner-waived and remain unverified. Keep real participant details and incident notes out of Git.

The weekly [safety runbook](../SAFETY-RUNBOOK.md) is background evidence. Its existence does not approve a new Unblock spoken procedure.

## Incident controls · implemented

Migration `0038_unblock_incidents` stores one incident and one alert intent per urgent call, with a deadline five minutes after the concern is first captured. Repeated tool calls and completion cannot restart that clock or enqueue duplicate urgent alerts. The HTTP response is sent before attempting SMS delivery, so provider latency does not delay the held response. The durable worker retries pending intents and polls urgent receipts separately from the general ten-minute cadence. Neither provider acceptance nor delivery counts as human acknowledgement.

```sh
npm run unblock:incidents -- --list
npm run unblock:incidents -- --ack INCIDENT_ID
npm run unblock:incidents -- --resolve INCIDENT_ID --outcome handoff-confirmed --reviewed
npm run unblock:availability -- --available
```

These are private server commands, available at the repository root. List output contains operational timestamps and a private provider conversation reference; keep it on the server. Acknowledge means a human has seen the incident. Resolve attests that the required private human review is complete. Neither action releases a caller's safety hold or STOP, changes billing, sends a participant text or resumes availability. A blocking incident must be resolved before a separate manual check-in succeeds.

At the exact deadline without acknowledgement, or on missing/failed/uncertain alert delivery, the placement/check-in gate returns Away even before a delayed worker runs. The worker persists Away and the incident failure; a late acknowledgement cannot erase it. Actual provider failure after acceptance is also monitored. Away waits for a placement already in progress, without cutting off an active conversation. Operator CLI acknowledgement uses the clock after lock waits.

Account erasure nulls the private call/message links while preserving an unresolved operational block. Only IDs, timestamps and fixed failure categories are retained; no phone, wish, step, transcript or free-text incident note is copied into this table. Resolved operational metadata is pruned after 30 days; unresolved incidents require human review. Final privacy/clinical review remains a launch gate.

Tier-two findings retain the caller hold and scoped daily review reminder; they are not silently converted into a clinical diagnosis or a tier-one incident. Trigger coverage and any escalation of ambiguous/non-imminent disclosures still need qualified review.

The core, routing and consolidated operating policy are owner-approved. See [the current procedure](escalation-handoff.md) for exact escalation/disclosure/handoff commands, the explicit no-handoff-needed review outcome and the live-test waiver. Next: commercial readiness; qualified review and activation remain separate.
