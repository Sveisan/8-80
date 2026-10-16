# First month, navigation and sendout map

Current implementation, 13 October 2026. Production tasks below are actual existing routes, not proposed new destinations. Local preview is a separate ephemeral simulation with extra daily/weekly/advance controls.

## Screen and route inventory

| Moment / route | Entry and next action | Back / recovery |
| --- | --- | --- |
| Discovery `GET /beliefs` | Understand independent product, AI rhythm and one-time policy; join or open practice | Brand/home; about, terms, privacy; weekly product footer uses `/start` |
| Information `GET /beliefs/about` | Purpose, duration, method, AI, adult choice, price policy and support | Beliefs home. Existing shared `/terms` and `/privacy` use the operating-company legal pages; preview stand-ins are not approved legal text |
| Join `GET/POST /beliefs/join` | Preferred name, optional support email, editable +47 phone, adult/AI/service consent; rate-limited OTP | Home; invalid number/consent/email has understandable error; unavailable enrollment/messages can retry later |
| Return `GET/POST /beliefs/access` | Fresh phone proof; uniform unknown-account response | Home; request a replacement code when expired, respecting limits |
| Verify `POST /beliefs/verify` | Hidden opaque challenge and product intent, six-digit code; scope private cookie; redirect account | Change number/request new code preserves join versus access intent. Direct GET redirects access. Incorrect/expired code stays on verify |
| Account `GET /beliefs/account` | Prominent next appointment; usual schedule/payment; preparation, active decisions, queued items, completed history; pause/resume, data, sign-out | Home/back always present. Missing/expired private cookie redirects access; no private capability in URL |
| Usual schedule `GET /beliefs/schedule` → `POST /beliefs/action`, `action=schedule` | Explicit saved IANA zone, daily/weekly times/day; first/continuation date only before understanding | Account; validation for calendar, DST gap, zone, spacing and coverage; completed programme rejects changes |
| One occurrence, account form → action `occurrence` | Kind plus exact current `expected_at`; new local date/time in saved zone | Account confirmation; stale submission/in-flight/hold/collision/coverage/too-late rejected; usual schedule retained |
| Skip one, account form → action `skip` | Kind/current timestamp; advances to following usual call, or clears first conversation pending rebooking | Account confirmation; no second skip from Browser Back and no catch-up call |
| Hosted provider checkout | Existing configured HTTPS checkout URL bound to `beliefs:` account reference; only full readiness exposes it; choose times first | Provider return must point to `/beliefs/account` or `/beliefs/access`. Return does not mark paid; delayed/failed state remains clear; confirm provider receipt before another attempted charge |
| Preparation `GET /beliefs/onboarding` → actions `outcome`, `queue` | Optional caller-written outcome and genuine thoughts/triggers ahead of the call | Account; no fabricated material to satisfy minimum; voice call alone captures understanding |
| Decision `GET /beliefs/prepare[?id=owned-id]` → action `prepare` | Own decision, experience, balance, opportunity and checkbox confirmation; edit active item or prepare selected vacant slot | Outcome before onboarding, account after. Queued items wait for a vacancy; legacy preparation needs fresh confirmation. Full fields required; revision guard; changed wording keeps previous version and resets scores |
| Onboarding voice | Greeting → orientation → focus → situation/thought → one or more genuine thoughts → prepare one or two → understanding | Complete signed stages saved; unfinished stage identified; customer chooses continuation via account schedule |
| Daily voice | Familiar saved topics → decision → experience → balance/pass | No routine recap; optional skip/pause/reschedule in account; no discovery/score/preparation |
| Weekly voice | Full neutral reflection → confirmed score for start-active items → retirement → next fitting backlog preparation | Missing/ambiguous score stays missing; outdated backlog can be removed in account; related additions allowed or same-call score for revised/new item |
| Pause/resume, account POST actions | Product state only; global STOP/safety/payment still outrank resume | Account confirmation; private data and entitlement retained; no charge |
| Data/account actions `export`, `delete` | Fresh scoped proof + CSRF; complete export; explicit `DELETE` erases both products | Download is private/no-store; deletion clears cookie and returns home. Provider erasure review remains in operating handoff |
| Sign-out `action=signout` | Deletes private link credential and clears scoped cookie | Beliefs home; returning requires fresh verification |

