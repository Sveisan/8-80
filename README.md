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

The web app (Next.js) arrives at Milestone 1.

## Running it

```bash
npm install
npm run check          # typecheck, lint, tests
```

Everything above runs with no keys and no network.

### Placing the first call

Needs three things this repository cannot provide: credentials, and a host Telnyx can
open a websocket to.

```bash
bash scripts/setup-env.sh   # prompts for each value, hides secrets
npm run preflight           # checks everything locally, dials nobody
npm run stress
```

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

## Before a call reaches anyone who is not the author

Work through [docs/VERIFY.md](docs/VERIFY.md). Vendor documentation hosts were
unreachable when the adapters were written, so the wire details came from shipping client
libraries and the official Telnyx SDK types and need checking against real docs.

`runs/` is committed deliberately — the scores are the baseline for tuning, and they only
ever contain numbers, timings and your own notes. No transcript content is written there,
or anywhere else outside the encrypted store.
