# DECISIONS

Every meaningful choice and why, so we don't re-litigate settled questions later.
Newest at the bottom of each section.

---

## Locked before build (from the v3 brief)

| Decision | Why |
|---|---|
| English at launch; architecture never assumes it | Norwegian is next, and retrofitting i18n through a voice loop is a rewrite |
| Lemon Squeezy for payments | Merchant of Record — they carry EU VAT. Effective fee ~6%, not 3%; cost model must say 6% |
| Telnyx primary, Twilio adapter as documented fallback | Roughly half Twilio's rate, lower measured latency on owned network. +47 termination rates still unverified |
| Better Auth, self-hosted in our own Postgres | A US-hosted auth service would undercut the data-residency position entirely |
| Deploi VPS in Norway, Cloudflare in front of the web app only | Data residency |
| Voice websocket bypasses Cloudflare's proxy — separate subdomain, DNS-only, own TLS | Proxying real-time audio adds latency and drops long connections |
| Separate long-running Node service for the voice loop | Serverless cannot hold a websocket for a 15-minute call. Not an optimisation, a constraint |
| Grok Voice Think Fast 2.0, speech-to-speech, no bake-off | 0.70s time-to-first-audio, best speech reasoning in the independent index, 25+ languages with mid-call switching, one model instead of three chained services |
| Fast model in-call, larger model post-call | Latency is felt turn-by-turn; depth is not. Post-call latency is free and is where the perceived intelligence lives |
| No raw audio stored by default | Transcript is enough for the product. Audio is the highest-risk data we could hold and we'd hold it for nothing |
| Application-layer encryption for transcripts and summaries | Disk encryption does not protect against a compromised app or an over-broad query. Per-user data key wrapped by a master key held outside the database |
| No card in signup; phone verification is the gate; capacity-capped free tier | A card gate costs more signups than it saves in abuse. Verified phone is both the trust gate and the abuse gate |
| One fixed +47 mobile number for voice and SMS, never rotated | See **Caller identity — resolved** below. Corrected after the brief: the constraint is harder than "no CNAM" |
| Never leave a voicemail | An AI voice on voicemail is uncanny and burns synthesis for nothing |
| Billing decision made in advance, never mid-call | Someone thirty minutes into a hard conversation cannot evaluate a price, and a verbal "your hour is up" is not consent to be charged |
| Culture asked, never inferred. Locale sets starting defaults only | Inferring origin, ethnicity or religion from a voice is Article 9 special-category data, legally exposed, and exactly the quiet stereotyping that would make the product worse |
| Flagged crisis calls are never auto-actioned | No algorithmic decision about a person in distress. A human reads it first |

## Accepted risk: choosing Grok without a bake-off

OpenAI leads the Conversational Dynamics benchmark — pause handling, backchannels,
turn-taking — which is the exact thing this product lives or dies on. Grok wins on speed
and comprehension. We chose the first without hearing the second.

Two insurances, both binding:
1. The voice provider sits behind an adapter from the first commit, same as telephony.
   Grok's API is OpenAI Realtime-compatible with published migration notes, so moving to
   `gpt-realtime-2.1` should be config, not a rewrite. Nothing in the loop may couple to
   Grok-specific behaviour.
2. The 8-turn stress script survives as a product test rather than a comparison, and the
   scores are kept as the baseline for endpointing tuning and for any future stack swap.

---

## Milestone 0a

**SCRIPT.md is keyed, not prose-in-code.** Every spoken line has a stable ID
(`open.first.disclosure`). The voice loop references IDs; English is one locale's values
for those keys. This is what "do not hardcode English anywhere" means in practice —
adding Norwegian is a values file, and the loop never changes.

**Turn variants are chosen by config, not by the model.** The `.a` / `.b` / `.c` variants
of the "I did nothing" turn and the closing question are selectable per user, one active
at a time. If the model picks between them freely we can never attribute an outcome to a
line, and the whole point of having variants is to learn which one works.

**The disclosure is the second thing said, not the first.** Opening with it makes it a
legal notice, which is what the brief rules out; burying it makes it a disclaimer. It
lands after the greeting, in one breath, and is never repeated on later calls.

**Returning calls quote last week's commitment in the user's own words**, not a cleaned-up
paraphrase from the summary. The phrasing is the memory, and hearing your own words back
is most of the felt value.

**The commitment gets a day attached before the call ends** (`next.when`). Unscheduled
commitments are the ones that come back undone, and this is the cheapest intervention in
the product.

**`close.q.b` ("anything you didn't say?") is recommended as default but auto-suppressed**
on any call that touched a serious disclosure. It produces the most real material and it
can reopen a hard call at the exact moment the user was ready to be finished.

**§10 wording is deliberately absent.** Behaviour is specified so the script is complete;
the words are drafted at Milestone 5 and reviewed before they can reach a user.

---

## Caller identity — resolved

**Correction to the brief.** The original framing left open whether calls could show a
name. They cannot, and the constraint is harder than "Norway has no CNAM".

- **Voice caller ID cannot be alphanumeric.** PSTN caller ID carries a number, full stop.
  There is no branded caller ID to buy, from any provider, at any price.