All post-save responses redirect with 303 or return an explicit error. GET routes do not charge, save a practice command or change appointments. Mutation forms use CSRF plus event/revision or exact-appointment guards. Replaying changed event content fails; historical events without a stored digest fail closed. Browser timezone changes never submit a schedule mutation.

## First-month rhythm

| When | Customer value | Navigation / sendout |
| --- | --- | --- |
| Join / purchase | Understand product and payment, verify identity, choose manageable times | Join → verify → account → schedule → hosted checkout → account; code, provider receipt, authoritative-paid SMS |
| First conversation / continuation | Understand method and experience full preparation | Private account preparation/booking; voice call; ready or unfinished continuation SMS |
| Following days | Repeat chosen decisions without an admin burden | Daily calls; account only when useful; no routine SMS/email recap |
| Weekly periods | Honest review and caller-selected scores; fitting backlog advances | Review call; one verified saved-review notice, or recovery notice |
| Around day 28 | Discuss usefulness, concrete change, burden and rhythm | Included in period-3 weekly context/script; no additional scheduled call or reminder |
| Completion, whenever reached | Calls stop, history and billing status remain understandable | Account completed state and one content-free completion notice; no renewal |

This is an experience map, not proof that participants have completed it. A programme can last longer than the first month.

## Message ownership and suppression

| Trigger | Owner / actual destination | Wording and guard |
| --- | --- | --- |
| Verification | Application durable SMS outbox; `/beliefs/verify` challenge screen | `Your 8&80 Beliefs code is {code}. It expires in {configured_minutes} minutes.` Actual TTL derives from signup/access constant; current ten minutes. Never reuse as account URL credential |
| Receipt | Payment provider | Provider receipt only; no duplicate app invoice. Amount/currency/tax/return route need real provider test |
| Paid state | Application; one key `beliefs:purchase:{provider}:{purchase}` | `Your 8&80 Beliefs purchase is confirmed. One payment, no renewal. Choose or check your call times: {public_origin}/beliefs/access` Works even if no appointment remains booked. Only authoritative paid state; duplicate/reordered events re-read provider |
| Onboarding unfinished | Application; occurrence key `beliefs:call:{session}` | `Your first conversation is unfinished. Choose a time to continue: {access_url}` Partial canonical saves retain only verified caller content |
| Onboarding complete | Same occurrence key | `Your Beliefs practice is ready. View your decisions and booked times: {access_url}` Only after signed canonical save and full onboarding |
| Successful daily | No routine message | Keep the low-burden rhythm; no SMS or email containing practice material |
| Missed, late, collision, incomplete or unconfirmed daily/weekly | Same occurrence key | `Check or change your next Beliefs call in your private account: {access_url}` At most one notice per recorded occurrence; no claim a call definitely rang; no redial |
| Successful weekly save | Same occurrence key | `Your Beliefs review is saved. View it privately: {access_url}` Only completed canonical review coverage |
| Programme complete | Replaces the successful-review notice under the same occurrence key | `Your Beliefs programme is complete. Calls have stopped; your decisions remain private. There is no renewal. Open your account: {access_url}` One-time baseline only; no extra completion plus review SMS |
| Pause/resume/usual schedule/one occurrence/skip | On-screen application confirmation | No extra external notice by default. A resume cannot promise a ring while a shared hold remains |
| Tier 1 signal | Application safety outbox to operator/backup | Content-free count/tier and review instruction; no caller number, words, belief, evidence or score. Durable transport state is not human acknowledgment |
| Tier 2 | Existing daily digest, now durable safety outbox intent | Content-free waiting count. Failed sends remain recoverable; no duplicate same-day digest intent |
| Human check-in / reply | Separately reviewed operator procedure | Not invented or automated in this continuation; existing runbook is not a newly approved Beliefs urgent protocol |

