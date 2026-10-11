# Speechify prompt and variable sync

The repository is the source for the two weekly 8&80 prompts and the three Beliefs prompts. `npm run speechify:sync` uploads that source through Speechify's settings API, rather than requiring prompt and variable copy/paste in the console.

This command ships with the Beliefs branch. Merge the required parent changes and this PR, then update the server checkout and install its locked dependencies before using it there. It reads the root `.env` automatically. Keep the existing credentials on the server; do not paste them into chat.

## Existing weekly agents

From the ordinary SSH shell, after the server contains this change:

```bash
cd /opt/8-80
npm run speechify:sync -- --group weekly --apply
```

It uses `SPEECHIFY_FIRST_CALL_AGENT_ID` for the first conversation and `SPEECHIFY_AGENT_ID` for returning conversations. The IDs must be distinct. For existing weekly agents it changes only the prompt and adds missing variable declarations. It preserves the voice, greeting, attached tools, provider memory, callback settings, phone assignments and existing variable defaults. New declarations receive empty defaults; real caller values continue to be injected by the server at call time.

Review the source plan without network requests:

```bash
npm run speechify:sync -- --group all
```

Compare saved Speechify settings with the source without provider writes:

```bash
npm run speechify:sync -- --group weekly --check
```

`--check` exits with 2 for a difference or missing agent, 1 for an error, and 0 when prompts and variables match. It does not mean tools or actual calls work. Online commands use a private local lock directory to prevent concurrent syncs.

## Beliefs agents

```bash
cd /opt/8-80
npm run speechify:sync -- --group beliefs --apply
```

This configures the separate onboarding, daily and weekly roles. Their prompts come from the three scripts in `docs/beliefs`; their fixed opening messages come from `BELIEF_GREETINGS` in `prompt-pack.ts`. Beliefs sync deliberately updates and verifies `first_message` so a stale opening cannot ask a large reflection question before the new introduction. The two original weekly 8&80 agents keep their existing greetings.

It declares `belief_context`, `call_kind`, `session_id` and `session_token`, disables provider long-term memory and audio recording, enables voicemail/unavailable hang-up, and sets the completion callback to `PUBLIC_URL/webhooks/speechify`. The AMD object includes all three routing branches: voicemail and unavailable hang up; IVR uses the provider's `proceed` behaviour. Speechify replaces AMD wholesale on update, so sync and restore send complete routing objects.

The command updates configured `BELIEFS_*_AGENT_ID` values or reuses IDs from its private state. If an ID is missing, it creates a private agent with a temporary prompt, saves the ID, declares variables, then uploads the real prompt. Creation needs an existing returning agent's voice or `SPEECHIFY_SETUP_VOICE_ID`, a credential-free HTTPS `PUBLIC_URL`, and `SPEECHIFY_WEBHOOK_SECRET` for signed callbacks. The optional voice ID must come from Speechify's Agents voice catalog, rather than its Build TTS catalog. Existing voices are never replaced.

The command **does not create or attach tools**. Speechify's detailed tool API reference was password-protected during implementation, so the tool request shape has not been verified. Existing tools remain attached. The required `end_call` and Beliefs `capture_belief` tool names are checked only when the agent response exposes that metadata; listed tools still require a functional call test. The Beliefs capture tool must satisfy the server contract in [launch.md](beliefs/launch.md), including scoped session credentials and literal caller words. Neither a prompt upload nor a listed tool is sufficient to enable the module.

After the required tools are attached and the agents are checked, save their IDs to the server `.env`:

```bash
npm run speechify:sync -- --group beliefs --apply --write-ids
```

`--write-ids` changes only the selected agent-ID keys and makes a private `.env` backup first. It refuses to save a new routing ID when the required tool names cannot be verified. No `BELIEFS_` launch flag is enabled. The shared scheduler and service pick up changed routing IDs through the normal deployment/restart procedure; this command does not restart them.

## Failure and restore

