# Implemented data, event and tool contracts

13 October 2026. Source of truth: `services/voice/src/beliefs/{model,protocol,repository,runtime,routes,billing}.ts`, shared store/outbox/access/legal modules, migrations 0023–0025. This is the application contract. It is not a verified Speechify tool-provisioning or wrapper schema.

## Durable records

| Record | Fields / responsibility | Privacy and lifetime |
| --- | --- | --- |
| Shared caller | Verified phone hash/encrypted phone, preferred name, optional encrypted contact email, existing weekly profile; `all_calls_stopped`, `sms_opt_out`, `held_for_review` | Existing identity/global controls; module never rewrites weekly memories/counter/trial/subscription |
| `belief_enrollments` | Owner hash; encrypted practice; revision; consent version/date; explicit timezone; daily minute, weekly weekday/minute; onboarding/next daily/next weekly; review origin; standing; provider/purchase/payment/customer IDs; paid date; amount minor units/currency | One enrollment per owner. IDs/financial metadata are not voice memory. No renewal/duration-expiry field |
| Occurrence continuation, migration 0025 | Nullable `daily_resume_at`, `weekly_resume_at` | The following usual occurrence of a moved call. Consume/clear when claiming; reset on changing usual schedule/completion. Not a second scheduler |
| Encrypted `Practice`, schema 1 | `revision`, caller outcome, understood, cap 2/3; onboarding/active/paused/completed state; ordered belief array; applied event IDs; optional event digests and programme contact preferences | Canonical personal content under owner lock. Digests reject altered retries, including reserved object-property IDs; legacy event IDs without digests fail closed rather than invent an old payload |
| Belief item | Server UUID, version, caller belief/trigger; queued/preparing/active/retired; own decision, dated experiences, balance, opportunity, confirmation, reviews | IDs are supplied by server; no client/agent fabrication. Old schema-1 records may omit optional version history |
| Decision history | Optional archived versions with prior wording, evidence, balance, opportunity and reviews | Stored inside encrypted aggregate when decision wording changes/reactivation occurs. No reconstruction of material older code discarded |
| Review | Server period integer, own integer score 0–10, date, confirmed fuller reflection | One increasing period per item/version; two consecutive low periods retire. Missing periods are not zero |
| `belief_sessions` + shared `call_attempts` | Session ID is attempt ID; owner/kind/period; encrypted initial/provisional practice and receipt span; encrypted coverage; closed state/date; placement status/provider ID/timing/duration/safety metadata on shared attempt | Open session is scoped to claimed/placed call and at most 45 minutes. Closed snapshot retains revision, belief versions, start-eligible IDs, capture kinds, event IDs, `canonicalVerified` and coverage, not another copy of caller wording |
| Shared outbox / attempts | Unique logical event key, kind/channel/reference, encrypted recipient/payload, pending/sending/accepted/delivered/suppressed/uncertain/failed metadata | Pending messages have bounded expiry; transport acceptance does not mean delivery. Accepted/suppressed bodies are minimized; ordinary terminal metadata retained 30 days by shared dispatcher |

Whole-account export with fresh Beliefs proof includes decrypted retained module records, shared history, financial state and minimized sessions. Base export links exclude module content. Account deletion cascades module sessions/enrollment and existing shared records, and invokes base cancellation handling. Provider-owned transcripts, recordings, messages, billing records and backups have separate retention/erasure obligations; no local cascade is proof of provider deletion. Operating company must approve exact periods and verified provider removal workflow before live participants.

Customer exports retain safety delivery/review metadata, while omitting internal operator recipients and notification bodies. Credential redaction also handles tool arguments serialized as JSON strings; stored original encrypted deliveries are not modified by exporting.

Optional practice `contact` holds the programme's verified-signup name and support email. It is encrypted as part of the aggregate and excluded from all voice prompts/tool replies by `voicePractice`. Only its chosen name becomes `call_context.preferred_name`; the shared verified name is the fallback. Creating a new programme preserves an existing weekly profile. Existing enrollment is not overwritten by a repeated join.

## State transitions

