# 8&80

A voice-based accountability product. A user schedules a recurring phone call; at the
agreed time their phone rings and an AI mentor asks what they committed to last week,
what actually happened, and what the one thing is for next week. Ten to fifteen minutes.
Afterwards, a short recap by email with their single commitment.

The name is the framework: two internal mentors. The eight-year-old cares about
aliveness, novelty, curiosity, play. The eighty-year-old cares about durability,
compounding, relationships, security. The call helps the user notice which of the two
their week actually served — and whether it served neither, which is the common case.

## Where this is

**Milestone 0b.** The voice service is built and its loop is tested end to end against a
mock provider. It has not yet placed a real call — see *Placing the first call* below.

- [SCRIPT.md](SCRIPT.md) — the mentor side of the call. Parsed at runtime; rewriting a
  line changes the next call with no code change.
- [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md) ·
  [PROGRESS.md](PROGRESS.md) · [docs/VERIFY.md](docs/VERIFY.md)

## Layout

```
services/voice/          long-running Node service, one websocket per call
  src/adapters/voice/      provider-agnostic voice interface + Grok + a mock
  src/adapters/telephony/  provider-agnostic telephony interface + Telnyx
  src/turn/endpointer.ts   context-aware turn detection — the hardest requirement
  src/call/                the loop, correction detection, the time courtesy
  src/script.ts            SCRIPT.md → keyed lines
  src/stress.ts            the repeatable 8-turn stress test
```

The current web surfaces are rendered as HTML by the voice service. Their shared
design system lives in `services/voice/src/design-system/`. See
[the implementation guide](docs/design-system.md) and run `npm run design:preview`
for the visual handbook and synthetic product previews. `npm run design:build`
regenerates the portable handbook, CSS, tokens, outlined logos and icon package in `brand/`.
`npm run design:verify` checks the full suite with an isolated Postgres database,
Chromium, iPhone/WebKit emulation and committed visual baselines.

## Running it

```bash
npm install
npm run check          # typecheck, lint, tests
npm run test:db        # ...and the ones that need Postgres
```

Everything above runs with no keys and no network.

`npm run check` skips every test that needs a database — about a sixth of the suite — and
reports green while doing it. That is how a test asserting behaviour we had deliberately
replaced sat red for weeks. `npm run test:db` starts a throwaway cluster, runs the lot, and
removes it again; run it before pushing anything that touches the store, the scheduler or
the loop.

### Placing the first call

Needs three things this repository cannot provide: credentials, and a host Telnyx can
open a websocket to.

```bash
bash scripts/setup-env.sh   # prompts for each value, hides secrets
npm run preflight           # checks everything locally, dials nobody
npm run stress
```

If the public hostname is dead, the stress test **starts a fresh Cloudflare tunnel
itself** and uses it. Quick tunnels get a new hostname on every restart and die with
their window, so a stale one in `.env` is the normal state of affairs rather than a
mistake — and a stale one produces a call that connects and then sits in silence, which
is indistinguishable from a broken voice model. Requires `cloudflared` on PATH
(`brew install cloudflared`).

`npm run checkurl` proves the carrier can actually reach the service — HTTP, then the
websocket upgrade — in a few seconds and without dialling anyone. The stress test runs
the same check before it dials, so a stale tunnel hostname costs a second rather than a
phone call. Tunnel hostnames change on every restart, and the dead one left in `.env`
produces a call that connects and then sits in silence.

`preflight` runs automatically before the stress test too. It catches the failures that
otherwise produce an unhelpful dial error: a number that is not E.164, a `localhost`
websocket URL the carrier cannot reach, a phone-number SID pasted where the account SID
belongs, and it reminds you to enable the destination country under **Voice** geo
permissions — which is a different setting from Messaging geo permissions.

Outbound calls carry their TwiML inline, so **nothing on the number's own configuration
page needs setting**. Those Voice and Messaging webhook fields are for inbound, which we
do not use yet.

Either telephony provider works — `TELEPHONY_PROVIDER=telnyx` (production) or
`TELEPHONY_PROVIDER=twilio` (fallback, and the quickest first call, since its TwiML goes
inline and Twilio never has to fetch anything from us).