- **Norway has no CNAM-style name lookup**, so no carrier resolves our number into a name
  on the recipient's screen either.
- Together: the product name can never appear on a Norwegian handset from the carrier
  side. This is not a thing to revisit when we have more budget.
- **Alphanumeric SMS sender IDs do exist in Norway** — eleven characters,
  pre-registration required — and are **rejected**. They are one-way. A user cannot reply
  to an alphanumeric sender, and the missed-call SMS depends entirely on being replied to.
  Trading the reply path for a name on an SMS would break the most important recovery
  moment in the product to win a cosmetic one.

**Decision: one fixed +47 mobile number, every call and every SMS, never rotated.**

**Decision: the onboarding vCard is a primary feature, not a convenience.** Since the
carrier will never show the name, the user's own address book is the only channel through
which it ever reaches the screen. Full spec in ARCHITECTURE.md. The detail that decides
whether it works at all: the `TEL` value must match the caller ID we present, exactly, in
E.164 — handset contact matching is a string match, and a format mismatch fails silently
with no error anywhere in our system.

### Provisioning constraints, recorded before we buy

Norwegian mobile numbers are eight digits and mobile ranges start with 4 or 9. Search
Telnyx `+47` inventory for numbers containing **0880** or **8080**. Wanted shapes:
`900 08 800` (`+4790008800`) and `400 08 800` (`+4740008800`).

**Avoid 800, 815 and 820 prefixes entirely.** They are service-number ranges and read as
telemarketing to a Norwegian recipient — exactly the association an unknown incoming
number cannot afford here. Recorded because a memorable pattern will eventually turn up
in one of them and look tempting.

---

## Milestone 0a — follow-ups

**Three variants of the commitment ask**, not just the closing question. This line runs
every call, and the failure mode is not vagueness but impressiveness: people name the
commitment that sounds like the person they'd like to be. Each variant disarms that
differently — A forces a choice, B removes the audience, C asks for a prediction rather
than a promise. Recorded because the variants are not stylistic; each is a different
hypothesis about why people perform, and the point is to learn which is true.

**C is the default** — the prediction framing. An intention inflates at no cost; a
prediction can be wrong, and people are markedly better calibrated forecasting than
promising. A and B are alternates.

**Variant B was rewritten because it was untrue.** It said "there's nobody here to be
impressive for". There is: the call is transcribed, summarised, emailed back, tracked
across weeks, and flagged calls are read by a person. The replacement removes the payoff
for inflating rather than making a claim about who is listening. Any future rewrite of
this line must stay true against PRIVACY.md.

**The automatic B-to-C switch on repeated undone commitments is dropped.** Repeated
misses could mean over-promising, or could mean someone is having a hard few months —
illness, work, something at home. The data cannot tell those apart, and they need
opposite responses. Automatically moving a struggling person to a more sceptical framing
at their lowest point, with nobody noticing, is the wrong call.

Detection stays. The automation goes. Instead the mentor asks — `nothing.pattern`,
"Third week running — is the goal wrong, or is something else going on?" — and the same
detection raises a flag for human review.

---

## Precedent — what the profile may change without asking

**The profile may change HOW the mentor listens without asking. Changing WHAT IT SAYS
ABOUT THE USER needs a human in the loop.**

| Allowed automatically | Needs a human, or needs asking the user |
|---|---|
| Endpointing threshold from measured pause distribution | Switching to a more sceptical or more challenging framing |
| Patience on a known long-pauser | Any line premised on a conclusion about their character or motives |
| Formality and time formats from locale | Any change that treats a pattern as evidence of a failing |
| Which topics to handle with care | Anything the user would experience as being judged |

The test: if the adaptation changes how well we hear someone, it can happen on its own.
If it changes what we are implying about them, it cannot — a person reviews it, or the
mentor asks the person directly and takes their answer at face value.

This holds for the fleet layer too. Aggregate learning may move defaults for listening;
it may never move what the mentor asserts about an individual.

**`nothing.c` — the bare "Mm." — is the stress-test default.** It is the variant that
fails hardest when endpointing is wrong, which is precisely why it runs during the test.
A chattier variant would paper over a turn-detection problem and we would ship it.

**`close.q.b` stays, with auto-suppression** on any call that touched a serious
disclosure. Confirmed.

---

## Milestone 0b — the finding that changed the design

**Grok's turn detection is silence timing only, and the brief forbids exactly that.**

The voice provider offers one turn-detection mode: `server_vad`, configured with
`threshold`, `silence_duration_ms` and `prefix_padding_ms`. There is no semantic or
context-aware mode. (Confirmed from the `XAITurnDetection` type in
`@mastra/voice-xai-realtime` 0.2.7 and the defaults in `@livekit/agents-plugin-xai`
1.7.1, whose default is `silence_duration_ms: 200`. Two hundred milliseconds would cut
off a thinking pause before it had started.)

The brief's hardest requirement is "context-aware turn detection, never silence timing
alone". The chosen stack cannot provide it. That is not a reason to change stacks — it is
a reason to own the behaviour ourselves, which is where it belonged anyway.

