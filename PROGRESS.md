# PROGRESS

**Milestone 0b — built and tested. It has not rung your phone yet, and I could not make
it do so from here. Three things needed, below.**

## What you need to do to hear it

I can't place the call from this environment. Nothing is wrong with the code — the
environment is the wrong shape for it:

1. **No `.env` here.** The container clones the repo fresh and `.env` is gitignored, so
   your keys never arrived. Expected, just worth saying plainly.
2. **Nothing can reach this container inbound.** Telnyx has to open a websocket *to* the
   voice service. A cloud container behind no public hostname cannot receive that, with
   or without keys.
3. **Vendor docs were blocked.** `docs.x.ai`, `docs.telnyx.com` and
   `platform.openai.com` are all refused by this environment's egress policy.

So, on your machine:

```bash
git pull && npm install
cp .env.example .env      # fill in the six keys the README lists
npm run stress            # prints the 8 turns, places the call, then asks for scores
```

`VOICE_WS_PUBLIC_URL` needs to be publicly reachable — a tunnel is fine for this.

**Before that call: skim [docs/VERIFY.md](docs/VERIFY.md).** It is a short checklist of
exactly which wire details I could not confirm against real documentation, and the one
that matters most is flagged.

## The finding that changed the design

**Grok's turn detection is silence timing only** — `server_vad` with a
`silence_duration_ms`, and nothing else. No semantic or context-aware mode exists. The
LiveKit plugin's default is 200ms, which would cut off a thinking pause before it began.

Your hardest requirement says context-aware turn detection, never silence timing alone.
The chosen stack cannot do it. So the provider's VAD is switched off and we decide turns
ourselves, using the partial transcript, whether the question was a hard one, and the
user's own measured pauses. Every rule only ever adds patience; none subtracts it.

This is more work than delegating it, and it is better: the logic is provider-neutral, so
the part of the system that most differentiates the product no longer lives inside a
vendor. It survives a stack swap intact.

Not a decision I need from you — but if you disagree, this is the moment.

## Done

- **Voice service** — long-running Node, one websocket per call, PCMU end to end with no
  transcoding in either direction.
- **Both adapters from the first commit.** Nothing above the boundary knows which vendor
  is beneath it. Grok's post-cancel quirk (it leaves a response in flight after an
  interrupt) is quarantined inside `grok.ts`.
- **Context-aware endpointer.** `ENDPOINTING_SENSITIVITY`, 0..1, default 0.25 — the
  single documented knob, with every derived threshold logged at call start.
- **In-call learning loop.** Correction phrases, barge-in, and the agent cutting someone
  off all append a note to a live buffer folded into every later turn of that call. One
  note per kind — no apology pile-up.
- **Backchannels are not interruptions.** "mhm", "yeah", "uh huh" are recognised and
  ignored. Stress-test item 4 has a test of its own.
- **Time courtesy with suppression.** Each line once, never mid-turn, never within two
  minutes of anything difficult, and if no natural break comes it is never said at all.
- **SCRIPT.md is parsed at runtime** — 40 keyed lines. Rewrite a line and the next call
  changes. No code touches English.
- **`npm run stress`** — repeatable, prints the 8 turns with 1, 2 and 7 starred, places
  the call, collects the five scores, writes them with the objective metrics to `runs/`.
- **32 tests, all passing.** Including the full call loop driven on a fake clock against
  a mock provider: a 5-second pause is held, the turn then completes, audio reaches the
  caller, and metrics are recorded. Plus a scrubbing test proving no phone number, email
  or transcript can reach a log.
- `npm run check` — typecheck, lint, tests — green.

One real bug the tests caught: "uh huh" was not in the backchannel set, so it would have
been counted as an interruption. That is stress-test item 4 failing, found before you
ever heard it.

## Testing the silence problem

Added since: an offline replay harness. Fixtures are timing traces — when speech started
and stopped — not audio, so the corpus can live in the repo and grow with no privacy
cost. Each declares when the person actually finished; ending the turn before that is a
false cut, which is the failure that matters. The live loop and the replay run the same
detector.

    npm run replay        # what each sensitivity does to the corpus

It found two real bugs on its first run: "I did the run on" scored as a finished sentence
(no prepositions in the trailing-word set), and the fragmented disclosure was cut at 6.9s
because "I've been finding it hard" is a grammatically complete clause. Both fixed — the
second with within-turn pause memory.

Also added: a false-cut estimator that runs on every real call, so we measure this
continuously rather than only when you sit down to score a run.

**What the numbers say, honestly.** Zero cuts at the shipping default, but the safe band
is narrow (0.5 already cuts two of eight) and the price is several seconds of dead air on
fragmented turns. Too blunt to be final. And the fixtures are written by me, not
measured — a real regression gate, not evidence about human timing.

## Waiting on you

1. Run it and hear it. That is the whole of 0b.
2. Then your SCRIPT.md rewrite, with the call in your ear rather than on the page.

## Notes

- Cost is reported as `null`, not estimated. No current Norwegian termination rate, no
  confirmed voice-model price, and an invented number in a cost model is worse than an
  empty field. Set `TELEPHONY_RATE_PER_MIN` and `VOICE_MODEL_RATE_PER_MIN` when you have
  them and it fills in.
- `TURN_TAKING=provider` exists as a debug fallback. Not for real users, and the stress
  test prints which mode ran so a score can never be attributed to the wrong one.
- Script §10, serious disclosure, is still behaviour-only. Wording at Milestone 5, for
  your review before it can reach anyone.
