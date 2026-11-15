# Weekly pacing handoffs

The owner test on 15 November had idle gaps after “I'll keep that for next
time” and “I've got that”. Both markers handed over immediately to a model
phase, but the next speech followed another caller contribution. A separate
action invitation also repeated an activity the caller had already supplied.
Provider timestamps include overlapping and long caller segments; they are
not measurements of acoustic silence.

The first-call conversation now has one neutral weekly-focus entry question.
After either action marker, the post-action phase asks once whether there is
anything else to discuss. Speechify's phase `first_message` is spoken once on
entry, so neither handoff requires a courtesy acknowledgement to start the
next question. The declined-map route uses the same neutral focus invitation
without claiming that the map was kept. Returning calls keep their existing
greeting-and-answer boundary.

The entry question is a real caller turn: silence, a thinking request, thanks
or okay cannot become agreement to end. A clear no to the extra-topic question
can accept the close; a topic continues without reopening the action choice.
Map/action answer phases have no entry speech. Their fresh explicit consent
rules, strict settlement and the single flow-owned farewell remain intact.
Speech recognition and turn-timing settings are unchanged.

Ordinary content questions accept answers volunteered before the invitation.
If an action invitation was accidentally asked after a complete activity,
use that existing choice in the full read-back instead of waiting for the
same answer again. Only fresh agreement after that read-back saves the action.

`weeklyPacingProbePlan` includes the 20 existing quiet-tool probes plus 32
fictional pacing probes across all four roles. Exact read-backs are checked
in addition to provider verdicts. These are text/tool checks, not proof of
phase exits, phone latency or audible playout. Replaying the retained owner
transcript separately checks settlement without rewriting caller state or
sending a recap.

Deploy using the existing `weekly:flow stage/activate --owner-pilot` commands.
The exact previous graph is pinned and unrelated edits still fail closed.
Existing phone-acceptance requirements remain in force for a wider rollout;
this release does not mark the new graph voice-approved.

Provider contract: [conversation phases](https://docs.speechify.ai/agents/guides/concepts/conversation-phases).
