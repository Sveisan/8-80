# Weekly dialogue: independent routing and flow-preserving releases

This replaces the unmerged release approach in PR #37. The current four conversation flows, their phase prompts, read-backs, greetings, farewell and published versions remain unchanged. This change does not activate a flag, publish an agent, call anyone, move a booking or send a message.

## Independent capabilities

`WEEKLY_DIALOGUE_READY=1` selects the existing four dialogue agents for ordinary first/return calls in either voice. It requires `SPEECHIFY_SEND_VARIABLES=1`, but no feature-tool secret or feature permission. The owner-only dialogue pilot remains limited to the exact valid pilot hash when global dialogue is off.

`WEEKLY_TOOLS_READY`, the existing feature-pilot scope and tool secret continue to govern tips and SMS actions independently. With feature access off, server context contains only `available:false` and the dialogue policy marker: no attempt ID or session token is exposed. A dialogue-only caller cannot call the feature tool successfully. Turning dialogue off restores the existing fallback routing for future calls; this release does not change any flag itself.

## Read-only verification of the current flows

Run on the service host as the service user:

```sh
npm run weekly:release -- --check
```

The check reads all four private dialogue agents, complete tool/variable catalogues and active/draft flow heads. It compares the full effective graph against `weeklyFlow` bound to the existing tool IDs, including every phase prompt, spoken node and tool filter. An absent published flow, edited prompt/greeting/tool filter, unknown flow response, unreviewed draft, missing variables, enabled provider memory/recording or unsafe voicemail setting fails verification. A matching draft or no draft is accepted. Historical published versions are not required to be empty.

Top-level prompts/greetings may be preserved legacy fallbacks: effective speech is owned by the active flow. They are included in the private configuration fingerprint, together with voice/model/turn settings, bindings and variables, but are never rewritten to make a check pass. The check performs GET requests only, makes no configuration writes and prints only status, role names and a fingerprint. A successful configuration check is not a phone-audio approval or aftercare-delivery test.

`--if-enabled` is used by the updater: if neither dialogue flag is active, it reports that verification is not required and does not contact the provider. It does not enable dialogue.

## Safe application update

After merge, invoke the **merged release's copy** of `scripts/update-safe.sh` with the full release SHA as root. The updater:

1. Checks a clean checkout, the exact merged target and the update lock.
2. Pauses future timer startup without stopping a running tick. It takes the scheduler's exclusive `runs/release.lock`, refuses an active tick and checks for claimed/placed/active/settling calls in a read-only transaction.
3. Stops the web service only after the first drain succeeds, then checks the drain again. Busy/unknown calls cause refusal; the updater never terminates a call to proceed.
4. Backs up the database, environment and revision privately; fast-forwards to the requested commit, installs dependencies and applies migrations.
5. Runs configuration checks and the new read-only weekly check, verifies the environment remains byte-for-byte unchanged, starts web, checks health and restores the timer's prior state. `--resume` is an explicit request to enable a previously paused timer.

A refusal before code mutation restores the previous web/timer state where possible. A failure after code mutation leaves scheduling paused and reports the service state for operator review; an unverified web restart is stopped. It never calls the old `--disable` recovery or changes a previously working dialogue/tool flag. There is no blind code/database rollback after migrations, no provider rollback and no legacy-prompt promotion. Use the private backup and an explicitly reviewed recovery plan if a partially applied application release fails.

The release lock remains held through health verification and timer restoration. Deployment requires the normal server privileges; this PR does not deploy itself.

## Aftercare evidence and remaining acceptance

The updated database regression exercises the current scheduler, both voices, signed first/return completions, confirmed memory, repeated/concurrent callbacks and one recap intent/transport attempt/provider acceptance per completed call with feature authority absent. Re-dispatch of an accepted recap does not send again. Unconfirmed action text does not overwrite the caller's chosen action or appear in the recap. Other callers remain isolated. Provider transports and receipts in these tests are synthetic; acceptance is not delivery.

PR #37's 13 November delivered-email record remains historical evidence for its tested source. It is not fresh verification of this changed source. Any new claim of live aftercare must use a separately authorised isolated owner test and verify signed completion, storage/counter once, outbox intent/attempt once and actual provider delivery on the deployed release. No new phone or email test is authorised merely by this document.

Current CI and local code/database/browser checks are recorded in the replacement PR. Published conversation graphs and the prompt source are unchanged from its base. Existing owner audio approvals retain their original scope; no new audible-behaviour approval is claimed.
