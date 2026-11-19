# Unblock emergency routing · approved initial scope

19 November 2026. **Norway-only initial scope and routing owner-approved.** Exact reply: “Yes, approve Norway-only scope and routing for the initial launch. Go ahead and implement it, then let’s review the escalation, disclosure and safe-handoff procedure next.” This approves the scope and destinations below. It does not authorise opening enrolment, automated emergency calls, data disclosure or a completed clinical protocol.

## Approved initial scope

Start with English-speaking adults currently in Norway. Record this as an explicit initial-launch restriction rather than inferring it from a Norwegian telephone number, billing currency or timezone. The enrolment restriction and the caller's current location during a safety concern are separate checks: a participant may travel after joining.

## Approved routing and outstanding procedure

1. Keep the approved core response, which immediately directs someone in danger to local emergency services. Do not wait for an operator acknowledgement before giving emergency direction.
2. Confirm the caller's current country before giving a country-specific number. Reuse an explicit location already given during the current conversation; ask only when missing. Do not infer location from account details. This routing clarification must fit the caller's answer, rather than becoming a fixed extra question after every safety sentence.
3. If the caller is currently in Norway and there is immediate medical danger, direct them to **113**. For urgent medical help that cannot wait for the GP, without an immediate emergency, the approved destination is **116 117**. The qualified reviewer must approve the escalation criteria and wording; the keyword tier alone is not a clinical assessment.
4. If the caller is elsewhere or their location is unknown, retain the country-neutral instruction to contact local emergency services. Do not guess a local number or present Norwegian short numbers as an international route. Supporting another country requires a separately verified directory/protocol and qualified review.
5. Eirik receives the existing private alert and follows the five-minute acknowledgement workflow. If he believes someone faces acute danger, the proposed human action is to contact the appropriate emergency service promptly and explain the concern, following the reviewed disclosure/location procedure. This action does not wait for the five-minute target. The app must not claim that an alert has reached a person merely because it was queued, accepted or delivered.
6. There is no automatic dial, transfer, dispatch, participant SMS or disclosure to authorities from this change. Any such capability would need an explicit design and approval. The reviewer still needs to settle what happens if the caller cannot contact help, cannot provide a location, is at risk of abuse, continues speaking, requests an end, or Eirik is unable to respond. Keep programme calls held.

The initial-country limit does not make foreign travel impossible or provide international emergency coverage. Location confirmation and an unknown-location fallback are still required. This is routing for professional help, not a promise of treatment, triage accuracy or an Unblock emergency service.

## Evidence and remaining review

- [Helsenorge: helping someone at risk](https://www.helsenorge.no/en/psykisk-helse/suicidal-thoughts-and-suicide/how-to-help-others/) advises promptly calling 113 for acute risk and explains that responders can help assess seriousness.
- [Helsenorge: out-of-hours medical service](https://www.helsenorge.no/en/hjelpetilbud-i-kommunene/out-of-hours-medical-service?redirect=false) distinguishes emergency 113 from urgent help through 116 117 when a GP is unavailable and help cannot wait. It also specifies a local eight-digit number when calling an out-of-hours centre from abroad; do not invent a +47 short-number fallback.

Sources checked 19 November 2026. Scope and routing destinations are owner-approved. Appropriately qualified review of the complete emergency/disclosure/ending protocol is still required. No production safety or launch flag should be set merely because these parts are approved.

## Implementation boundary

Signup requires an explicit Norway declaration before sending a code. Only the new Unblock signup namespace can complete that flow, so an older pending signup cannot bypass the declaration. Payment redirects require a second authenticated, CSRF-protected declaration. The version and timestamp are recorded separately from the original service consent; there is no backfill inferred from phone, timezone or billing. Legacy enrolments cannot start calls until the scope is confirmed; recovery, cancellation, export and deletion remain accessible.

During calls the signed session stores only ephemeral country/sequence metadata and a deduplication hash. A narrow literal English self-report can confirm Norway; ambiguous wording uses the neutral fallback. This is a caller declaration, not geolocation. Account eligibility is never reused as current location. On a hold, acknowledge the trusted-person answer before asking the current country once, when missing. Unknown or declined answers do not cause repeated questioning. The runtime exposes Norwegian numbers only for a Norway self-report, and scrubs the routing metadata on completion/closure. Static provider prompts contain no local numbers to guess from. The model still must follow the supplied result; real spoken compliance has not yet been verified.

The [consolidated escalation, disclosure and handoff policy](escalation-handoff.md) is now owner-approved and implemented. Qualified review and activation remain separate. Live call and alert tests were explicitly waived; real audio and delivery remain unverified.