| Trigger | Preconditions / confirmed input | Durable effect |
| --- | --- | --- |
| OTP verified join | Product-specific pending challenge, actual code/TTL/attempt limits; recorded adult/AI/service consent | Existing identity retained or new verified profile inserted; empty independent enrollment, scoped private link |
| Authoritative payment read | Signed provider event; correct owner/product/one-time baseline; current paid/refund/dispute state | Financial standing `active` or `payment_hold`; paid timestamp and amount/currency; one paid confirmation key |
| `outcome`, `queue` | Caller-written field or allowed onboarding voice command; queue closes after understood | Own outcome / ordered UUID belief; preparing reserves vacant slot without false activation |
| `reorder` | Onboarding only, before understood; all IDs exactly once; actual caller order and explicit agreement | Caller-confirmed order; filling follows that order |
| `prepare` | Selected preparing item or owned active edit; own decision, 1–20 real experiences, balance, opportunity, explicit confirmation; queued items wait for a vacancy and retired items require reactivation | Fully prepared item may fill its selected slot. Changed wording archives prior version, increments version, clears scores. Legacy queued preparation remains preparing until freshly confirmed when selected |
| `understood` | Voice onboarding only in production; confirmed outcome, at least two prepared active items, genuine backlog beyond cap | Understands practice; schedules next daily/weekly atomically and establishes original review origin; clears onboarding date |
| `practice` | Daily voice only; item active; caller speaks saved decision, evidence and balance; or explicit passed coverage | Adds dated evidence/current balance or records pass; coverage done versus passed. No score, preparation or discovery |
| `review` | Weekly voice only, item active at call start, not prepared/revised during this call; own score/reflection and agreement | Server period recorded once; two consecutive 0–1 retire, then selected backlog item awaits full preparation |
| Reactivate in private account | Owned retired item, unfinished programme, revision/CSRF guards | Archive prior version, new version/no score streak, return within cap/ordered fill. No new purchase; completed programme rejects |
| Pause / resume | Private owner form or confirmed pause voice command; completed programme rejects | Module state changes; financial entitlement unchanged. STOP/safety/payment remain placement vetoes |
| Usual schedule | Valid IANA zone, times/day, spacing, coverage, base collisions across zones; first/continuation date only before understood | Explicit recurring schedule and future pointers; reset occurrence overrides; preserve original review origin |
| Move/skip occurrence | Paid, not paused/completed/held/STOP; exact future timestamp, no in-flight call, supported kind; safe future time before following occurrence | Override/advance one pointer; usual cadence unchanged. Repeat stale timestamp cannot skip/move another occurrence |
| Claim / placement | Full live readiness plus staffed current window; eligible paid/consented state; under shared caller lock | Advance before placement; unique attempt/session. Late/overlap slots marked missed, one recovery notice. Unknown response is retained, never automatically redialled |
| Signed settlement | Existing signature verifier accepts callback; provider ID belongs to open session; actual caller turns and current revision/standing/holds valid | Canonical aggregate committed atomically; honest full/partial status, coverage, minimal closed snapshot and one notice |
| Complete | Every mapped belief retired | Clear all future module appointment/override pointers; private records retained; completion notice replaces ordinary review notice; no renewal/reopening |

The current period calculation is the nearest seven-day index relative to `review_origin`, clamped to zero. This origin is not reset by usual-time edits. A moved weekly occurrence uses its retained following regular slot minus seven days for its original index; browser/agent `week` input cannot change it. This is an implementation period, not a claim to follow ISO calendar weeks. DST shifts do not manufacture a full extra seven-day index. Pilot review must confirm this period definition is understandable.

## Application capture request

`POST /beliefs/tool`, JSON, bounded at 24,000 bytes. The server's scoped per-call HMAC token must be supplied through dynamic variables, never spoken or placed in an external link. The token is not a shared provider API key. Valid session must still be claimed/placed, open and within 45 minutes.

```json
{
  "session_id": "{{session_id}}",
  "session_token": "{{session_token}}",
  "event_id": "stable-logical-save-id",
  "caller_text": "actual consecutive caller turns, including the latest confirmation",
  "command": { "type": "understood", "confirmed": true }
}
```

For caller-utterance safety checks omit command/event. `caller_text` is nonempty and at most 16,000 characters. With command, stable event ID is nonempty and at most 100 characters. Fields are caller-owned nonempty wording, normally at most 2,000 characters. No agent summaries, missing intervening turns, fabricated evidence or truncated spans. Supported OpenAPI payload is [capture-tool.openapi.json](capture-tool.openapi.json); semantic call-kind/ownership/authorship guards execute in TypeScript, not the agent.

