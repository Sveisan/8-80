# ARCHITECTURE

Intent, not yet implementation. No code exists at the time of writing; this is the shape
the build follows and the reasoning behind the parts that would be expensive to reverse.

---

## Two services, and why it is not one

**`web`** — Next.js, App Router. Signup, phone verification, onboarding, scheduling,
billing, settings, recaps. Request/response, deployable anywhere, no long-lived state.

**`voice`** — a separate long-running Node service. It holds one websocket per active
call for ten to fifteen minutes, bridging telephony audio and the speech-to-speech model,
running the turn loop, the in-call context buffer, and the timers.

This split is a constraint, not a preference. Serverless functions cannot hold a
websocket open for the length of a call — there is no execution model where that works —
so the voice loop is a process that stays up. Everything else can be ordinary web
infrastructure.

They share Postgres and nothing else. The web app never touches the audio path; the voice
service never renders a page.

## The network path, and the one rule about it

```
browser ──▶ Cloudflare (DNS, TLS, WAF, DDoS) ──▶ web        (Next.js, Deploi VPS, Norway)

carrier ──▶ Telnyx ──▶ voice.<domain>  ──▶ voice      (Node, same VPS)
                        DNS-only, own TLS      │
                        NOT proxied            └──▶ Grok Voice (speech-to-speech)
```

**The voice websocket must not pass through Cloudflare's proxy.** Its own subdomain, DNS
in grey-cloud/DNS-only mode, its own certificate. Proxying real-time audio adds latency
to every turn and drops long-held connections. This is the single easiest thing to break
by accident — turning the orange cloud on for that record looks like a security
improvement and silently degrades the product.

## Three adapters, one rule each

Everything a vendor could change sits behind an interface, and nothing above the
interface may know which vendor is beneath it.

| Adapter | First implementation | Fallback | The rule |
|---|---|---|---|
| Telephony | Telnyx | Twilio, documented and kept working | No provider webhook shape reaches the call loop |
| Voice | Grok Voice Think Fast 2.0 | `gpt-realtime-2.1` (OpenAI Realtime-compatible) | No Grok-specific behaviour in the turn loop |
| Model | Fast model in-call, larger model post-call | Either swappable independently | Both behind one model-agnostic interface |

The voice adapter matters most. Grok was chosen without a bake-off against the model that
leads on conversational dynamics, so the ability to switch is the insurance that makes
that choice reversible. Everything Grok-shaped — event names, audio framing, session
config — stops at the adapter boundary.

## The call, end to end

1. Scheduler fires at the user's slot. Never outside their chosen window.
2. Telephony adapter places the call from the fixed +47 number. Rings ~25 seconds.
3. No answer → hang up, **never** voicemail, one warm SMS, missed-call flow.
4. Answer → voice service opens the model session with a cached system prompt built from
   the user's profile, last week's commitment, and their communication preferences.
5. Turn loop. Audio is bridged in memory. Context-aware turn detection, never silence
   timing alone. Every turn logs endpoint latency and any barge-in.
6. In-call learning: a detected failure appends a correction note to a live buffer that
   is included in every subsequent turn of this call.
7. Hang up. Audio is discarded and never written to disk.
8. Post-call: larger model produces the summary, the read, and next week's cached context
   block. Transcript and summary are encrypted before they reach Postgres. Safety
   flagging runs here. Recap email goes out. Next call is scheduled.

## Where the encryption boundary is

Application-layer, before Postgres, for transcripts and summaries. Per-user data key,
wrapped by a master key held in a secret manager — never in the database, never in the
repository. Disk encryption alone does not protect against a compromised application or
an over-broad query, which are the realistic failures.

Audio is never persisted by default. It exists in process memory for the duration of a
turn and is gone.

Decrypting a transcript to review a safety flag is the most sensitive action in the
system and is logged with who, when, and why.

## Caller identity and numbering

**Resolved, and narrower than the original brief assumed.**

There is no branded caller ID for PSTN voice. Caller ID for a voice call carries a number
and nothing else, and Norway has no CNAM-style name lookup for a carrier to resolve that
number into a name. The product name can never appear on a Norwegian handset from the
carrier side. Not by paying more, not by a different provider.

Alphanumeric sender IDs do exist for SMS in Norway — eleven characters, pre-registration
required — and are rejected here, because they are one-way. A user cannot reply to an
alphanumeric sender, and the missed-call flow depends entirely on the user being able to
reply. Trading the reply path for a name on an SMS would break the most important
recovery moment in the product.

**Therefore: one fixed +47 mobile number, used for every call and every SMS, never
rotated.** One number, both channels, permanently.

### Provisioning constraints

Norwegian mobile numbers are eight digits, and mobile ranges start with **4** or **9**.
E.164 is `+47` plus those eight digits.

When provisioning, search Telnyx `+47` inventory for numbers containing **0880** or
**8080**. The shapes wanted, best first:

| Wanted | E.164 | Notes |
|---|---|---|
| 900 08 800 | `+4790008800` | 9-range mobile, contains 0880 |
| 400 08 800 | `+4740008800` | 4-range mobile, contains 0880 |

**Avoid the 800, 815 and 820 prefixes entirely.** They are Norwegian service-number
ranges and they read as telemarketing to a Norwegian recipient — the precise association
this product cannot afford on an unknown incoming number. They are also not mobile
ranges, so they fail the 4-or-9 rule anyway; the point is that they must not be reached
for even when a memorable pattern is available in them.

### The vCard is the only branding channel

Since the carrier will never show the name, the only way it reaches the screen is the
user's own address book. That makes the onboarding vCard a primary feature rather than a
convenience, and it needs building properly (Milestone 2):

- Served as `text/vcard`, `.vcf`, with `Content-Disposition: attachment`.
- **vCard 3.0**, not 4.0 — broadest handling across iOS and older Android.
- `FN` and `ORG` from configured, externalised display-name content. Never a hardcoded
  string, and never English-only.
- `TEL` in full E.164, exactly matching the caller ID we present. Contact matching is a
  string match on the handset — if the stored number and the presented number differ in
  format, the name does not appear and the whole mechanism silently fails. This is the
  detail to test on a real device, not to assume.
- Embedded `PHOTO` (base64) so something renders on the call screen.
- One tap, from the onboarding page and from the verification SMS.
- Shown during onboarding with a warm one-line ask, not a chore.
- The SMS verification message states the number they will be called from, so the first
  ring is never from a number they have not already seen.

## Language

English at launch; nothing assumes it. All agent-facing text lives as keyed content
(see SCRIPT.md), language is a per-user field from day one, and adding Norwegian is a
values file plus a model session parameter — no change to the voice loop.

## Not yet decided

- Post-call model vendor.
- Transactional email vendor for recaps.
- Secret manager for the encryption master key.
- Norwegian +47 mobile termination rates, Telnyx vs Twilio — the last input in the cost
  model still running on US reference prices.