**Decision: we disable the provider's VAD (`turn_detection: null`) and decide turns in
our own service.** `TURN_TAKING=local` is the default. The endpointer measures inbound
audio energy and applies context:

| Context | Effect on patience |
|---|---|
| Sentence trailed off mid-clause ("...because") | Extended to the trailing-clause budget |
| One- or two-word answer | Extended — the placeholder usually precedes the real answer |
| Nothing said yet in response to a question | Whole line held open |
| The question was a hard one (`nothing.*`, `read.neither`, `next.ask.*`) | × 1.6 |
| The user's own measured pause distribution | Per-user offset |

Every rule only ever ADDS patience. There is no rule that shortens a wait.

Two consequences worth recording:

1. **This logic is provider-neutral**, so it survives a stack swap intact. Having to
   build it turns out to strengthen the insurance rather than weaken it — the thing that
   most differentiates the product no longer lives inside a vendor.
2. `TURN_TAKING=provider` exists as a debug fallback only. It is not a supported mode for
   real users, and the stress test prints which mode it ran in so a score can never be
   attributed to the wrong one.

**`ENDPOINTING_SENSITIVITY` (0..1, default 0.25) is the single documented knob**, as the
brief requires. Every threshold above is derived from it, and the derived values are
logged at call start so any run is reproducible.

**PCMU end to end, no transcoding.** PCMU 8 kHz is the Telnyx default and is also an
accepted provider format, so call audio passes through untouched in both directions.
µ-law is decoded only to measure energy for turn detection, never in the audio path.

**Cost is reported as null, not estimated.** We have no current Norwegian termination
rate and no confirmed voice-model price. A made-up number in a cost model is worse than
an empty field, so `cost` stays null until `TELEPHONY_RATE_PER_MIN` and
`VOICE_MODEL_RATE_PER_MIN` are set.

**Vendor docs were unreachable from the build environment.** Wire details came from two
shipping client libraries and the official Telnyx SDK types instead. Everything
unverified is confined to two adapter files and listed in docs/VERIFY.md, to be checked
against real documentation before the first call to anyone.

---

## How silence gets tested

The stress test alone cannot settle this. It is n=1, and you know what is coming, so you
will pause "correctly" without meaning to. Three layers instead, cheapest first.

**1. Replay against timing traces.** A fixture is when speech started and stopped, plus
the words so far — no audio. Timings carry no voice and nothing that identifies anyone,
so a corpus can live in the repository and grow forever without becoming a privacy
liability or something the retention job has to reach.

Each fixture declares `trueEndMs`, the moment the person actually finished. Endpointing
before it is a **false cut**. The live loop and the replay run the same `TurnDetector` —
a corpus that tested a copy of the logic would be worse than none.

**The two error types are not symmetric**, and the metric follows that:

- A false cut talks over someone mid-thought. Silent, and worst for the person having the
  hardest week — exactly who we cannot afford to fail.
- Lateness is dead air. Cheap, and reads as thoughtful.

So the gate is **zero false cuts first, and only then trade lateness down**. Not accuracy,
which would average the two and hide the one that matters.

**2. The false-cut estimator, on every real call.** We cannot know someone had more to
say, but we can see its shape: we ended their turn, the agent began, and they carried
straight on. Resumption within 1.5s of an endpoint, excluding backchannels, plus any
correction phrase. Conservative by design — a missed cut is better than a phantom, since
a phantom pushes us to wait longer for nothing. This is what makes every call a test
rather than every test a call.

**3. Real calls with people who do not know the script.** Five or six is enough to find
what n=1 cannot. Nothing before this produces evidence about human timing.

### What the harness found immediately

Two real bugs on its first run, both in the cases that matter most:

- `"I did the run on"` scored as a finished sentence — the trailing-word set had
  conjunctions but no prepositions. Now it has both.
- The fragmented disclosure was cut at 6.9s. `"I've been finding it hard"` is a complete
  clause; no lexical rule can tell it is the middle of a disclosure. Fixed with
  **within-turn pause memory**: someone who has already paused and resumed once in this
  turn is speaking in fragments, and the next gap gets at least a multiple of the longest
  one already seen, capped so a single long pause cannot make the rest glacial.

### The honest state of it

| Sensitivity | False cuts | Median lateness |
|---|---|---|
| 0 | 0 / 8 | 5980 ms |
| **0.25 (shipping)** | **0 / 8** | **4980 ms** |
| 0.5 | 2 / 8 | 3980 ms |
| 1.0 | 6 / 8 | 500 ms |

Two things to take from it. The safe band is narrow — safety runs out between 0.25 and
0.5 — and the price of safety is high: several seconds of dead air on fragmented turns.
That is too blunt to be the final model, and it says the next improvement is a better
signal rather than a different threshold.

And a caveat that matters: **these fixtures are written, not measured.** They encode
assumptions about how people pause. They are a real regression gate against cutting
people off; they are not evidence about human timing. The corpus only becomes evidence
when traces from real calls replace the invented ones — which is why the stress test
saves its timing trace.

---

## Open risk — the +47 number may not be buyable as specified

Number search on Twilio returned nothing for Norway or Portugal. The immediate cause is
almost certainly eligibility rather than stock: both countries require an approved
regulatory bundle (local address and identity documents) before their numbers appear at
all, and an unapproved account sees an empty list rather than a locked one.

