# Weekly answer and farewell pilot

The owner phone test on 13 November exposed two audible failures: the agent moved
from the complete map question to the kept-map marker before the caller could
answer, and its final farewell was not heard. The retained transcript agreed
with the provider transcript; agreement between those copies did not make the
experience correct. Strict settlement correctly left onboarding unfinished.

The new **private pilot flow** separates the first introduction, map answer,
kept-map statement and subsequent conversation. The map answer phase explicitly
waits for a new caller turn after the read-back, including after corrections.
An earlier yes, courtesy, silence or a fragment cannot count as that answer.
Declining the map leaves the introduction unfinished; asking to stop goes to
the ordinary ending without requiring a map or action.

Every model phase excludes `end_call` from its tool filter. A single `say` node
owns the brief “Take care.” farewell, with interruptions disabled for that
short line; its only outgoing edge goes to an empty `end` node. The model is
instructed to leave the phase without another spoken goodbye. This moves the
farewell/end sequence into the provider flow rather than scheduling speech
after a hangup tool.

**Limits:** Speechify still evaluates the phase exit conditions with a model.
The graph is not a deterministic server-side proof of caller agreement, and a
validated graph is not proof that audio reached the phone. Existing strict
map/action parsing remains the storage boundary. Phone approval stays false
until both the waiting behaviour and the audible farewell pass an owner test.
No global readiness flag is changed by these commands.

## Deployment after merge

Run from the deployed repository with its existing private configuration.
Use the four distinct `SPEECHIFY_DIALOGUE_*` pilot IDs; ordinary weekly and
module agent IDs are refused. These commands never place calls or send messages:

```sh
npm run weekly:flow -- stage --owner-pilot
npm run weekly:flow -- activate --owner-pilot
npm run weekly:flow -- check
```

`stage` validates drafts without publishing. `activate` publishes and reads back
the exact source graph for all four private roles. All targets are preflighted
before the first write. Private backups and a publish journal live under
`.speechify-sync/weekly-flow/`, which is ignored by Git. Writes refuse an active
call or an unrelated existing draft/active flow. An uncertain publish is
journaled and is not blindly repeated. A successful later read-back can
reconcile it. Reports contain role names and booleans, not IDs, prompts, caller
data or credentials.

To stop this pilot flow while leaving ordinary agents and account data alone:

```sh
npm run weekly:flow -- deactivate --owner-pilot
```

Deactivation only accepts this exact source graph. An unrelated graph requires
operator review rather than automatic replacement. Do not manually remove a
pending journal to bypass an unconfirmed operation.

## Phone acceptance

1. Begin one isolated owner first call with an empty initial context.
2. After the full map question, deliberately wait several seconds. There must
   be no kept-map statement, next question or assumed agreement. Then answer.
3. Correct one part and pause again. Only fresh explicit agreement after the
   corrected read-back can complete onboarding.
4. Stop normally. Confirm that the entire farewell was audible, exactly once.
   Check provider timestamps separately; they cannot replace that observation.
5. Check strict settlement, one counter increment and exact extracted/stored
   fields before allowing a returning call. An incomplete or declined map must
   not be manually promoted just to continue the test.
6. In the return, establish that stored memory is actually used, then repeat
   the action-confirmation pause and the audible-farewell check.

The isolated voice pilot does not itself verify automatic webhook persistence
or email delivery. Preserve those separate regression checks and do not replay
customer callbacks or send duplicate recaps to obtain a green voice result.

Provider contract: [conversation phases and versioned flows](https://docs.speechify.ai/agents/guides/concepts/conversation-phases).
Tool filters use attached **IDs**, resolved privately from the catalog, rather
than tool names; the first draft probe was rejected until those were bound.
The authenticated `GET /v1/agents/flow/schema` is the source for the `say` node's
`allow_interruptions` field and the sequential `say` → `end` graph shape.
