# First customer feedback — 3 November 2026

The supplied voice note values the emotional resonance of the eight/eighty questions,
the mentor's patience, the straightforward registration and the rescheduling SMS.
Its concrete requests are a choice of male/female voice at registration and more
space, stronger text hierarchy and a visual on that page. The screenshot proposes
occasional messages from the same number. The patent suggestion and recruiting more
testers are feedback, not instructions to contact people or begin legal work.
The private audio and its transcript are not committed.

## Implemented

- Registration has a responsive two-column desktop layout, larger heading, quieter
  secondary copy, more space and a lightweight inline SVG illustrating the two
  perspectives. Mobile uses a single column. Existing brand colours, reduced-motion
  support, field labels and booking/date behaviour remain in use. No external image,
  font or tracking request is added.
- Available male/female choices survive form errors, draft editing, resends and phone
  verification. Only the verified new account receives the selected voice; an existing
  account is not changed by another signup. The choice can also be changed in Your calls.
- Both female first and returning calls use their own Speechify agents and the same
  caller number. The regular pair stays available. A missing female route refuses a
  call rather than silently using a different voice. In-progress onboarding and
  rehearsals use the female first-call route too.
- Optional between-call texts default off. The checkbox explains the frequency,
  booking timezone and controls. Texts use the existing SMS number, every 2–4 local
  calendar days, at varying times from 10:00 inclusive to 18:00 exclusive. A stable
  hash selects the next slot once; repeated scheduler ticks do not reroll it.
- Texts begin after completed onboarding, contain no private call information, and use
  eight supportive messages rather than guilt or claims to be the recipient's future self.
  They use the encrypted, durable message outbox and its existing retry/receipt handling.
  STOP, pause, safety holds, entitlement, sender matching and the preference are rechecked
  under the caller lock immediately before sending. Preference changes invalidate old
  requests, including requests already claimed but not handed to the provider. Requests
  already handed to a provider cannot be recalled.
- Optional messages avoid active calls, recent SMS and another nudge in the last 24 hours.
  Old slots after downtime are skipped. Delivery retries expire after at most two hours
  and never continue past 18:00 local time. Turning these texts off does not stop calls.

The call's patience settings and conversation prompts have not been retuned based on
positive feedback. New page and text copy remains in SCRIPT.md.

## Deployment and female voice setup

Migration `0028_voice_and_nudges.sql` adds voice/nudge fields to signup drafts and
three nudge scheduling fields to callers, with a partial due index. Existing profiles
already have a voice field. The migration and its generated Drizzle snapshot are included.
Existing callers are not opted in to texts. Apply migrations before starting this code.

Speechify agents carry fixed voices: the [outbound API](https://docs.speechify.ai/voice-agents/api-reference/v1/agents/outbound-calls)
selects an agent, and the [agent settings API](https://docs.speechify.ai/voice-agents/api-reference/v1/agents/-id-/patch)
manages its TTS voice. This implementation therefore uses a second pair of agents.
Use a verified female voice ID from the workspace's [agent voice catalog](https://docs.speechify.ai/agents/api-reference/v1/agents/voices).
No provider voice ID is invented or borrowed from the separate XAI adapter.

1. Keep the existing weekly first and return IDs. Set `SPEECHIFY_FEMALE_VOICE_ID`.
2. Run `npm run speechify:sync -- --group weekly-female` for the offline plan, then
   the existing `--check` / `--apply` workflow. Creation uses the corresponding weekly
   greeting, language and TTS pacing; private setup state records new IDs before routing.
   New female agents disable provider memory and audio recording, configure AMD and
   use the existing signed completion webhook. Existing weekly agents are not changed
   by the female-only group. Backup and restore include the female TTS settings.
3. Configure and verify `end_call`, number assignment, webhook signing and any provider
   flow overrides on both new agents before routing customers. Sync deliberately does
   not create tools or reassign numbers. Its `--write-ids` gate refuses new routes when
   required tools cannot be read back. Run `--apply --write-ids` only when these are ready.
4. Both `SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID` and `SPEECHIFY_FEMALE_AGENT_ID` must be
   distinct from each other and all other agent roles. The form offers the choice only
   when both routes are configured. Preflight catches incomplete/duplicated routes.
5. Normal `--group weekly` sync also includes a configured female pair, so future prompt
   changes reach both voices. Check the selected voice in one deliberate first and
   returning owner test, including memory settlement and an audible farewell.
6. Between-call texts become available when `SMS_FROM_NUMBER` and the pinned
   `SPEECHIFY_CALLER_ID_NUMBER` match. No new global launch flag, phone purchase or
   messaging provider is introduced. The normal minute tick queues and dispatches them.

No production deployment, provider configuration, test call or customer message was
performed as part of this local implementation. A synthetic preview is not a voice audition.

## Verification

TypeScript and ESLint pass. All 760 tests pass against a disposable PostgreSQL database, with no skips. The suite covers real HTTP registration,
wrong codes, preserved draft choices, verified profile creation, account preferences,
stored voice through scheduler and hosted request, concurrent nudge ticks, encrypted
outbox delivery, control suppression, subscription expiry, sender changes, DST, quiet
hours and downtime. Provider settings tests cover female prompt parity, role collisions,
voice read-back, backups and restore. Provider requests use injected synthetic transports.
An existing callback test now checks 17:30 in Oslo rather than assuming a summer UTC offset.

Playwright checks the 1440px desktop and 390px mobile layouts in light/dark mode,
including the native voice controls and the unchecked optional-message checkbox.
Screenshots stay in ignored `output/playwright/`.