That is a delay, not a problem. **This is the problem:** the caller-identity decision
rests on one fixed +47 **mobile** number — eight digits starting 4 or 9 — carrying both
voice and SMS. Norwegian mobile ranges are generally not sold self-service by carriers'
API providers; what tends to be purchasable is a geographic (landline) +47, and Norwegian
landline numbers typically cannot send SMS.

If that holds, two locked decisions break together:

- "One fixed +47 number for every call and every SMS, never rotated."
- The missed-call flow, which depends entirely on the user being able to reply by text —
  the reason alphanumeric sender IDs were rejected in the first place.

The fallback shapes, none of them free:

| Option | Cost |
|---|---|
| Two numbers — a +47 for voice, a separate SMS-capable one | Breaks the single-trust-signal argument that made the vCard work |
| A Norwegian mobile via a reseller or an operator agreement rather than self-service | Slower, contractual, probably requires a Norwegian entity |
| Voice on +47, missed-call follow-up by email instead of SMS | Much weaker recovery: email is not read in the fifteen minutes that matter |

**To settle it:** search Norway with SMS and Voice both selected, across every number
type, once the regulatory bundle is approved. Cheap to check, expensive to discover at
Milestone 4. Nothing else should be built on the one-number assumption until it is
confirmed.

### Evidence, 2026-09-03 — no longer just a suspicion

A Swedish mobile number bought on Twilio reports **"Voice: capability not supported"**.
It sends SMS and cannot place a call at all.

That is the same shape as the risk above, observed rather than predicted: on this
platform a Nordic *mobile* number is an SMS product, and voice lives on geographic or
toll-free numbers instead. If Norway behaves like Sweden, the plan of one +47 mobile
carrying both voice and SMS does not exist to be bought.

It also means capabilities must be checked per number before purchase, and that a number
appearing in search says nothing about what it can do. The eventual production number has
to be verified for **voice and SMS together** before it is committed to — the vCard, the
verification SMS and the missed-call flow all assume one number does both.

**Unrelated to the product:** Portugal is not a market here. A Portuguese number is worth
nothing to 8&80 and should not hold up the first call.

---

## Sizing — the server was never the constraint

Measured, not estimated: one **call-hour** of audio through the full loop — mu-law
decode, energy detection, turn detection, base64 both directions — costs **487 ms of
CPU**, or 135 microseconds per call-second. One vCPU could carry thousands of concurrent
calls of that work. Real ceilings arrive first from TLS, socket syscalls and per-frame
JSON parsing, which that measurement excludes, but they are an order of magnitude away.

This is a consequence of the PCMU passthrough decision: no transcoding, and no inference
on our box. Had we chosen a stack that needed either, sizing would look completely
different.

**So VPS tier is chosen for what shares the box — Postgres, the web app, the voice
service — not for call volume.** 4 GB rather than 1 GB is about the database, not the
calls. A larger tier buys nothing at v0 scale.

**What actually meters call hours is per-minute vendor spend**: telephony to a Norwegian
mobile, plus the voice model. One user on a weekly 15-minute call is about one call-hour
a month, so a hundred free users is roughly a hundred call-hours a month.

`FREE_CAPACITY_LIMIT` therefore derives from those two rates and an appetite for
spending, never from server capacity. The cap exists because minutes cost money. Both
rates are still open, and no number should be guessed for either.

---

## Open — needs a decision or a number

- **Norwegian (+47) mobile termination rates, Telnyx vs Twilio.** The one input in the
  cost model still running on US reference prices. Pulled when the telephony adapter is
  built.
- **Zero-retention / no-training settings with every AI vendor.** To be turned on
  explicitly per vendor and recorded here with the date and where it was set. Not yet
  done — no vendor account is wired up.
- **Deploi:** DPA, encryption at rest, backup policy. Two emails, Eirik's to send.

---

## Standing note — fleet learning by locale

As new markets open, the fleet layer should be able to show aggregate differences by
locale: median pause length, correction rates, which script turns underperform. That is
market research and it is worth having.

It is aggregate only. It must never become per-user profiling, it segments by locale and
by nothing else, and locale is a field the user fills in — never something we detect from
a voice, a name, or an accent. Fleet defaults also never silently override an individual's
own measured behaviour once we have enough calls to know it.

## First live call — 2026-09-05

The call connected, the mentor spoke, and it was heard. Three findings worth keeping,
because each one cost a call to learn:

- **The agent must be told to speak first.** A speech-to-speech session with provider
  turn-taking disabled produces nothing until an explicit `response.create`. Our loop only
  sent one after detecting the end of a caller turn, so the line was silent while the
  caller said hello into it. Every silent test call was this, not the model, the key, the
  tunnel or the carrier.
- **Ready means configured, not connected.** `session.created` arrives before our
  instructions are applied. Greeting there would open the call as a generic assistant, in
  a voice that is not the product.
- **A silent call has two causes that feel identical on the phone**, so the stress run now
  plays 600ms of tone it generates itself before the mentor speaks. Heard means the
  telephony leg works and the fault is the model's audio; not heard means the model is
  irrelevant and the fault is downstream of us. One question, and the diagnosis is decided
  rather than guessed.

