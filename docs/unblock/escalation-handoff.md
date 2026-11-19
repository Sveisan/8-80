# Unblock safety/privacy procedure · owner-approved

Version `2026-11-19-owner-v1`. Eirik approved all four decisions and their implementation: “Go. Approve all four decisions and implement the plan. Then let’s review commercial readiness.” This supersedes the earlier review draft. It is owner approval of the operating policy, not qualified clinical or Norwegian legal sign-off. Enrolment and live calls stay closed pending the remaining review, commercial readiness and explicit activation.

## Approved operating policy

1. **Human escalation.** If Eirik believes someone faces immediate danger, he promptly contacts the appropriate emergency service. This never waits for the internal five-minute acknowledgement target. Confirm current location rather than infer it from an account. Use the previously approved Norway routing; unknown or foreign location retains country-neutral guidance. Keyword detection alone is not clinical assessment.
2. **Limited disclosure.** Explain the intended disclosure and seek permission where feasible. Share only the immediate concern, necessary contact details and confirmed location. Any exception to consent must follow the qualified Norwegian legal review; the signup checkbox is not blanket permission. No automatic transcript sharing, family notification, emergency call or transfer is added.
3. **Honest handoff and ending.** The guide follows approved emergency guidance without promising rescue, monitoring or a callback. An alert being queued, accepted or delivered is never a human response. Make room for direct help and respect requests to end. A handoff is recorded only after an explicit caller report that help was reached or an actual human acceptance of responsibility. Plans to call, silence and alert acknowledgement are not handoffs. When help has not been reached, keep the incident unresolved and future programme calls held. A trusted person is chosen by the caller; never assume household members are safe. No automatic participant follow-up text is sent for a held conversation, including timeout. Human review remains required whatever the caller says or how the call ends.
4. **Minimal incident records.** Keep only necessary identifiers, timestamps, fixed action/confirmation categories and review outcomes in private operational records. Do not copy transcripts, locations, contact details or programme notes into the incident log. Delete resolved metadata after 30 days; retain unresolved incidents for human review. Account erasure removes call/message links while preserving the unresolved operational block. Verified Unblock account export includes still-linked incident metadata; weekly-only access does not expose it.

The approved core paragraph, sole operator, weekday 09:00–17:00 Oslo coverage, starts through 16:30, daily Available/Away rule and five-minute acknowledgement target remain in force. Failure/missed acknowledgement forces Away. Resolution never releases STOP, carrier opt-out, the individual safety hold or billing controls; it never resumes availability or calls.

## Private action record

Run these only on the private service host. They record actions already taken and send nothing. Escalation may be recorded before acknowledgement so an acute response is never delayed by the internal target. `--reviewed` is a human attestation, not proof that a qualified legal review has occurred.

```sh
npm run unblock:incidents -- --list
npm run unblock:incidents -- --ack INCIDENT_ID
npm run unblock:incidents -- --escalated INCIDENT_ID
npm run unblock:incidents -- --disclosed INCIDENT_ID --basis consent --reviewed
npm run unblock:incidents -- --disclosed INCIDENT_ID --basis reviewed-emergency-basis --reviewed
npm run unblock:incidents -- --handoff INCIDENT_ID --basis caller-confirmed --reviewed
npm run unblock:incidents -- --handoff INCIDENT_ID --basis human-confirmed --reviewed
npm run unblock:incidents -- --resolve INCIDENT_ID --outcome handoff-confirmed --reviewed
```

Use only the applicable basis. Existing attestations cannot be silently rewritten. A delivery receipt or ACK cannot satisfy a handoff confirmation. Resolve requires acknowledgement and completed human review. An unresolved inability/refusal to reach help must stay open. If private human review determines there is no ongoing concern requiring a handoff (for example a false alarm), record that explicit decision with `--resolve INCIDENT_ID --outcome no-handoff-needed --reviewed`; never use it simply because help was not reached. It still does not release the caller's hold.

## Owner decision to omit live testing

Eirik explicitly removed real-call and alert testing from the initial launch checklist and approved implementing that plan. Audible call behaviour and actual alert delivery/acknowledgement are **unverified**, not passed or failed. Do not request another test window as a launch prerequisite or mark waived tests as successful. Automated synthetic journeys, schema/privacy/hold regressions and private provider configuration readback remain required. `UNBLOCK_AGENTS_VERIFIED` at a later approved activation represents verified agent configuration with this recorded waiver, not a claim of live audio or SMS delivery acceptance. All five runtime launch flags remain off during this implementation.

## Remaining qualified review

The qualified reviewer still needs to review clinical exception handling and the Norwegian legal basis/conditions for necessary emergency disclosure, including refusal or inability to consent. Owner approval does not supply that legal basis. Commercial terms and final activation are separate decisions. No automated dispatch, disclosure, family contact or participant follow-up transport is authorised by this policy.

Routing sources checked 19 November 2026: [Helsenorge: helping someone at risk](https://www.helsenorge.no/en/psykisk-helse/suicidal-thoughts-and-suicide/how-to-help-others/) and [out-of-hours medical service](https://www.helsenorge.no/en/hjelpetilbud-i-kommunene/out-of-hours-medical-service?redirect=false). They do not validate this automated service.