All selected roles, variable limits and required creation settings are checked before the first provider write. A private restore point is saved and its filename reported before uploads start. Each upload is read back and reported immediately, so a later role's failure does not hide completed uploads. A later failure can leave earlier roles updated; the operation is not a multi-agent transaction. Rerun it to finish a confirmed configuration, or use the reported restore point.

The directory `.speechify-sync` is ignored by Git and restricted to its owner; its state and backups use mode 0600. Backups can contain prompts, personal variable defaults and an old `.env`. **Do not paste their contents.** Configuration status, prompt hashes, backup filenames, failed HTTP operation/status and recognised validation field paths may be printed. Agent IDs in diagnostic endpoint paths are replaced with `{id}`. Raw provider error bodies/messages, credentials, unknown field names and caller values are omitted.

To restore an existing agent's saved prompt/variable configuration, use the filename printed by your run:

```bash
npm run speechify:sync -- --restore BACKUP_FILENAME
```

Replace `BACKUP_FILENAME` with that reported `backup-….json` filename. Restore reads the file from the private directory, never deletes agents and does not restore routing IDs or phone assignments. New Beliefs restore points include the previous fixed greeting. Older restore points that did not capture a greeting leave the current greeting unchanged. Speechify may reject a restore if its beta schema changes; success is reported only after read-back verification. A manually changed flow, tool, voice or phone assignment is outside this restore's scope.

Creation uses a durable request key, but the available documentation did not establish idempotency support for agent creation. An uncertain create is therefore **never replayed automatically**. Find the private setup agent with the reported role's expected name in Speechify, set that role's agent-ID key on the server, and rerun. The command checks its name and private status before continuing. Do not delete saved state or create a duplicate to bypass this check. A confirmed ID is saved before subsequent uploads, so an interrupted prompt upload can resume normally.

If an interrupted process leaves `.speechify-sync/lock`, check that process has exited before removing the lock. Keep the state and backups.

## Verification boundary and references

The implementation is tested with a fake provider, including defaults, ordering, repeats, uncertain creates, recovery, restore and redacted diagnostics. The provider fixture rejects incomplete AMD objects on both creation and update, and models AMD replacement separately from merge-patch fields.

Real-account verification on 11 October 2026 isolated the initial HTTP 400: an AMD object missing `on_ivr` was rejected on both POST and PATCH with the generic message “Request body is not valid JSON.” The same creation request with the IVR branch included returned HTTP 201 for the daily and weekly agents. The onboarding agent was created with a minimal request, then configured and checked separately. All five source prompts and required variable declarations matched on read-back; the three Beliefs agents were private, memory/recording were disabled, all AMD branches matched, and signed completion callbacks were configured. Their IDs were saved only in private setup state. The tracked server checkout stayed clean, no calls/messages were sent, the web service remained active, and scheduled calls remained paused.

This verifies agent provisioning and stored settings. It does not verify the capture tool, published flows or real call behaviour, and does not enable Beliefs launch flags or save new routing IDs to `.env`.

Speechify Agents is a beta API, so unexpected response shapes stop the operation. Read-back verifies stored base prompts and variables; published conversation phases can override a base prompt. Check any existing flow overrides in Speechify before treating an upload as the effective live script.

Primary references reviewed on 11 October 2026:

- [Voice Agent API](https://docs.speechify.ai/agents/voice-agent-api): agent creation and settings updates.
- [Get Dynamic Variables](https://docs.speechify.ai/voice-agents/api-reference/voice-agents/tts-agents/dynamic-variables/get-dynamic-variables) and [Add variables](https://docs.speechify.ai/agents/guides/add-variables): customer catalog, reserved keys and replacement semantics.
- [Conversation phases](https://docs.speechify.ai/agents/guides/concepts/conversation-phases): phase-specific prompt overrides.
- [Tools](https://docs.speechify.ai/docs/voice-agents/tools): attached webhook and built-in tools; detailed provisioning remains unverified.