First reaction to the voice, unprompted: *"made me feel like I was talking to a call
centre."* Naturalness 4, latency 4. That is the whole problem restated — the mechanics are
fine and the delivery is wrong. Recorded here because it is the thing to beat, and because
a later run scoring 4 on naturalness with the same complaint is not progress.

## The mentor's voice is the caller's choice — 2026-09-05

`eve` for callers who want a woman's voice, `rex` for a man's. Not a global setting: the
preference lives on the caller profile and the names live in config
(`XAI_VOICE_FEMALE` / `XAI_VOICE_MALE`), so changing provider or changing our minds is
config, and a caller who has expressed no preference gets a fallback rather than a
decision made for them.

Two things this does not yet settle:

- **The names are unverified.** The server does not echo a voice field and does not reject
  a name that cannot exist, so nothing so far proves `rex` is a different person from
  `eve` — or that either name does anything at all. `npm run audition` records each one
  saying the opening line; if they are the same voice, this decision is decoration and the
  whole question moves to the provider.
- **Nobody is asked yet.** There is no signup, so no caller can express this. Until the
  web app exists the field is set by hand, and the default is doing the choosing — which
  is exactly the thing this structure exists to make visible rather than permanent.

## Patience is asymmetric — 2026-09-05, after the first full stress call

Scores: naturalness 4, latency 3, interruptions 3, pauses 3. Two complaints, and they
looked contradictory: *"it interrupted my five-second pause"* and *"the time it took to
reply when it was clearly its turn was too long"*. Median endpoint wait: **3311ms** —
not a distribution, the same budget almost every turn.

One number cannot serve both. A finished sentence and a sentence that trails off need
opposite treatment, and a single `baseSilenceMs` with `Math.max` rules layered on top
collapses toward the most patient branch. So the budget is now chosen, not accumulated:

| What we heard | Wait at 0.25 |
|---|---|
| A finished sentence | **913ms** |
| One- or two-word answer | 3700ms |
| Trailed off mid-clause | 5000ms |
| Asked, nothing said yet | 5875ms |
| No transcript available | 1625ms |

Hard turns multiply by 1.6, and the within-turn fragmentation memory still overrides
everything. Measured against the corpus: an ordinary answer is now answered in 900ms
where it used to take 2000+; the fragmented disclosure is held for 8 seconds.

Two things this cost, both caught by the corpus within seconds:

- Trimming the fragmentation memory once a clause reads finished cut off
  `quiet-disclosure-fragmented` — because *"I've been finding it hard"* IS a finished
  clause, and it is the middle of a disclosure, not the end of one. The trim now never
  applies on a hard turn. This is the second time that same sentence has caught a
  regression; it has earned its place.
- The monotonicity test was measuring the budget of whichever pause the turn ended on,
  which is not comparable across settings. It now measures when the decision was made —
  what the caller actually experiences.

**And the open question the run did not answer.** If no transcript of the caller ever
arrives, every lexical rule here is blind, and the old code silently defaulted the whole
call to its most patient branch — which is exactly what a 3311ms median looks like. The
endpointer now knows whether it can read words, uses one honest middling number when it
cannot, and the stress run says so in capitals. The next run's `why it waited` breakdown
settles whether that call was tuning or blindness.

## Second full call — 2026-09-06

The voice came back (the silent run before it was a stale checkout, not a regression —
the same build then produced audio end to end). Naturalness 4, latency 4, would want it
weekly: yes. Three findings, in the order they matter:

- **It asked a question and talked past it.** The opening greeting, the framing and the
  first question arrived in one 11-second breath, and it moved on before there was time
  to think. The prompt listed the stages as a numbered sequence and the model read the
  sequence as a speech. Now stated outright: the stages are separate turns, and anything
  with a question mark ends the turn.
- **Still no transcript, and now we know the provider hears us anyway** — it emits
  `input_audio_buffer.speech_started`/`stopped` around the caller's speech while
  returning no transcription at all. So the endpointer is running blind on every call,
  and `blind-no-transcript` was the only reason in the whole run. The pre-GA field name
  is now sent alongside the GA one; that is the same fix that made the audio format work.
  If it still returns nothing, this stops being config: either we run our own ASR beside
  the voice session, or the provider cannot support the design.
- **A soft noise layer under the voice.** Could be their mu-law encoder rather than the
  model. `XAI_OUTPUT_FORMAT=pcm16` now asks for 24 kHz PCM and converts to the phone's
  mu-law here, which is a direct A/B — and both versions are saved as .wav, so it is
  decided by listening rather than by argument.

## Third full call — 2026-09-06. The transcript arrived, and showed three bugs

`voice.transcripts: user 76`. The pre-GA field name worked; the GA one alone had produced
nothing. That single change turned every remaining fault visible at once, and all three
were ours:

- **Every turn read "nothing said yet".** Transcription arrives as increments, and the
  provider finalises an utterance whenever its own voice activity says so — many times
  per turn. We overwrote the words with each fragment and cleared them on each
  finalisation, so at the moment a budget was computed there were no words to read.
  Result: 5875ms on all five turns. The caller scored latency 1 and said it did not seem
  interested. It was waiting six seconds after every sentence because it believed nothing
  had been said. Words now accumulate for the whole turn and are cleared only when we end
  one.
