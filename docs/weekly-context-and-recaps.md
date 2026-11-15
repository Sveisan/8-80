# Conversation continuity and action evidence

Owner-authorized review of the 9 November call found repeated completed perspectives
and an action question after a request for more conversation, followed by a recap
that incorrectly implied no action had been chosen. Read-only replay of the original
retained transcript is performed privately on the server; customer text is never a
repository fixture.

The latest preserved owner tests for the supplied phone (13 and 15 November) add
four requirements: accept spontaneous answers and short complete choices; answer
finish questions directly; keep appointment changes separate from action agreement;
and distinguish thinking time from unnecessary acknowledgement gates. The feedback
about pace describes both jumping ahead and waiting without a pending question.
The fictional regression cases retain these behaviours without caller identities.

## Action and recap behaviour

Every route requires explicit caller agreement after a complete read-back. More
conversation and an unnecessarily repeated read-back of the same action cannot
erase an earlier agreement. Different proposals, changed days, rejection and
withdrawal cannot reuse that agreement. Only an explicit caller choice permits the
no-action state; an agent's no-action sentence does not establish it.

Outcomes distinguish confirmed, declined and unconfirmed. A complete unconfirmed
read-back can contribute a clearly labelled proposal to the recap. It never becomes
the confirmed quotation, a follow-up promise or stored commitment. Rejected and
withdrawn proposals are omitted. Without a usable proposal, the email says only
that no new action was confirmed. Historical memory and the call's new evidence
remain separate; existing storage still writes only a confirmed commitment or an
explicit no-action choice. No migration is required.

The common prompt retains completed stages through more conversation and resumed
closes. Repetition after an already-answered correction is prohibited. Question
boundaries determine quiet-tool use; statements do not create acknowledgement
requirements. This changes conversational timing instructions, not TTS voice/rate.

## Validation

`weekly-action-continuity.test.ts` covers the November 9 pattern, reopened closes,
same-action repetition, corrected proposals, changed days, withdrawal, ordinary-call
agreement and three distinct recap states. `weekly-continuity-probes.json` contains
fictional four-role provider tests, including the latest owner feedback. Native
reply/tool tests verify source prompts, not acoustic timing or the full live graph.
The real historical transcript is replayed privately without changing account state
or resending its recap. Publishing source and a new owner phone call remain separate
from model-probe success; do not infer voice approval from text tests.
