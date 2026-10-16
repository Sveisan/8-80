# Beliefs — approved policies and implementation

Owner decisions confirmed on **15 October 2026**, implemented in the reviewable policy follow-up to merged PR #6 (`ffc96ac5d854380d9013a09a1769c04d4a4fd257`). These policies supersede conflicting historical descriptions. Implementation and local testing do not constitute deployment, provider verification or approval to take real payments or calls.

## Confirmed rules

| Area | Approved rule |
| --- | --- |
| Price | One separate payment equal to one monthly payment for weekly 8&80, in the same currency. No subscription or automatic renewal. Actual amount and tax presentation still require provider verification. |
| Programme scope | One purchase covers one chosen outcome and related beliefs, without a fixed programme expiry. Related beliefs may be added later; an explicitly chosen new outcome belongs to a new programme. |
| Starting | Start with one or two genuine, fully prepared beliefs. No compulsory backlog or invented material. Preserve caller confirmation, understanding and the existing maximum of three active decisions. |
| Queue | Offer “Remove from queue” for material that no longer fits. It no longer blocks progress; earlier practice history remains private and available under the retention policy. |
| Pause | Resume an unfinished programme under its existing purchase. Inactivity alone does not expire entitlement or erase progress. Existing STOP, payment and human-review holds still apply. |
| Completion error | Correct a mistakenly completed programme without charging again. Correction is distinct from purchasing another programme. |
| Return | Each completed programme includes one brief return check-in. A further full programme, whether revisiting an old outcome or choosing a new one, requires a clearly displayed new one-time payment. Preserve the existing account and retained history. |
| Refund guarantee | Full refund before the first call, or within 14 days after the first connected call, even if the customer has tried the programme. This voluntary guarantee does not reduce statutory rights. |
| Delivery problems | Support separately resolves missing service, incorrect charges and refund requests. These are not limited to the voluntary guarantee window. |
| Completed history | Retain for 12 months after programme completion. Notify 30 days before deletion; offer export, deletion or an explicit choice to keep it longer. |
| Unfinished records | Preserve progress and entitlement while the programme is unfinished. Completed-history cleanup must not expire an unfinished purchase. |
| Financial records | Handle necessary payment records separately under applicable recordkeeping obligations. A retained transaction record does not itself justify retaining belief content. |

No return call, payment, programme restart or retention extension is automatic merely because the customer opens the account. A new focus is the customer's explicit choice, not an inferred classification that silently creates a charge. No sales interruption belongs inside a difficult reflection.

## Implementation and evidence

| Policy | Implemented behavior | Evidence |
| --- | --- | --- |
| Flexible start | At least one fully prepared decision; normally one or two, maximum three; no compulsory backlog | Pure transitions, protocol and browser journey |
| Related additions / removal | Outcome locks after understanding; related thoughts can be added in account/weekly calls; queued/preparing items can be removed without claiming retirement | Transition, confirmation and queue tests |
| Separate programmes / payments | Programme UUID and checkout reference; old sessions/purchases remain bound to the old programme; one current selector per account | Populated upgrade, concurrent purchase and delayed-callback tests |
| Resume / completion correction | Free unfinished resume; explicit authenticated correction archives prior score version and cancels completion deadline | Repository and operator recovery tests |
| Included check-in | Explicit booking; one verified check-in per completed programme; no daily/weekly restart; uncertain placement waits for review | Claim, signed settlement, duplicate and operator release tests |
| Refunds | Customer-favourable first-connection clock and 14-day boundary; durable human-review request; requests never claim money returned; provider-confirmed refunds reconcile to the purchase | Clock, request, historical price and old-purchase callback tests |
| History | Twelve calendar months after completion; content-free SMS reminder; explicit date extension, export and scoped deletion; no cleanup before notice delivery/acknowledgment plus 30 days | Boundary, failure, fairness, pruning-safe evidence and scope tests |
| Customer wording | Account, service information, script/tool pack, terms and privacy drafts describe these choices | Local browser and copy review; legal/provider review remains external |

Read [verification and operator runbook](policy-verification.md) for fresh results, controls and remaining activation work. The prior 673-test report describes PR #6 only.

## Implementation decisions

- First connection requires a timestamped caller utterance in a signed completed conversation whose captured words verify. Scheduling, outbound acceptance, voicemail and invented timestamps never start the clock. Missing/ambiguous evidence leaves the guarantee open for human review; this may give the customer a longer window.
- The included check-in uses a separate branch of the weekly agent, aiming for three to five minutes. This is a script target, not a measured provider duration cap. The three agent packs and updated tool schema require provider synchronization and audio checks before activation.
- Customers explicitly choose a later UTC date for history retention. There is no invented automatic extension duration. A changed deadline suppresses pending reminders for the old date and resets notice evidence.
- Failed, suppressed or unconfirmed reminders defer automatic deletion. The account supports explicit acknowledgment, and operators must follow up overdue notices. Delivery evidence is copied into the programme before short-lived outbox pruning.
- Programme-history cleanup removes personal practice and session content while preserving minimal financial/entitlement records, other programmes, weekly data and an unused included check-in. Whole-account deletion remains separate. Provider-held data and backups need the operating-company retention/erasure procedure.
- Resolving a support request without refund restores eligible standing but leaves unfinished practice paused. Only the customer resumes. An uncertain included check-in can be released only after a person confirms with the provider that it did not connect.

Production deployment, provider writes, real participants, payments/refunds and activation remain separate actions. Confirm legal wording, company jurisdiction, statutory withdrawal process, financial-record retention, provider retention/deletion and staffed safety procedures before publication or activation.

## References

- [Existing specification](product-spec.md), [merged verification report](continuation-verification.md), [operating handoff](launch.md).
- [Norwegian Consumer Council: withdrawal and voluntary guarantees](https://www.forbrukerradet.no/forside/angrer-du-pa-et-kjop/). This supports distinguishing statutory rights from a voluntary guarantee; it does not prescribe the approved first-call-based guarantee.
- [Personal Data Act / GDPR text](https://lovdata.no/dokument/NL/lov/2018-06-15-38/*). Storage limitation requires purpose-based retention. Twelve months is the approved product choice, not a statutory retention period or a finding of legal compliance.