| Command | Kind / fields |
| --- | --- |
| outcome | Onboarding: `outcome` |
| queue | Onboarding: `belief`, `trigger` |
| reorder | Onboarding before understood: all `ids`, `confirmed:true`; caller words establish that order |
| prepare | Onboarding/weekly: owned `id`, `decision`, array `evidence`, `balance`, `opportunity`, `confirmed:true` |
| understood | Onboarding: `confirmed:true` and complete canonical prerequisites |
| practice | Daily: active `id`, evidence string and balance string, decision actually spoken; or `passed:true` |
| review | Weekly: start-active `id`, integer `score`, `reflection`, `confirmed:true`; server supplies period |
| pause | All call kinds: `confirmed:true`, explicit pause/stop wording |

`reactivate`, `resume`, browser schedule changes, financial actions and new weekly discovery are not voice commands. Stable retries return existing result; changed receipts/payload digests conflict. IDs returned from provisional practice must be reused. Commands from daily agents cannot prepare or review.

15 October recovery: an unresolved English/Norwegian numeric range (for example “one or two”) cannot supply a scalar review score. A later explicit choice or fresh short numeric answer can clarify it within the same consecutive caller span; a negated choice does not. Invalid or unresolved scores are rejected before staging and cannot manufacture retirement. This deterministic wording guard has language limits; ambiguous conversation still needs clarification, not model inference.

Response: `{held:false}` for a successful utterance check; `{held:true,instruction:...}` for immediate/shared hold; or `{practice,coverage,provisional:true,instruction:...}` for a staged command. HTTP 401 means invalid scoped credential; 409 means rejected/closed/stale input or service unavailable; 413 means oversized body. Successful provisional response is not canonical save status.

Signed settlement considers **only caller turns**, in chronological order. Each confirmed receipt must match a whole consecutive caller-turn span whose last turn contains explicit agreement and no recognized disagreement. Agent speech cannot supply evidence. This deterministic guard does not understand every ambiguous natural-language statement; unclear wording needs clarification and real provider-schema testing. Concurrency revision mismatch preserves the browser edit. Safety flags are committed promptly even if later capture/settlement cannot save personal content.

## Prompt and provider boundary

Exactly four declared variables currently: `belief_context`, `call_kind`, `session_id`, `session_token`. `belief_context` contains encrypted-store practice rendered only for this call and a server `call_context` with preferred name from the shared verified identity (no weekly memories), review period and period-3 `first_month_review`. It is untrusted data, not instructions. Fixed role greetings are in `agent/prompt-pack.ts`; source packs are the three Markdown scripts.

Preferred programme name takes priority over that shared-name fallback. Human-support contact metadata is excluded from this DTO. Numeric score aliases include English and Norwegian `ett`/`syv`; short agreements include common English/Norwegian replies without requiring a long recital. Recognized qualified disagreement remains rejected at signed reconciliation. These finite language guards do not replace checking the actual conversation or asking for clarification.

Placement uses existing Speechify outbound endpoint, per-attempt idempotency key and dynamic variables. Stored AMD/memory/recording/settings checks are separate from audio behaviour. Public documentation now exposes a generic create/attach-tool API with an opaque config object, but exact webhook configuration, variable substitution, signature/wrapper shape and real callback turns remain unverified in this continuation. Do not construct unverified provider writes from the application OpenAPI file. [Speechify setup boundary](../speechify-api-sync.md) records historical settings evidence.

## Evidence and measurement contract

Coverage records complete versus passed; attempt status/duration records actual delivery progression, not assumed benefit. Start-eligible IDs supply denominators; capture kinds identify preparation versus review; `canonicalVerified` distinguishes signed saves from staged/unverified content. Older minimized snapshots lacking these fields remain unknown rather than being backfilled with invented evidence. A weekly appointment used solely to resume preparation has no eligible score denominator and is not full score coverage; its verified partial preparation remains useful and private. The next-call card excludes daily appointments when no prepared active decision exists. Reviews contain caller-selected scores/reflections; day-28 usefulness/burden can be included in confirmed reflection, with no separately structured survey metric. Provider invoices/call-cost export and staffed operator records are required for economics/response workload. Pilot reporting must count missed/held/paused states and programme completion separately from unwanted abandonment, with no personal wording in shared dashboards. Agree targets before interpreting those reports.