| Provider | Keys needed |
|---|---|
| Telnyx | `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |

Both also need `XAI_API_KEY`, `OUTBOUND_CALLER_NUMBER`, `STRESS_TEST_TARGET_NUMBER` and
`VOICE_WS_PUBLIC_URL`.

`VOICE_WS_PUBLIC_URL` must be reachable from the public internet — a tunnel while
developing locally, or the VPS. In production this is a DNS-only subdomain: the media
websocket must **not** pass through Cloudflare's proxy.

**Running it on the VPS: see [DEPLOY.md](DEPLOY.md).** No tunnel needed there.

`npm run stress` prints the 8 turns to perform, places the call, and on hangup asks for
the five 1–5 scores and writes them with the objective metrics to `runs/`. Run it again
after every endpointing change — that is what it is for.

### Voice choice and between-call texts

The [first feedback implementation](docs/first-feedback.md) adds a female voice option at
registration and in Your calls, a more spacious registration page, and opt-in SMS between
calls. Apply migration 0028 and configure the separate female first/returning Speechify
agents before offering that voice. The document records setup and verification.

### Changing what the mentor says

The [weekly call quality and memory plan](docs/weekly-call-quality.md) records the verified memory path, conversation changes and owner listening scenarios. `npm run quality:weekly` runs the synthetic baseline without contacting providers.

For Speechify-hosted agents, [Speechify API sync](docs/speechify-api-sync.md) uploads the repository's prompts and variable declarations. `npm run speechify:sync` previews its plan locally; `--apply` updates the selected agents without placing a call. It covers the original first/returning pair and the separate Beliefs agents.

Edit [SCRIPT.md](SCRIPT.md). It is parsed at runtime, so the next call uses your words
with no code change. To see exactly what the model will be told:

```bash
npm run prompt            # a returning call
npm run prompt -- first   # the first call a user ever gets
npm run prompt -- third   # the third-week-running case
```

No keys, no network, no call. It also checks the voice rules still hold — no exclamation
marks, nothing congratulatory.

### Comparing runs

```bash
npm run runs
```

Every stress run side by side, sorted by sensitivity, with the false-cut count next to
the subjective scores and your own notes. Tuning endpointing off a single call is how you
end up chasing one bad evening.

### The one knob

`ENDPOINTING_SENSITIVITY`, 0..1, default 0.25. Lower is more patient. Every other
threshold derives from it and the derived values are printed at the start of each run.

## Calendar invitations

Callers can opt in during signup or in **Your calls → Contact and preferences**.
The service emails a single `.ics` invitation for the next booked weekly call and
sends its successor after the current call finishes. It never creates a recurring
calendar series. Other live programmes with explicitly booked calls receive their
own invitations, without expanding their cadence into future weeks.

Rescheduling updates the same calendar event. Skipping moves it to the replacement
appointment; pausing, losing access or opting out cancels future invitations.
Changing email cancels the old-address invitation and creates one at the new address.
The existing encrypted email outbox handles idempotency, retries and stale-message
suppression; the minute tick reconciles SMS and programme schedule changes too.

The email and calendar description include a permanent **Manage your calls** link
to `/me`. It uses the existing browser session or account recovery, so forwarded
calendar entries carry no temporary account-access code. New invitations omit a
map location; their description explains that the service calls the user's phone.

Apply migration **0034_calendar_invitations** before starting this version. Delivery
uses the existing `RESEND_API_KEY` and `RECAP_FROM_ADDRESS`; no calendar account
connection is needed. An ordered real-inbox test in Gmail and Google Calendar
confirmed acceptance, movement without duplication and cancellation. Outlook and
Apple Calendar remain unverified. Automated tests use synthetic providers and
send no real invitations.

See [the calendar verification record](docs/calendar-invitations-verification.md)
for the live invitation, move and cancellation tests and the remaining calendar-client check.

## Before a call reaches anyone who is not the author

Work through [docs/VERIFY.md](docs/VERIFY.md). Vendor documentation hosts were
unreachable when the adapters were written, so the wire details came from shipping client
libraries and the official Telnyx SDK types and need checking against real docs.

`runs/` is committed deliberately — the scores are the baseline for tuning, and they only
ever contain numbers, timings and your own notes. No transcript content is written there,
or anywhere else outside the encrypted store.
