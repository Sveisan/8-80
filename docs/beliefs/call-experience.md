# Beliefs call experience — conversation revision

## Aim

The caller understands the purpose before personal reflection, sees their answers change the conversation, and chooses decisions grounded in their own experiences. A practical obstacle, unclear question or unfinished thought must not become a fabricated belief, evidence item or completed stage.

This revision addresses opening clarity, shared focus, reality versus interpretation, provisional decisions, concrete evidence, conversational repair and a useful close. It does not enable payments or calls, change retirement/frequency rules, attach capture tools, or claim clinical approval. Source scripts remain drafts for review and provider tests.

## Conversation sequence

| Stage | Caller experience | Proceed when |
| --- | --- | --- |
| Arrival | Recognisable greeting; ready to talk; any audio question resolved | The conversation can begin |
| Orientation | Understands what the first call aims to achieve and how daily/weekly practice fits | Purpose questions have been answered |
| Shared focus | Explains why they joined and chooses a concrete desired change | The caller confirms the relevant focus |
| Reality and thought | Practical circumstances acknowledged; any additional assumption explored | A caller-recognised thought fits the exercise |
| Backlog and selection | Maps genuine thoughts and chooses their order | Enough relevant material exists without padding |
| Decision | Explores a draft in their own words | The caller wants to practise that decision |
| Evidence and balance | Recalls an actual experience, its connection, and remaining uncertainty | Required content is genuine and caller-authored |
| Opportunity and close | Connects the decision to a situation, understands practice and any unfinished work | Complete content is confirmed; incomplete stages stay incomplete |

The substantive opening is “What made you want to try Beliefs?” after an availability greeting and short outcome-led explanation. This is a candidate to test, not a proven best question. Reflections need room for a caller response; do not mechanically add a question after every answer.

## Repair behaviour

| Signal | Response |
| --- | --- |
| Requests repetition | Repeat once simply; if still unclear, explain and change the question |
| Says the question is too broad, strange or irrelevant | Acknowledge the mismatch and choose a more concrete question |
| Challenges the premise | Reconsider whether the exercise fits; explicitly recognise a mistaken target |
| Names a practical limit | Respect it; explore an additional assumption only if one exists |
| Already expresses confidence | Check whether there is a contrary thought rather than inventing one |
| Gives a tentative decision | Clarify its meaning and confirm whether it is something they want to practise |
| Gives general evidence | Invite one specific occasion; let the caller explain its relevance |
| Says “I don't know” | Give thinking time, offer one follow-up if wanted, and respect a pass |
| Speech is unclear | Confirm wording before using it; do not infer distress or intent from a fragment |

Confirmation uses actual caller wording through their latest explicit agreement. To avoid a long recital, the agent can submit a consecutive span of caller turns, including every intervening caller utterance. The existing signed-transcript validator still checks that exact span. Agent summaries are not caller evidence. If the span cannot be verified or exceeds the tool limit, no save is claimed.

Daily calls stay familiar and brief, identify the current saved topic, and retain decision/evidence/balance. Weekly calls invite improvement, no change or a poor fit; they do not presume progress. Preparing a revised or queued decision uses caller-authored content and does not receive a review score in the same call.

## Rehearsal cases

All cases below are invented. They are a review protocol, not completed voice-test results. Use a private provider rehearsal or local simulation; these cases do not authorise calls to customers or enable launch flags.

| Case | What to introduce | What the reviewer should observe |
| --- | --- | --- |
| Purpose unclear | Ask what the conversation is for before naming a goal | Concrete explanation before further reflection |
| Question too broad | Ask for a simpler question twice | A changed question, not a third identical attempt |
| Practical obstacle only | A room is unavailable; the caller already trusts their organising ability | No belief that the room is available; no invented self-doubt |
| Genuine limiting prediction | Caller expects to freeze at a group discussion | Situation and caller-recognised prediction before preparation |
| Tentative decision | Caller says they could prepare more | Exploration and choice before treating this as a practised decision |
| General evidence | Caller says they are capable | One specific experience and a caller-explained connection |
| No opportunity yet | Caller cannot identify an upcoming situation | No invented action or falsely completed stage |
| Unclear speech and silence | A fragment, request to repeat, and a thinking pause | Wording checked; pause respected; no inferred diagnosis |
| Weekly no change | Caller reports no improvement | Neutral exploration and their own score, with no suggested progress |
| Backlog no longer fits | Caller says the selected queued thought is outdated | No forced activation, discovery or unallowed reordering |

Assess after a rehearsal: did the caller understand the purpose without repairing the opening, feel accurately understood, see an objection change the direction, choose a credible decision, recall a concrete supporting experience, and understand what happens next? Ask whether they would choose another call and why. Do not turn politeness or a short “yes” into evidence of benefit.

Review actual phone pacing separately. Record only observations available from the provider or participant; do not infer silence length or overlap from untimed text. A shorter call is not a quality measure by itself. The two/three-belief daily duration target remains unvalidated.

## Implementation and verification boundary

The three scripts contain the revised conversational rules. `BELIEF_GREETINGS` in `prompt-pack.ts` supplies Speechify's fixed first message; Beliefs sync uploads, backs up and reads it back. The original weekly 8&80 greetings are preserved. Old restore points without a greeting preserve the current greeting rather than deleting it.

Automated checks cover settings upload/read-back, repeated sync, restore, old-backup compatibility and a brief caller confirmation across literal turns. They do not judge rapport or prove actual agent behaviour. After merge and server update, apply `npm run speechify:sync -- --group beliefs --apply`, then use `--check` to confirm stored settings. Full capture-tool integration and launch readiness remain separate requirements. Do not set approval flags or resume the scheduler as part of this prompt revision.

Sources and applicability boundaries are recorded in [research.md](research.md).