- **The agent was believed to be speaking for the entire call.** This server sends
  `response.done` but no `response.audio.done`, so nothing ever cleared the speaking flag.
  Every word the caller said was scored as talking over it: five barge-ins, five cancels.
- **Five cancels of nothing.** Each barge-in cancelled a response that had already
  finished, and the server answered "Cancellation failed: no active response found" —
  which read like a call fault and was only a stale belief. Cancel now requires a response
  in flight.

The three compound: the cancels cut off the agent's own turns, which is why a caller who
was never interrupted still felt unheard and got no questions back.

Worth keeping in view: every one of these was invisible until the transcript arrived, and
each looked like a quality problem in the model. Two rounds of scores were spent on a
system that could not hear.

## The line's noise is measured, not assumed — 2026-09-06

A caller testing from a café raised the question, and the answer was worse than expected:
speech detection used one fixed energy threshold, chosen for a quiet room. Background
noise in a café, a car, or a street sits above it, so the detector hears continuous speech,
never finds a silence, and **the turn never ends**. The most patient endpointer in the
world cannot rescue a call where the line is never quiet — and the people most likely to
take this call in a noisy place are the ones with the least controllable weeks.

The floor is now the quietest recent energy on the line, and speech is what rises clearly
above it. Two edges, both found by testing rather than by reasoning:

- Frames at unmistakable speech level never enter the floor's history. Otherwise someone
  talking without a gap becomes their own noise floor and the line goes deaf exactly while
  they are speaking most.
- The floor can never lower the bar below the configured threshold. On a silent line a
  breath must not become a turn.

Each run now reports the measured noise, so "it interrupted me" from a café and from a
kitchen table are no longer the same data point.

## The intermittent silent call is the carrier's, not ours — 2026-09-06

Settled by listening rather than reasoning. On a call where the caller heard nothing, the
recording of what we handed to Twilio contains 4.94 seconds of clear speech. Our audio
path, the model, the format and the tunnel were all fine; the carrier did not play it.

The second half of the evidence is stronger: on that same call the measured line noise was
0.000 — not one frame of the caller's own audio arrived either. A stream that carries
nothing in either direction, while the websocket stays healthy, is a carrier-side failure
wearing the costume of an audio bug. Roughly one call in two.

Two things this cost, and both are now closed:

- Twilio media events we did not handle were dropped silently, including `error`, which is
  where a stream failure states its reason. They are named in the log now.
- Nothing counted inbound frames, so "no audio from the caller" and "the caller said
  nothing" looked identical. They are separate lines now.

Standing rule this suggests: every leg of the path reports what it carried. Three calls
were spent bisecting a silence that either leg could have named in one.

## The silent calls: what the carrier's own log ruled out — 2026-09-06

Twilio's debugger shows the same single warning on all four calls — a missing AMD status
callback, which is harmless and identical on the two that worked and the two that did not.
No stream errors, no 31900-series codes, every call "Completed". The carrier believes
nothing went wrong on any of them.

Combined with what we already knew — good audio recorded on our side, zero inbound frames,
a healthy websocket — that leaves the path between us and the carrier, which is currently
a free ngrok tunnel. Two changes, in order of confidence:

- **Outbound audio is paced at the speed it is heard.** The model returns a whole
  utterance at once, so forty seconds of speech became two thousand websocket messages
  inside a few milliseconds. Twilio buffers that; a free tunnel is under no obligation to.
  Pacing is also what makes an interrupt mean anything: audio still in our queue has not
  been sent, so dropping it actually stops the voice rather than only stopping the model.
- **`TUNNEL=cloudflared` swaps the tunnel for one run**, ignoring the configured hostname.
  A tunnel that connects is not the same as a tunnel that carries a call, and until it can
  be swapped in one command it can be suspected but never ruled out.

Still unproven, and it must stay that way until a run of calls says otherwise: the failure
is intermittent, so two good calls prove nothing. What would settle it is several calls on
cloudflared with no silence, or one silent call on cloudflared — which would clear ngrok
and put it back on us.

## Pacing split the call in two — 2026-09-06

Pacing outbound audio fixed the intermittent silence (fifteen turns, no dead stream) and
broke the conversation, which is a fair trade only because the second problem is the more
interesting one.

Scores fell: naturalness 2, latency 1, pauses 1, would want it weekly: no. The caller's
words: *"when it started speaking, but I was not done, it completed its whole phrase
without being bothered by me"*, and *"the line felt scattered"*. Two causes, both mine:

- **The model finishes generating long before the caller finishes hearing.** A thirty
  second answer is produced in about two seconds and then plays for thirty. Every piece of
  logic asking "is the agent speaking?" was asking the model, which had said yes and then
  no while the caller still had half a minute of audio to come. So a caller talking over
  the agent was recorded as talking to silence, and the barge-in never fired: bargeIns 0
  in a call where he deliberately interrupted. The question is now asked of the playback
  queue — `pendingMs()` — because that is what the caller is actually in.
