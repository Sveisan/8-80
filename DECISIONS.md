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
