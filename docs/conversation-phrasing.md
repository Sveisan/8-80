# First and returning conversation wording

The first-call disclosure remains explicit about AI identity, written notes and
the right to stop. It is a statement. After agreement to the opening availability
question, speak the disclosure and continue directly into the frame and location
question in the same turn. There is no “All right?” or acknowledgement pause after
the disclosure. An objection or request to stop takes priority. The same rule
applies to the brief reminder during an unfinished introduction.

Keep the younger-self visit, older-self perspective and patient listening. The
map now describes what the imagined younger self would love about present life,
rather than saying “At eight” as if it were childhood history. Returning calls
have their own short platform greeting in both voices. On the second call the
visit question replaces the personalised younger-self question; it is not an
additional question. Already-answered questions are skipped.

An unfinished action does not invite a counterfactual challenge to the caller's
explanation. Repeated unfinished actions invite keeping, changing or leaving the
action. Completion and partial completion have short factual result markers;
their follow-up questions are separate and optional. The caller may choose no
action, and courtesy or silence cannot save a proposed action.

Map confirmation and explicit action agreement remain intact. Settlement accepts
the current templates and the previous known map, correction, onboarding, action,
result and callback wording. This is compatibility for calls already in progress,
not permission to infer facts from free speech. In particular, a map's “right?”
cannot become the start of an old “Right —” action extending into a later promise.

Verification covers current and historical read-backs, corrected and split maps,
refusals and ambiguous agreement, and signed webhook → encrypted memory → next
outbound request for two separate callers. Database regressions verify done,
partly and undone counters, duplicate webhook handling and preserved goals.

These changes build on the isolated dialogue pilot. Readiness flags, bookings,
caller access and patience settings are unchanged. The existing owner phone test
remains necessary to establish audible delivery before promoting the pilot.

## Giving the caller room after criticism

An agent acknowledged that the conversation felt like an interview, then
immediately said “Tell me what's been on your mind”. The prompt now makes the
acknowledgement a complete turn. A question, imperative, topic change or an
invitation to talk is not appended. The older instruction to simplify a question
applies when the caller asks for clarification, not when they criticise the
questioning. The caller can resume naturally; a direct request or explicit
goodbye still takes priority.

Provider reply probes retain the original criticism test and add requests for
thinking space, a caller resuming after the pause, and criticism accompanied by
an explicit goodbye. These text probes cannot establish actual silence duration.

## Clearer language, situation and a personal close

Use familiar English: the younger self now smiles rather than grins. The older
perspective explicitly looks across the caller's life, while the three-month
question asks what they want for themselves now. A requested clarification makes
clear that neither imagined self has to be pleased. The optional longer-goal
follow-up stays open while asking what that would look like for the caller.

Every returning call establishes today's situation before the callback, unless
the caller already gave it. An update offered in the opening is still accepted
without repeating it. If the situation is still unknown, acknowledge that update
before the situation question in the same turn. Driving leads to a callback when parked; past driving does
not block a caller who is parked now. No address is requested.

The second-call visit can use he or she when the caller explicitly used that
pronoun about themselves; choose that corresponding version when known.
Otherwise use a question without a pronoun. A name and
the chosen mentor voice are never evidence of the caller's gender. No profile
field or gender question is added.

The goodbye can use the known first name or an ordinary detail actually shared
in the call. It remains brief, with a simpler ending for an early stop or a
difficult call. It cannot add a question or invent familiarity. Audible goodbye
still precedes the end-call tool.

The existing vCard download remains on the call page after the first call too.
The button explicitly says “Add 8&80 to contacts”; the first-call suggestion
points to it. The user confirms the save in their phone's contact app, without
typing a number. Confirmation, result and memory extraction templates are
unchanged.

The spontaneous-update probe now includes the caller saying they are at home,
so its ban on repeating an opening check still tests answered information. A
separate probe requires acknowledgement plus the new situation check when an
opening update contains no location. This distinguishes a first situation check
from repeating one, as the updated call flow requires.

Manual review also caught a provider judge accepting the agreement marker after
“Right, thank you”. The action-agreement gate now comes before feature and close
instructions; that exact courtesy response gets only a fresh complete fixed
action read-back and confirmation question. A later yes then confirms that
read-back, rather than being lost after an unanchored clarification. A regression
covers courtesy → fresh read-back → explicit yes. The probe explicitly fails the agreement marker and any premature
logistics or goodbye. Backend confirmation remains independently strict.
An opening update is acknowledged with one clear factual event, rather than a
generic claim that the caller has something to work with.

## Listening without a fabricated error or an extra question

The female first-call acknowledgement probe repeatedly returned a technical-error
sentence after “Thank you”, while the test API reported no underlying error.
Its cause could not be established from that result. The first fix used “Mm.”,
followed by waiting; the owner voice test exposed how repeated listening sounds
interrupt thinking. The current instruction is to wait without spoken words. Courtesy
cannot create a fault, retry request or close. Actual reported runtime/tool
errors still use their verified explanation, and closed-question and action
agreement rules are unchanged.

The previous concrete-follow-up fixture asked a question even though the caller
explicitly wanted to say more. That original caller sentence is retained in a
separate caller-continues probe, which requires giving them the floor. The
concrete-follow-up probe now has the caller explicitly asking for a question to
help explain. Both behaviours remain tested; patience is not traded for a forced
question. The acknowledgement probe now runs on returning agents as well.