- **Counting timer ticks drifts.** A 20ms interval fires at 21 or 22, so each frame went
  out slightly late and the error accumulated across a forty-second utterance. Pacing now
  follows the wall clock and sends everything due, which is the difference between speech
  and scattered speech.

Kept as a standing lesson: the moment audio is buffered anywhere, generation time and
listening time are different clocks, and every judgement about turn-taking belongs to the
second one.

## First "yes" — 2026-09-06

Interruption 5/5, pauses 4/5, would want it weekly: **yes**. The mechanics are close
enough that what is left is the conversation. Three things from the same call:

- **A five-second pause was answered at five seconds.** The trailing budget was exactly
  5000ms — the right rule landing precisely on the line it was drawn for. A budget equal
  to the pause it exists to survive is not a budget; it is now 5800.
- **It stopped answering entirely for the last two steps.** Two causes found, both silent:
  our commit can land on a buffer the provider's own voice activity already committed,
  which is an error that produces no response at all; and a `response.create` that never
  becomes a response looks like nothing in the log and like abandonment on the phone. We
  now commit only what we actually appended, and ask a second time before concluding the
  session has stopped answering.
- **Backchannels are still zero.** Either the "mhm" step was skipped or it is still being
  missed. Unresolved, and the next run should do that step deliberately.

## Backchannels are judged by duration, not by words — 2026-09-06

The "mhm" step passed by ear and read 0 in the metrics on every call. The behaviour was
right and the measurement was wrong, which is the worse of the two to leave alone: a
number that says zero when the thing happened teaches the wrong lesson for weeks.

The classification was lexical — is this word in the backchannel set — and transcription
arrives a second or two behind. At the moment a 300ms "mhm" has to be judged there is
usually no text for it at all. It is now judged by what is actually knowable at that
instant: a burst shorter than the backchannel window, made while the caller could still
hear us. Words remain the finer test where they exist; duration is the one that is there
in time.

It also stops a stray sound from being answered as though it were a turn — the same
mistake, made audible.

## Turn-taking is done. What is left is the words — 2026-09-06

Latency 5, interruption 5, pauses 5, naturalness 4. Median wait 922ms; the five-second
pause held at 5815ms; the backchannel counted; the barge-in landed. Eighteen turns, no
silence, no drift (`pendingMs` zero at every turn end). The mechanical problem this
project has spent two days on is finished, and the remaining score — *"yes if it becomes
more confident"* — is entirely about what the mentor says.

Three findings from that call, in the order they cost the caller something:

- **"I answered yes, and then it went silent."** My own regression, an hour old. The
  duration rule for backchannels swallowed a genuine one-word answer given while the tail
  of our audio was still playing. A short sound with seconds of our speech still to come
  is listening; the same sound over the last half second of a question is an answer to it.
  Gated on that now — and a backchannel that is followed by silence from both sides is
  re-read as a turn after 2.5 seconds, because nothing about this call may end in silence
  waiting for the other one to speak.
- **It said "a person would probably be better at this than I am" three times**, in
  response to avoidance, poor sleep, and a tangent about a car. The §10 instruction was
  written for danger and the model applied it to ordinary difficulty — which is most of
  what this call exists for. Serious now means danger, explicitly; the line may be said
  once in a call and never about a hard week. Repeating it is not care. It reads as
  flinching, and it leaves the caller managing the mentor's discomfort on top of their own.
  This is very probably the whole of "if it becomes more confident".
- **It opened as though it were the first call**, again, despite being told not to. The
  negative instruction was not enough, so it is now positive and exact: your first
  sentence is this sentence.

## The call remembers now — 2026-09-06

Every call so far believed the same hardcoded sentence: *"last week you said you'd run
three times."* A second call that cannot quote the first is a demo, not the product, and
everything after this — the scheduler, the recap email, the third-week-running pattern —
depends on the week-to-week thread being real.

Three decisions inside it:

- **The commitment is taken from the read-back, not reconstructed.** SCRIPT.md pins it on
  purpose: *"Right. {{commitment}}, {{day}}. That's what I'll ask you about."* That line is
  the one moment in the call where the thing is stated plainly, in their words, by us.
  Reconstructing it from the caller's transcript would mean guessing which sentence in a
  paragraph of reasoning was the promise. If the read-back never happened, no commitment
  was reached and none is stored — next week must not open by quoting something they never
  said. A call that reaches no commitment also does not overwrite the last one: they are
  still on the hook for what they said the week before.
- **Nothing a caller said goes to disk without a key.** `DATA_ENCRYPTION_KEY` unset means
  the record is not written at all, rather than written in the clear — the failure mode
  should cost us a feature, not them a confidence. The number is hashed for the filename,
  so a directory listing is not a list of phone numbers.
- **It is a file store, and that is temporary.** Postgres and Drizzle remain the decision;
  what exists now is the `Store` interface with a file implementation behind it, because
  the Norwegian box is not reachable yet and week-to-week behaviour needed to be testable
  rather than hypothetical. Swapping in Drizzle is one file, not a change to the call loop.

