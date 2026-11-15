# Unblock operator procedure · review draft

**Not approved for real participants.** This operational draft makes the owner decisions explicit. It does not provide clinical triage or an approved urgent spoken response. A qualified reviewer must complete and approve that part before `UNBLOCK_SAFETY_APPROVED` can be set.

## Proposed responsibility and hours

- Primary: Eirik, subject to his confirmation.
- Backup: owner must name a person, confirm availability and provide the alert destination privately.
- Proposed staffed period: Monday–Friday, 09:00–17:00, Europe/Oslo.
- Proposed runtime settings after approval: `UNBLOCK_COVERAGE_DAYS=1,2,3,4,5`, `UNBLOCK_COVERAGE_START=09:00`, `UNBLOCK_COVERAGE_END=17:00`.
- Owner/reviewer must confirm alert acknowledgement times and what happens when neither operator can respond. Calls should not be offered outside the agreed staffed coverage.

## Existing application behaviour to verify

1. Each caller utterance is checked through the shared safety mechanism. Ambiguous words are clarified using the script's existing question rather than treated as a diagnosis.
2. A held response stops programme questions. The call follows the separately approved urgent-response wording; that wording remains an unresolved requirement here.
3. Future calls are held. Shared STOP and carrier opt-out remain authoritative. No automatic resume or billing change is inferred from a safety hold.
4. The operator alert contains no wish, step or transcript content. Only assigned operators open the private record/provider transcript needed for review.
5. The appointed operator follows the approved response procedure and records the decision privately. A hold is released only after the required human review; a STOP request is not overridden by that release.
6. The owner confirms how an incident, failed alert or absent backup is escalated. The reviewer supplies the exact urgent spoken wording, escalation action and jurisdiction handling before release.

## Review record required

Record the procedure version, reviewer and owner names, approval date, primary/backup acceptance, staffed window and acknowledgement target. Test alert delivery, a held conversation, suppression of the next call, and controlled release. Keep real participant details and incident notes out of Git.

The weekly [safety runbook](../SAFETY-RUNBOOK.md) is background evidence. Its existence does not approve a new Unblock spoken procedure.
