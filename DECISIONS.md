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

**B is the default; C is the adaptive target.** A user whose commitments repeatedly come
back undone is over-promising, and switching them to the prediction framing is a
per-user adaptation the learning loop can make from data we already collect. First
concrete instance of the profile changing the script rather than only the endpointing.

**`nothing.c` — the bare "Mm." — is the stress-test default.** It is the variant that
fails hardest when endpointing is wrong, which is precisely why it runs during the test.
A chattier variant would paper over a turn-detection problem and we would ship it.

**`close.q.b` stays, with auto-suppression** on any call that touched a serious
disclosure. Confirmed.

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
