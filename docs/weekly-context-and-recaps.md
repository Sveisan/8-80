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
read-back supported by the caller's own words can contribute a clearly labelled
proposal to the recap. Agent-only invented proposals are omitted. A complete single
read-back takes precedence over a longer span ending at the same point, so earlier
choices cannot leak into the latest proposal. It never becomes
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

## Appointment information and conversation pace

The appointment/pacing follow-up removes an ambiguous instruction that could say
no call was booked even when `next_appointment` contained the dated booking.
`appointmentPrompt` now separates that date from `booked_slot`, including for
returning callers. Unavailable service tools do not invalidate either value.
Missing appointment data gets a neutral call-page fallback, never a claim that
there is no booking. This release does not write or recalculate either schedule.

The three-month question and booking-control explanation use shorter spoken
wording. The old booking explanation remains a read-only settlement anchor for
calls already in progress. Map/action read-backs, fresh caller agreement and the
single flow-owned farewell retain their existing contracts.

Completed short answers and flow-owned acknowledgement statements no longer
create an extra waiting gate. An explicit request to carry on after delay
feedback gets a response; unfinished answers and requests for thinking time
still use `skip_turn`. All four weekly source specs also request
`turn_handling.response_delay_seconds = 0`. The settings sync backs it up,
merges only that field, reads it back and supports rollback. Interruption
sensitivity, inactivity timeout, model, voice and speaking speed are untouched.
See the provider's [agent settings contract](https://docs.speechify.ai/voice-agents/api-reference/v1/agents/-id-/patch).

`appointment-pacing.test.ts` covers known and missing dated appointments, distinct
weekly slots, source variables and historical booking text. The fictional
`appointmentPacingProbePlan` renders the actual phase prompts for 28 reply/tool
checks across both voices. Those tests cover direct booking answers, continuation
after map/action markers, completed short answers, delay feedback and protected
thinking time. They do not measure acoustic silence or exercise phase exits.

After merge, deploy source and sync both settings and the versioned graphs to the
four private pilot agents, retaining the existing pilot hold. Use the private
pilot settings setup (`syncAgents` with `dialoguePilot: true` and verified private
role IDs); ordinary `speechify:sync --apply` remains blocked during that hold.
Then stage, activate and read back the four graphs with `weekly:flow --owner-pilot`.
An exact PR59/60 graph can be upgraded, while an edited prompt or unrelated draft
is still refused. No migration is needed. A later explicitly authorized phone
test must confirm conversational pace and the audible farewell before voice
approval; text-test success alone cannot approve the experience.