Access URL is the public verification route, with no private bearer token or sensitive query data. Outbox encrypts pending recipients/payloads, suppresses customer notices on carrier opt-out/deletion/human hold and minimizes accepted content. Safety notices target operators, not the opted-out customer. Coordinate pilot notification counts with existing weekly notifications; there is no new combined marketing sequence.

## Interruption and recovery map

| Failure | Durable meaning | Customer / operator next step |
| --- | --- | --- |
| Expired OTP/private session | No new access; private cookie cleared on expiry | Request fresh code; privacy is not weakened to ease recovery |
| Failed/delayed checkout | Pending/hold until authoritative read; return is not a purchase | Check provider receipt/account; contact support before repeating uncertain payment |
| Missed first conversation | Original appointment consumed; no repeated ringing | Book continuation; entitlement does not renew/expire automatically |
| Too little genuine material | Onboarding stays unfinished; no daily start | Continue voluntarily or ask support about fit; owner must decide any exception/remedy |
| No evidence/opportunity | Preparation incomplete or daily coverage passed | Keep honest missing state; do not create example or count full coverage |
| Outdated backlog | No false preparation/activation | Explicit Remove from queue; history retained, no claim of successful retirement |
| Tool save/check failure | No guaranteed canonical update | Honest spoken branch, end unreliable exercise, technical review; no invented safety response |
| Final disagreement/missing literal span | Transcript reconciliation rejects staged aggregate | Account shows retained canonical state and neutral recovery; caller need not perform artificial recital |
| Concurrent browser edit | Snapshot revision stale | Preserve browser change; voice aggregate cannot overwrite it; reopen current account |
| Provider timeout/uncertain ring | Claimed attempt retained for sweep; no automatic second request | Sweep closes with one recovery notice; investigate privately |
| STOP/payment/safety/pause | Placement prohibited; global STOP wins | Product resume cannot release shared hold; human/payment procedure required |
| Alert failed/uncertain/expired | Durable outbox diagnostic; not delivered/acknowledged | Named operator checks fixed-status reports and follows approved backup/failure path |
| Completion/return | Future calls cleared, private history retained | Read history; no programme reopening or charge from browsing/reactivation |

## Approved-policy journey additions — 15 October 2026

| Moment | Navigation / customer action | Sendout / result |
| --- | --- | --- |
| First conversation | One genuine prepared decision is enough; no invented backlog | Existing signed onboarding confirmation only |
| During unfinished practice | Account → Add a related belief / Remove from queue / Pause / Resume | No extra marketing or recap; existing purchase stays valid |
| Mistaken completion | Account → Was completion a mistake? → select decision → confirm | Prior score version retained, no charge; daily/weekly practice can continue under existing holds |
| Included return | Completed account → choose a time in saved zone → explicit booking; next card offers cancellation | One verified completion notice: “Your included return check-in is complete. No further calls or payments have been started. Open your account: {access_url}” |
| Further full programme | Completed current account → new outcome → separate-payment confirmation → schedule/checkout | New programme/purchase identity; earlier programmes remain in Your programmes; no charge on confirmation alone |
| Refund or missing delivery | Any paid programme → Refunds and delivery help → reason → request review | Durable human-review acknowledgment in account; content-free operator SMS; no claim of returned funds |
| Completed history nearing expiry | Account → Your programme history → download, DELETE HISTORY, later UTC date or acknowledgment | One content-free SMS per programme/deadline: “Your completed Beliefs history is due for deletion on {date}. Export it, delete it or choose a later date in your private account: {access_url}” |
| Notice fails / opted out | Operator follow-up and authenticated account acknowledgment | Cleanup waits; provider acceptance alone does not count as delivery |

Programme selectors stay in owned private navigation and hidden form identity. They are not login credentials. No scheduled reminder reopens practice, renews payment or starts an included check-in. Reminders use the existing durable SMS worker; there is no new customer email sequence.
