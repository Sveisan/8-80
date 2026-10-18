# Weekly call quality and memory verification

The weekly 8&80 call should remember accurately, ask only useful questions and accept a choice of no action. This change improves that existing journey. Beliefs, new provider memory, two audible characters and hybrid voice infrastructure remain separate work.

## Memory and follow up

The verified local path is: signed completion webhook → known weekly attempt → atomic settlement → encrypted memory and existing message outbox → next scheduler tick → first or returning Speechify request → prompt context. A test uses two distinct synthetic callers, the real HTTP webhook handler, PostgreSQL, the Speechify adapter with intercepted HTTP and the repository's console prompt. It checks caller isolation, signature rejection and duplicate-event handling. Local substitution verifies the prompt contract; provider-side substitution and spoken use still need a real call.

The following cases now have regression coverage:

- A later “Right. Goodbye” cannot replace the action read back earlier. A newer action split around a backchannel supersedes an older complete read-back. Current and historical formats follow the same chronological ordering.
- Split first-call maps retain their actual ending, so a backchannel before the map finishes is not confirmation.
- Corrections to eight, eighty or the three-month goals replace the relevant part. A later complete map supersedes older corrections.
- Clear negative or ambiguous responses do not complete onboarding. The acknowledgement matcher recognises a conservative set of English and Norwegian confirmations; unfamiliar wording leaves the introduction unfinished and available to continue.
- The fixed `next.none` branch or a narrowly recognised explicit caller choice of no action clears an older action and day. A direct refusal invalidates the immediately preceding proposal even if the mentor omits that branch; it does not infer a replacement action. Missing extraction alone preserves previous memory. A new action without a day clears an obsolete day. Choosing no action breaks the running undone-week pattern without erasing the prior action’s established result. These are conservative text guards, not a general intent classifier.
- A returning opening with no previous action cannot record an undone week.
- An authenticated memory correction made after a call was claimed takes precedence over that call's delayed settlement. Its action, day, goals and onboarding-completion update are withheld, and the stale recap is suppressed. A later call can update the corrected memory normally.
- STOP, pause, safety holds, carrier opt-out, billing eligibility and schedule changes are checked under the caller lock immediately before each placement attempt. Retry backoff releases the lock. A suppressed claim sends no missed-call notice. A request already handed to the provider cannot be recalled by this check.
- A local transaction failure after provider acceptance does not place the call again. The scheduler retries recording the returned identity separately; a remaining storage failure is logged for recovery without a second call or misleading missed-call text. A lost commit acknowledgement cannot rewind a conversation already settled by its webhook.
- A flagged call suppresses both its ordinary call SMS and its recap through the existing outbox. Duplicate callbacks still produce one settlement and one recap intent.

Migration `0027_weekly_memory_corrections.sql` adds the nullable correction timestamp. It records no additional conversation content. Existing encrypted memory and the existing recap outbox remain the source of truth.

## Conversation changes

One warm mentor uses eight and eighty as perspectives on the caller's present life. The guidance no longer requires a question after nearly every reaction. Two follow-ups on a thread is a ceiling across answers, including rephrased questions. A brief choice on one dimension is one request; independent questions must wait for separate answers.

Obstacle questions are conditional on an unfinished previous action and are skipped when the reason is already explained. First-call elaboration, a connection between the perspectives, a cue and a closing question are optional. Short answers do not authorise an invented commitment. The repair ladder waits for an answer to the connection check before repeating a question. Clear serious disclosures retain priority over the ordinary opening and closing.

Fixed disclosure, read-back, outcome, reschedule, safety and tool contracts are retained. New correction lines support eight and eighty. The numeric and console branches now ask about a third undone week under the same condition. The legacy scorecard accepts the explicit no-action branch and treats a low exchange count as a listening prompt rather than proof of a poor call.

## Synthetic baseline

Run `npm run quality:weekly` locally. The default uses six synthetic cases, requires no database or provider credentials and prints no conversation excerpts or personal values.

| Scenario | Stacked question turns | Exact repeat candidates | Longest run of question turns |
|---|---:|---:|---:|
| Returning call with natural close | 0 | 0 | 1 |
| Stacked questions | 1 | 0 | 1 |
| Exact repeated question | 0 | 1 | 2 |
| Question chain requiring listening | 0 | 0 | 4 |
| No action by choice | 0 | 0 | 1 |
| Eight and eighty perspectives | 0 | 0 | 1 |

