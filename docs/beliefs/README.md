# 8&80 Beliefs

Implemented locally on an isolated branch, `codex/belief-module`, based on `57910c6`. The weekly 8&80 checkout, account and caller memory retain their existing semantics. This is a reviewable implementation with live enrollment/calls disabled by default; it is not a claim of validated outcomes or a production release.

## Product decision

**Build the confidence to act on what matters to you.**

One independent, opt-in **one-time purchase**, priced at the same amount and currency as one monthly payment for weekly 8&80. No subscription, renewal, taper or bundled base membership. The purchase covers the beliefs mapped during this enrollment. Discovery closes after onboarding; completion stops calls and keeps the decisions available privately. Pausing does not incur a renewal or expire the purchase.

The base paid amount is not present in checked-in configuration. Do not invent an amount or copy credentials into chat. The payment adapter retrieves the provider's base monthly price and verifies that the module is a distinct non-recurring product with the same amount and currency. Tax presentation, receipts, refunds and withdrawal terms need provider test-mode and operating-company review.

## The connection to 8&80

| Shared | Independent |
| --- | --- |
| Brand, verified phone/account identity, encrypted storage, provider webhook verification, message outbox, human safety review, full account export/deletion | Consent, one-time purchase, outcome, ordered belief backlog, decision versions, evidence, daily/weekly schedules, pause, review scores and completion |
| Global carrier STOP and human safety holds apply to every product | A base subscription cancellation or base weekly pause does not revoke this programme |
| The base account can link to the module; module footer links to weekly 8&80 | Beliefs can be bought without a base slot, base trial or base subscription |

No module callback increments the weekly call count, rewrites singular base belief/commitment/goals or extends a base trial. A short-lived, phone-verified Beliefs credential opens personal decisions; base browser, reschedule and feedback links cannot expose them. Older weekly export links exclude private Beliefs history and direct the owner to fresh verification. The Beliefs account download includes the complete record for both products.

## Journey, navigation and sendouts

| Moment | Screen / call | Application sendout |
| --- | --- | --- |
| Discovery | `/beliefs`: outcome, rhythm, AI disclosure, separate one-time price | None |
| Join | `/beliefs/join`: preferred name, optional contact email, editable +47, explicit adult/AI/service consent | One phone verification code; rate-limited, expires in ten minutes |
| Return | `/beliefs/access`: fresh phone verification; unknown account response is uniform | Code only to an existing account |
| Verify | `/beliefs/verify`: one-use challenge; establishes a scoped private cookie, one-hour expiry | None |
| Choose times | `/beliefs/schedule`: Oslo default, explicit IANA timezone, first conversation, daily time, weekly day/time | Account confirmation; no unnecessary extra SMS |
| Pay | Provider-owned HTTPS checkout, independent product and account reference | Provider receipt; one durable application confirmation after authoritative paid state |
| Prepare | `/beliefs/onboarding`, `/beliefs/prepare`: optional preparation in caller's own words | None |
| Onboarding | 25–30-minute voice-native discovery, more beliefs than active slots; prepare two decisions and confirm understanding | One neutral confirmation after verified completion; interruption gives a rebooking path |
| Every day | 60–90-second target, two decisions by default, cap three; say decision, evidence, balanced reflection | No routine daily recap/SMS; incomplete call gets one neutral recovery notice |
| Every week | Separate 10–15-minute full reflection and caller-confirmed score | One neutral saved-review notice to the private access route |
| Low scores | Two consecutive server weekly periods at 0–1 retire one belief; prepare next ordered backlog item before activation | Reflected in weekly review/account; no extra sales message |
| Programme complete | Future calls stop; private decisions remain, no renewal or charge | Weekly completion is reflected in the account |
| Missed/unconfirmed | No repeated ringing, no accumulated late catch-up calls; missed onboarding needs a new slot | One recovery notice; no claim that an unconfirmed call definitely rang |
| Safety keyword | Immediate shared hold; practice stops; human review required | Content-free tier-1 operator SMS via durable outbox; existing tier-2 digest |
| Pause / resume | Private account; global STOP continues to override module resume | On-screen confirmation |
| Data / leave | Private account download or explicit whole-account deletion | Download; deletion stops both products and cancels base renewal through existing service |