Owed, and not yet done: the per-user data key wrapped by a master key in a secret manager.
What exists is a single service key, which is the honest version of what we have today and
a key-management change behind the same interface.



## The Speechify bake-off — 2026-09-12

0b was paused for an hour to test whether a platform that sells the whole voice agent —
Speechify Agents, $0.07/min — does the hard part better than we do. It took rather more
than an hour, and it was worth it.

**The scores, in the same eight-turn stress test:**

|                | Grok build | Speechify |
| -------------- | ---------- | --------- |
| Latency        | 5          | 5         |
| Interruption   | 5          | 5         |
| Pauses         | 5          | 5         |
| Naturalness    | 4          | 5         |
| Want it weekly | yes        | yes       |

**But that table is confounded and must not be read as a verdict.** Grok scored 4 on the
first prompt. Speechify scored 2 on that same prompt — it marched through the script and
answered a disclosure about dread and poor sleep with a perspective question — and reached
5 only on the third revision. What moved it from 2 to 5 was not the platform. It was a
rule that had never been written down anywhere: *respond to what they just said, and then
take it further; the stage list is the least important thing in this prompt.* That rule is
now in `prompt.ts` and the honest comparison has not been run yet.

Three findings that outlive the choice:

- **Turn-taking is table stakes now, and we did not know that.** Every mechanical axis —
  the three-second pause, the five-second pause, the one-word answer, barge-in, "mhm" —
  passed on their platform out of the box. That is the week of work that produced the
  endpointer, the noise floor, the playback-queue state and the pacing fix. It is worth
  knowing that this is purchasable, and worth noticing that it was purchasable before we
  built it.
- **The prompt is the asset, not the loop.** It is portable, it is the only part neither
  vendor supplied, and it is what actually moved the number. Three calls of tuning beat a
  week of audio engineering on the axis the caller can feel.
- **Their model obeys emphasis as law.** Grok treated a strong instruction as a strong
  hint. GPT-5.6 Terra — which is what Speechify runs underneath — took "most turns should
  contain no new question" absolutely and became a mirror, agreeing with everything and
  asking nothing. Prompts that work on one are not safe on the other, and they choose the
  model.

### What it does not change

**Their Memory stays off, permanently.** It would not reduce latency — within a call the
transcript is already in context, and cross-call memory resolves once at setup — so the
only thing it buys is a longitudinal record of someone's avoidance, sleep and dread
accumulating on a US platform. The commitment history is the one thing in this product
that compounds, and the one thing that makes a vendor unswappable if they hold it. It
lives in our Postgres, encrypted, and reaches the call as a dynamic variable.

**The DPA is the gate, and it is not about quality.** No Article 28 processing agreement
outside Enterprise means a second person's conversation cannot lawfully go on that
platform; consent under Article 6 is a separate requirement and does not substitute. Asked
in writing 2026-09-12, along with zero retention for transcripts and audio, EU-region
processing, and whether conversation data trains anything. Their SCCs are in place; the
rest is open.

**A silent call reported "Succeeded".** Conversation `conv_01m21by5nben2adjh1k10t2rh0`:
the agent spoke from 0:00, no audio reached the phone, the dashboard showed success and
raised nothing. A later call dropped words twice mid-sentence. On our own build the media
logs made the first silent call diagnosable in an afternoon. This does not improve with
more testing — it is what owning the loop buys, and what renting it costs.

So: run it on a single caller — ourselves — where the household exemption applies and no
DPA is needed, because the question that matters more than either platform is whether a
weekly call changes what someone does. Keep the Grok build warm. Keep the boundary clean
enough that the choice stays a one-adapter decision, and re-run the stress test on our own
stack now that the prompt that earned the 5 exists on both sides.

## Speechify is the voice layer, until it proves otherwise — 2026-09-12

Decided against my recommendation, which was to build on the Grok stack. The reasoning
against me is sound and is recorded here rather than in a chat log:

- **The buyer argument was wrong.** I argued a B2B purchaser would ask for a DPA and the
  absence would quietly lose deals. This is a B2C product. No procurement gate exists, so
  the argument does not apply. Withdrawn.
- **Special category data is accepted knowingly, by both sides.** The caller is told what
  this is and what happens to it. That is not a loophole; it is the actual basis the
  regulation asks for, and the person on the phone is the one whose call it is.
- **The remaining objections are conditional, not structural.** No DPA outside Enterprise
  and no alert on a silent call are both things Speechify may answer within days. Building
  three weeks of scheduler and store on a stack we might swap costs nothing, because none
  of that work touches the voice layer.

**The script changed the same day, and that is the non-negotiable half.** `open.first.disclosure`
now says the call runs through a service in the States and they see it too. A call whose
entire premise is *tell me the true thing* cannot open with an incomplete account of where
the true thing goes. The sentence comes out when the platform is ours, or when Speechify
confirms it retains nothing — not before, and not because it costs three seconds.

**What would send us back to our own stack:** a second silent call that reports success,
Speechify declining zero retention outright, or the stress run showing the naturalness gap
was the prompt all along. The first is the one I would watch. It is also now our job to
detect rather than theirs to report — a completed call with no caller turns in the
transcript is a failed call, and the scheduler treats it as one.