These fixtures verify distinctions in the measurement. They are not measured customer outcomes or before/after evidence of better conversation quality. The question chain deliberately has no automatic failure: each follow-up must be judged in context. A requested repetition may be appropriate. Punctuation misses questions phrased as imperatives and cannot establish whether two requests have independent meanings.

For an authorised retained weekly webhook, use `npm run quality:weekly -- --conversation CONVERSATION_ID`. The command reads only existing retained delivery data, rejects Beliefs or ambiguous identities, contacts no provider, creates no retention copy and sends nothing. `--file PATH` instead reads a private Speechify payload file. Reports contain counts and turn indices only. Invalid input produces fixed diagnostics without printing source text or credentials.

An optional `--context PATH` accepts private JSON such as `{"kind":"return","priorCommitment":"the action known before this call"}`. Without that snapshot, prior memory is unknown. Current database memory is deliberately not used to reconstruct a past call's context. The reference signal detects only a verbatim normalised mention; it does not prove correct understanding or use.

## Listening and pilot

The owner does not recall suitable historical calls, so start with fixed scenarios. Use the same caller story on the existing and proposed prompt. Compare one first call and one returning call; add focused calls as needed for refusal, a correction and a thinking pause. Keep all pilot bookings deliberate and limited to the owner's test number.

| Criterion | Evidence | Record |
|---|---|---|
| Stacking | Independent answer requests before the caller gets a turn | Count and turn numbers; review semantics |
| Repetitive follow-up | Seeking an answer already given, including a rephrased question | Count by thread and brief reason |
| Ownership and clarity | Caller words retained, no invented or upgraded action | Good, weak or irritating, with evidence |
| Memory | Corrected map and action actually used on the next call | Exact expected versus observed behaviour |
| Ending | Accepts refusal and closes without reopening the conversation | Appropriate or unnecessary question; tool sequence |
| Interruptions and pauses | Audio or speech start/end timestamps | Overlap, cut-offs, response delay; otherwise unmeasured |
| Warmth | Natural wording and delivery, without pressure | Owner judgement, calibrated against the same call |

Suggested scenarios:

1. A first call with rich answers: correct eight, confirm the map, then decline an action. Expect the corrected map and an ordinary close.
2. A returning call with an action completed: give the full answer immediately. Expect accurate memory and no repeated request for the same information.
3. An unfinished action whose obstacle is already explained: say the train was cancelled. Expect acceptance without a series of new “why” questions.
4. No previous action and no new action: expect no invented callback or undone week. With no next appointment, expect the unscheduled close.
5. Pause mid-sentence, then continue. Listen for floor preservation and timing; text-only reports cannot settle this.
6. Ask to end. Expect a brief goodbye and the existing `end_call` sequence. Test the serious-disclosure exception separately with a clearly labelled synthetic scenario.

Do not choose a winner from an aggregate AI score. Discuss the owner's listening first, then calibrate any additional reviewer against those judgements. Use turn references and short private notes instead of copying customer transcripts into workshop material.

## Release sequence

1. Review and merge the code change, then use the normal server update process to install locked dependencies, apply migrations and restart the control service. Keep existing `.env` values private.
2. Check the weekly configuration, including distinct first and returning agent IDs, `SPEECHIFY_SEND_VARIABLES=1`, completion callbacks and `end_call`. A green web health check alone does not verify calling.
3. Apply only the weekly prompt group with the existing sync workflow, then compare read-back settings. See [Speechify sync](speechify-api-sync.md). Weekly sync preserves existing provider memory and flow settings, so confirm there is no competing provider memory or overriding published phase before interpreting a test as the new experience.
4. Run the deliberate owner calls above, confirm the retained recap and the next call's memory, and listen together before extending the pilot.

No terminal action is needed from the owner while this PR is under review. The exact deployment commands should be provided against the merged commit and current server state. This local work does not upload provider settings, deploy the service or place real calls.

## Verification record

On 18 October 2026, TypeScript, ESLint and all 731 tests in the disposable PostgreSQL suite pass, with zero failures and zero skips. The new regressions exercise parser ordering, confirmation, no-action storage, delayed correction, signed webhook handling, outbound request variables, prompt rendering, two-caller isolation, STOP during backoff and recap suppression. The full suite includes Beliefs regressions to protect shared infrastructure; this change does not alter its journey or scripts.

Real audio quality, provider flow overrides, voicemail behaviour and live delivery remain pilot checks. No retention uplift is claimed from synthetic tests.