Every private screen has a clear route back. Private responses have no-store caching and no-referrer policies, CSRF guards, escaped personal text and scoped credential expiry. Neither email nor SMS contains a belief, evidence, score or private bearer link. Optional email stores a contact address; the weekly app recap is a neutral SMS, not a sensitive email.

## State and integrity

- Default two active decisions; pure model supports a three-slot cap. Pilot default stays at two.
- A replacement decision, supporting experiences, balanced reflection and an opportunity must come from the caller and be confirmed. Unprepared backlog items reserve a slot, never become active merely because an older belief retires.
- Daily tool commands cannot discover beliefs, prepare replacements or submit scores.
- Weekly score period is server-derived. Duplicate events and same-period scores cannot manufacture a retirement. A missed period, score above one, or changed decision resets the low-score sequence.
- A preparation change versions the decision and clears its previous scores.
- Call tools stage encrypted changes. The signed caller transcript must contain the submitted caller wording before canonical memory changes. Mid-call browser edits invalidate the snapshot, rather than being overwritten.
- A pass does not count as full exercise coverage. Partial onboarding can be saved without claiming it complete.
- Flat daily cadence continues while prepared active decisions exist. No active decision means daily calls wait for preparation at weekly review.
- One worker advances due slots and creates a unique shared attempt under the caller lock. STOP, payment holds, human review and programme pause/completion prevent placement. Scheduling collisions within 45 minutes are skipped.
- Provider placement uses an idempotency key; an uncertain response is never automatically redialled. Stale attempts get the module's recovery route.
- Module aggregates, evidence and open session snapshots are encrypted. Closed sessions keep identifiers and coverage rather than duplicate personal words; the shared short-lived delivery buffer follows existing retention. Export includes retained records; account deletion cascades through them and the shared call/delivery history. Tool credentials are redacted from transcript exports.

## Review the implementation

`npm run beliefs:preview` opens a loopback-only walkthrough at http://127.0.0.1:8770/beliefs. Use synthetic information and code **000000**. Payment and calls are simulated, nothing leaves the preview. Data expires after one hour and disappears when the preview restarts. The preview controls advance weekly review periods; they cannot appear in production routes.

`npm run beliefs:doctor` reports configuration names and readiness only, never credential values.

`npm run beliefs:prompt -- onboarding`, `daily` or `weekly` prints the original review scripts. Their exact spoken wording is in the corresponding files in this folder.

`npm run speechify:sync -- --group beliefs --apply` uploads these prompts and declares their variables through the API. It can create missing private agents, preserves existing voices, reads back saved settings and creates private restore points. Tool provisioning and real-call verification remain separate. See [Speechify API sync](../speechify-api-sync.md) for server commands, recovery and routing-ID setup; `--group weekly` covers the original two 8&80 agents.

`npm run check` checks types, lint and ordinary tests. `npm run test:db` runs a temporary PostgreSQL cluster and makes database failures required instead of skipped. Test data is synthetic and does not reuse the owner's private documents.

## Live release gates

See [launch and operations](launch.md). Required external work: human safety coverage and approved urgent-call procedure, approved original scripts, three separately configured/verified Speechify agents, one-time provider product matching the base monthly price, provider test-mode payment/refund/return checks, consent/privacy/refund terms and a measured pilot.

The original request's absolute ban on spoken human guidance during urgent risk is unresolved. Routine contact reminders are omitted. An urgent response must be reviewed for safety; a quiet signup disclosure is not an adequate emergency-response plan. `BELIEFS_SAFETY_APPROVED` and the other release flags stay false until the actual procedure and coverage are reviewed. Keyword filtering has false positives and misses; it is not a clinical assessment.

See [research and assumptions](research.md) for which sources inform the scripts and which rules are product hypotheses.
