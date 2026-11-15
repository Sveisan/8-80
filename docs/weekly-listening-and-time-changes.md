# Weekly listening and call-time changes

The owner first-call review found that an appointment-change request was
answered with the action-agreement marker. The request never changed the
booking, and strict extraction correctly refused to remember an action. The
conversation also repeated a completed action answer and continued the
exercise after a question about finishing. No caller transcript is retained
in this document or the regression fixtures.

## Resulting behaviour

- Already answered opening questions and chosen activities are not asked again.
  When both perspectives converge, offer the shared focus rather than making
  the caller choose between near-identical answers. A concrete present-day
  follow-up is optional; depth and nostalgia remain invitations.
- A question about finishing is answered directly, with room to choose.
  Completing the map does not require choosing an action. Criticism about
  rushing gets a short, specific acknowledgement and space to speak.
- A weekly time-change request takes priority in every phase. Clarify only an
  ambiguous referent. Explain that the caller must save the change on their
  call page. Do not collect an appointment that cannot be applied, claim it was
  saved, or substitute an SMS reminder or callback. The existing post-call path
  sends its slot-control link, subject to the existing delivery controls.
- The private flow now puts the action read-back, fresh caller answer and
  agreed-action marker behind separate boundaries, as with the map. After a
  service diversion, a complete new read-back and fresh explicit agreement are
  needed. A yes to a service clarification cannot approve an earlier action.
- Storage refuses explicit questions, time changes and qualified answers as
  read-back approval. This diversion veto also applies to ordinary calls; the
  existing pilot-only strict-agreement policy otherwise stays scoped.
- The single flow-owned, non-interruptible farewell remains before the end node.

## Validation and limits

Fictional transcript regressions cover mixed yes/change answers, Norwegian
requests, service clarifications, fresh confirmation, finish questions and
previous slot-control wording. Database journey tests cover first and returning
calls with and without reconfirmation: encrypted memory, the next outbound
variables, unchanged booking, one counter increment, and one recap and one
slot-control link despite duplicate completion callbacks. Provider network
effects are mocked in these tests; they do not prove real email delivery.

The flow's transition conditions are still evaluated by a provider model.
Graph and storage tests cannot prove that the model responds well to live
speech, waits audibly or plays the farewell. A new owner phone test is required.
Do not reuse the prior call's voice approval for this release or manually
fill an unconfirmed action to unlock the return.

## Deployment after merge

Update to the merged release and sync the ordinary weekly prompts for both
voice choices using the existing safe update process. All four private pilot
flows must then be staged, activated and checked:

```sh
npm run weekly:flow -- stage --owner-pilot
npm run weekly:flow -- activate --owner-pilot
npm run weekly:flow -- check
```

The synchroniser recognises the exact PR46 predecessor graphs by source hashes
after replacing verified tool bindings with their portable names. A policy label
alone never permits replacement. An unrelated or edited graph/draft, active
call or unresolved publication journal stops the operation before mutation.
Backups, all-four preflight, idempotent publication and private reports remain
in place. These commands do not place calls or enable a global pilot rollout.

Existing PR46 helper scripts pin a source revision and previous evidence.
Prepare a fresh owner test state and source-bound checks for this release;
do not reset or overwrite the already reviewed first call to make them pass.

## Owner phone acceptance

1. Use a fresh isolated first call. Give a broad positive answer, then a short
   complete chosen activity. The agent should respond to both without an
   unnecessary interview or a repeated activity question.
2. Ask whether the call is finished. The agent must answer and wait for your
   choice rather than starting another exercise or hanging up automatically.
3. During an action confirmation, request a weekly time change. Check that the
   agent explains the real page control and does not claim a booking change.
   If you continue, it must give the complete action read-back again and wait.
4. Verify the confirmed map and action in storage, one counter increment,
   unchanged booking and no duplicate sendouts before allowing the return.
   A no-action close is valid, but does not verify action-memory continuity.
5. In the return, verify actual use of the saved detail, response to pace
   feedback, waiting after confirmation, and one fully audible farewell.

Assess thematic pacing from what is said separately from acoustic speaking
speed. No audio recording is enabled by this change.
