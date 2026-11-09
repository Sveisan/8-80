# Unblock: Speechify setup checklist

For the owner. About 15 minutes: one browser step and a few server commands. Nothing here turns Unblock on for callers: `UNBLOCK_ENABLED` and `UNBLOCK_SAFETY_APPROVED` stay `false`.

## Why one step is in the browser

Our code can create and configure the three Unblock voice agents through Speechify's API. It cannot yet create the `capture_unblock` tool the same way: Speechify's tool-creation API is unverified (its webhook request shape is not documented well enough to trust). So you create that one tool definition by hand, once. The server then checks your work field by field, attaches it to the agents, and stops if anything differs.

Field labels below describe what to enter. If a label in the console differs slightly, match it by meaning; the server check is the authority.

## Step 1 (server): create the three agents

```bash
cd /opt/8-80
npm run speechify:sync -- --group unblock --apply
```

It creates three private agents (opening, weekly, light) with their prompts, greetings and variables, and keeps their IDs in its private state. No `.env` change yet. Optional dry run first: `npm run speechify:sync -- --group unblock` (no network).

## Step 2 (browser): create the `capture_unblock` tool, once

In the Speechify console, open the Agents tools area and create a new custom (webhook) tool.

| Field | Value |
|---|---|
| Name | `capture_unblock` (exactly, lower case) |
| Description | Check every caller utterance for safety and record a confirmed Unblock note. Call after each caller turn. Send the caller's words verbatim in caller_text. Never speak the session values aloud. |
| Kind | Webhook |
| Method | `POST` |
| URL | `https://YOUR-PUBLIC-URL/unblock/tool` (same host as `PUBLIC_URL` in the server `.env`; https; no trailing slash; no query) |
| Headers / auth | None. The session token in the body is the credential. |

Parameters. Names must match exactly. Add all 15.

| Name | Type | Required |
|---|---|---|
| `session_id` | string | yes |
| `session_token` | string | yes |
| `event_id` | string | yes |
| `caller_text` | string | yes |
| `command` | string | no |
| `confirmed` | boolean | no |
| `text` | string | no |
| `why_text` | string | no |
| `kind` | string | no |
| `outcome` | string | no |
| `outcome_text` | string | no |
| `carry_text` | string | no |
| `days` | string | no |
| `time` | string | no |
| `week` | integer | no |

Save it, then copy its tool ID (shown in the console or its URL). Do not attach it to any agent by hand; the server does that.

## Step 2b (browser): add `end_call` to each of the three agents

Agents created through the API get **no built-in tools**, and the server refuses to attach `capture_unblock` or save routing IDs until `end_call` is present and enabled. Step 3 otherwise fails with "Read-back did not verify the intended binding and existing tools". Built-ins are per agent, so this cannot be copied from the weekly agents.

For each of *8&80 Unblock · opening*, *· weekly* and *· light*: open the agent → **Tools** → **Add built-in** → **End call**. Keep the name `end_call`, set the description to:

> End the call after the closing line has been said, or when the caller says they want to stop. Never end while the caller is still speaking.

Then **Add built-in**, and check that its switch is on.

## Step 3 (server): verify and attach

Replace `TOOL_ID` with the ID from step 2.

```bash
npm run unblock:tools -- --prepare --tool-id TOOL_ID
npm run unblock:tools -- --check   --tool-id TOOL_ID
npm run unblock:tools -- --enable  --tool-id TOOL_ID
```

- `--prepare` verifies the definition, attaches it to all three agents and leaves it disabled.
- `--check` re-verifies without changes.
- `--enable` switches it on for the three agents.
- Error text names what is wrong. Fix the tool in the console and rerun. `--disable` switches it off again.

## Step 4 (server): save the routing IDs

```bash
npm run speechify:sync -- --group unblock --check
npm run speechify:sync -- --group unblock --apply --write-ids
```

`--write-ids` writes `UNBLOCK_OPENING_AGENT_ID`, `UNBLOCK_WEEKLY_AGENT_ID` and `UNBLOCK_LIGHT_AGENT_ID` into `.env` (with a private backup), and only when `end_call` and `capture_unblock` are both listed and enabled on each agent. It never touches `UNBLOCK_ENABLED` or `UNBLOCK_SAFETY_APPROVED`.

## Still needed before real callers

- A test call to each agent confirms the greeting, the tool call and a recorded note. A listed tool is not proof.
- Speechify phase/flow overrides, if any, can replace the uploaded prompt. Check none exist on these agents.
- The safety procedure must be approved before `UNBLOCK_SAFETY_APPROVED` is set; that is a separate decision.
- Undo: `npm run unblock:tools -- --disable --tool-id TOOL_ID`, or `npm run speechify:sync -- --restore BACKUP_FILENAME` for prompt and greeting changes.
