# Unblock operator procedure · review draft

**Not approved for real participants.** This operational draft makes the owner decisions explicit. It does not provide clinical triage or an approved urgent spoken response. A qualified reviewer must complete and approve that part before `UNBLOCK_SAFETY_APPROVED` can be set.

## Approved ownership and hours

- Sole operator: Eirik, confirmed by the owner on 19 November 2026 for the initial launch. The owner clarified “Same” as “Sole operator”.
- Backup: none appointed, by the owner's explicit choice. This supersedes the earlier draft request for a named backup; do not keep requesting a backup name. Daily availability is approved and implemented locally; the urgent no-operator contingency remains under review.
- Owner-approved staffed period (19 November 2026): Monday–Friday, 09:00–17:00, Europe/Oslo. Calls start 09:00–16:30; optional light calls are suggested for Mon/Wed/Fri at 16:00.
- Approved release settings, to apply after staffing/procedure and release checks: `UNBLOCK_COVERAGE_DAYS=1,2,3,4,5`, `UNBLOCK_COVERAGE_START=09:00`, `UNBLOCK_COVERAGE_END=17:00`.
- Owner/reviewer must confirm alert acknowledgement times and what happens when Eirik cannot respond. Calls should not be offered outside the agreed staffed coverage.

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

`UNBLOCK_OPERATOR_PHONE` must be configured privately to Eirik's agreed alert contact. It has no fallback to shared weekly/Beliefs operators. Unblock's urgent alert and weekday 09:00–17:00 daily review reminder are scoped to that contact; Unblock cases are excluded from the shared digest. No real alert delivery or acknowledgement has yet been verified. The current implementation does not supply a separate incident acknowledgement/escalation system.

## Next owner decision: urgent-response operational procedure · draft

**Proposed for owner review; not approved or implemented as a complete incident workflow.** A five-minute acknowledgement target below is a proposed operating target, not a clinical recommendation or a promise to the caller.

1. **Pause and hold.** On a safety hold, stop programme questions and put future calls for that caller on hold. The keyword detector is a precaution, not a diagnosis or proof of immediate danger. Do not automatically resume when the operator becomes Available.
2. **Calm spoken response.** Candidate wording for qualified review: “Let’s pause here. What you’ve said matters. This automated call can’t provide emergency support. If you’re in immediate danger, please contact emergency services now.” Do not promise a live transfer, a callback time or that someone is already responding. The qualified reviewer must settle any direct clarification, jurisdiction-specific wording, local resources and the safe call-ending/handoff behaviour before publication.
3. **Alert the sole operator.** Send Eirik a private, content-free urgent alert; keep identity, transcript and incident notes in the private review system. Proposed target: acknowledge within **five minutes** during coverage and review immediately. Emergency action must not wait for this target if an immediate danger is already known.
4. **Failed alert or missed acknowledgement.** Proposed rule: set global Unblock Away, block new calls, retain the individual's hold, and raise a persistent incident for Eirik. There is no independent backup. An active caller must receive the reviewer-approved emergency direction; the service must never suggest that an unattended queue is emergency support. Availability alone cannot resolve an existing incident. Delivery acceptance is not delivery or human acknowledgement.
5. **Human decision and controlled return.** Eirik reviews privately and follows the qualified, jurisdiction-appropriate escalation procedure. Contacting emergency services and any disclosure of caller data need a reviewed basis and practical instructions. Record the minimum necessary outcome privately; no automatic texts to the participant, release, billing change or restart. Release a safety hold only after the required review, while preserving STOP and carrier opt-out. Resolve the operational incident separately before a deliberate return to Available.

The exact spoken response, handling of ambiguous or non-imminent disclosures (including abuse), current-location uncertainty, emergency escalation/disclosure, failure of the sole operator, incident retention, call ending, and repeat incidents require appropriately qualified review. The existing pack remains private-test-only until this is settled. Do not copy the weekly “same evening” response target into Unblock.

Primary background checked on 19 November 2026: [Helsenorge guidance for helping someone at risk](https://www.helsenorge.no/en/psykisk-helse/suicidal-thoughts-and-suicide/how-to-help-others/) supports taking disclosures seriously, listening, and promptly contacting emergency services for acute risk. It does not validate an automated voice service or this proposed acknowledgement target. Do not infer a caller's current country from their telephone number, language or timezone; the reviewer must define supported jurisdictions and the fallback for an unknown location.

## Existing application behaviour to verify

1. Each caller utterance is checked through the shared safety mechanism. Ambiguous words are clarified using the script's existing question rather than treated as a diagnosis.
2. A held response stops programme questions. The call follows the separately approved urgent-response wording; that wording remains an unresolved requirement here.
3. Future calls are held. Shared STOP and carrier opt-out remain authoritative. No automatic resume or billing change is inferred from a safety hold.
4. The operator alert contains no wish, step or transcript content. Only assigned operators open the private record/provider transcript needed for review.
5. The appointed operator follows the approved response procedure and records the decision privately. A hold is released only after the required human review; a STOP request is not overridden by that release.
6. The owner confirms how an incident, failed alert or absent backup is escalated. The reviewer supplies the exact urgent spoken wording, escalation action and jurisdiction handling before release.

## Provisioning check before launch

The local Unblock alert code now requires its own explicit operator contact, and shared digests exclude Unblock cases. Before deployment, configure and verify this contact privately, confirm existing private review access, and test actual alert delivery and acknowledgement. Do not inherit a shared backup or change weekly 8&80/Beliefs recipients or access implicitly. The ownership decision is not evidence of configured contact details, delivery, permissions or an approved response procedure.

## Review record required

Record the procedure version, reviewer and owner names, approval date, sole-operator acceptance, availability rule, staffed window and acknowledgement target. Test alert delivery, a held conversation, suppression of the next call, and controlled release. Keep real participant details and incident notes out of Git.

The weekly [safety runbook](../SAFETY-RUNBOOK.md) is background evidence. Its existence does not approve a new Unblock spoken procedure.