The quiet-turn probes now require an empty spoken reply and reject “Mm.”,
narrated silence and fabricated faults. A factual acknowledgement before a missing situation check can also
be a short accurate paraphrase; it need not repeat every detail or include a
politeness marker. Negative examples still reject a naked situation question,
invented events, a fabricated fault and an extra question when the caller wants
to continue. Provider verdicts and actual replies remain available for review.

## Regressions from the owner's first voice test

Fictional cases reproduce unfinished words across pauses, repeated patience,
criticism of listening sounds, continuing quietly after that criticism, a new
money goal, an ignored-answer complaint, complete short replies, partial map
confirmation and the returned goodbye. All four private agents run the applicable
cases. Provider verdicts are supplemented by `dialogueReplyFailures`: silence and
the complete fixed map cannot pass on the strength of an LLM judge alone.

The first map checkpoint requires eight, eighty and three-month goals before
explicit agreement and the onboarding marker. A goals-only yes requires a full
map repair. Database journey tests prove that a premature marker leaves onboarding
unfinished while preserving an explicitly agreed action, and that the repaired
map reaches the next call. Existing result-registration tests remain in the full suite.

The prompt distinguishes a thinking fragment from a complete short answer;
the latter no longer licenses an interruption apology. New goals receive a short
factual response before a next question. Feedback about sounds gets a response
about sounds, followed by quiet. At the close, a returned courtesy leads to the
end-call tool alone. `captureReport.ending.speechOrderValid` rejects speech after
or across that tool even if an earlier farewell was in the correct order.
These are text and timestamp gates; actual silence and audible playout still
require another explicitly requested phone test. No global rollout is implied.

Speechify's capability catalogue identifies `skip_turn` as a worker tool that
stays quiet for one turn. Quiet instructions now explicitly use that built-in;
private readiness requires it to be enabled. Native text probes with an empty
completion produced the provider's standard error fallback. Tool and simulation
probes also failed to demonstrate the built-in, so no such result can count as a
silence pass. Retain these failures rather than weakening the expected behaviour.
The post-end-call speech case is covered by timestamp capture, since asking a
text endpoint for another reply after hangup cannot model a closed voice session.
Transcript quality reports now count repeated listening sounds and flag apology
repairs after complete acknowledgements as review signals, without claiming
that text alone proves an audible interruption.

## Native result contracts and release gates

The earlier 82/104 report mixed two contracts: every scenario was created as a
`reply` test, including 22 cases whose hard check required an observed tool call.
Speechify's [native test API](https://docs.speechify.ai/agents/api-reference/v1/agents/tests/post)
distinguishes `reply` from `tool`; their result variants expose different fields.
`nativeDialogueDefinition` now selects `tool` with `context` and `expected_tool`
for those 22 cases. All original cases remain. Two new cases from the latest
owner feedback add reopening a close and a second clarification, bringing the
four-role matrix to 112 (90 wording and 22 tool-selection checks).

Correcting the test type alone was insufficient. Isolated provider controls
showed that native tests resolve shared client tool definitions, while the
voice agent's worker-built-in bindings are not callable definitions in that
test catalogue. The diagnostic harness supplies endpoint-free client definitions
named `skip_turn` and `end_call` through the test run's `tool_ids` override.
Both tool orders passed the positive controls; deliberately wrong expected tools
failed with the opposite tool observed. These definitions are test substitutes
for measuring selection intent. Never bind them to a real voice agent: production
still needs the actual enabled worker built-ins, and their audible behaviour is
checked separately. A zero-duration tool result is not evidence of a skipped model
turn, since passing client-tool controls also report zero duration.

Export the exact candidate from a clean committed checkout before creating tests:

```sh
node --import tsx services/voice/src/quality/dialogue-native-plan-cli.ts NEW_PRIVATE_PLAN.json
```

The plan pins the full source revision and includes all four rendered source
prompts and typed definitions. The runner binds private targets and the shared
test definitions separately, records their hashes, and normalizes each run with
`normalizeNativeDialogueRun`. It must not use the deployed older prompt as the
candidate or infer spoken silence from an absent reply field.

`normalizeNativeDialogueRun` validates the variant, verdict and observed tool
selection. A missing spoken response remains `not_exposed`. Mixed tool-plus-speech
results, empty wording, generic provider fallback, unknown roles and wrong result
variants cannot become passes. The review CLI prints fixed diagnostics for malformed
private input rather than echoing its contents or path.

Version 2 of the report separates wording and tool intent. Native function
selection alone never establishes that the voice worker stayed silent, played
the farewell or disconnected at the right moment. `approvedForPhonePilot` requires
the complete matrix and all wording/selection checks; `approved` remains false
because the report contains no voice observations. For an explicitly agreed
owner test, the CLI can check only that narrower gate:

```sh
node --import tsx services/voice/src/quality/dialogue-reply-cli.ts PRIVATE_RESULTS.json --for-phone-pilot
```

Without that flag, an unverified voice release remains blocked. No readiness
flag, agent routing, real booking or memory is changed by reviewing a file.
The live test still checks thinking pauses, reopening the close, a complete
confirmed map, an explicitly agreed action and the returning call's use of it.
An end-call tool record is not evidence that the goodbye was audible.

The latest closing regression gives the floor back when a caller says they have
one more thing before the call ends. Earlier closing agreement cannot override
that request. A second clarification is anchored in the caller's stated goal;
the repair ladder must not turn into a third broad question or a supplied action.
