# Encouragement SMS pilot

My page offers a distinct, optional SMS subscription. No migration or deployment
opts an account in. Weekly calls, one-off reminders and existing nudges have their
own controls. Paused calls, all-SMS STOP, safety holds, incomplete onboarding and
inactive billing suppress encouragement at queue and submission time.

The private allowlist is `ENCOURAGEMENT_PILOT_HASHES` (comma-separated account
hashes). Both `ENCOURAGEMENT_READY=1` and `ENCOURAGEMENT_PHONE_TEST_PASSED=1` are
required for nonpilot access. Keep both zero until the real guided SMS phone test
and the My page encouragement test below pass. A successful unit test, provider
acceptance or operator cleanup never establishes that phone test passed.

## Behaviour

- Off by default. Explicit checkbox consent; separate strong-language opt-in.
- Tuesday / Monday-Wednesday-Friday / daily, first delivery on a future scheduled
  local date from 10:00 outside quiet hours. Account timezone is the initial
  preference; later explicit SMS timezone is independent. Quiet start is inclusive,
  end exclusive; equal start/end and all-day blocking windows are rejected.
- Quiet hours, IANA zones and DST use real instants. One unique event per local
  date; late jobs (>2h) skip without catch-up. Active calls/recent SMS defer sending
  for up to the existing two-hour expiry. The final check rejects a changed date.
- Editing, pausing, stopping and resuming increment a revision and suppress old
  queued text. Saving an enabled preference preserves its existing pause. Stale
  forms reload current settings without changing them. Provider submissions
  already accepted before a stop cannot be recalled.
- 24 reviewed variants, editorial scores 8–9/10, across four tones and three
  topics. Recognition requires recorded completed-action counts. Action nudges
  quote the user's optional chosen focus. No model infers moods or achievements.
- Wording rotates. Less excludes the exact wording for the retained 30-day window;
  more increases its weight. Recent wording is avoided when an alternative exists, unless the user asked for more of it.
  Feedback is available only to the account that owns a submitted/delivered SMS.
- Aggregate report: `node --import tsx services/voice/src/encouragement/report-cli.ts`.
  Initial stable hashed allocation, pilot and adaptive traffic are distinct. This
  is descriptive data, with no automatic winner or roll-out decision. Do not use
  delivery acceptance as proof of receipt, or voluntary feedback as causal lift.
- Focus and delivery bodies are encrypted. History/feedback expires after 30 days;
  preferences remain editable. Full account export/deletion includes both tables.

## Required phone gate (still pending)

1. Run the existing guided create/move/cancel one-off SMS phone test. Confirm the
   actual transcript/tool receipts, cancellation state and received SMS where due.
2. On the owner pilot My page, opt in, choose frequency/tone/content, quiet hours
   and timezone. Confirm saved values survive reload; review the example.
3. For a controlled pilot delivery at an agreed time, verify the real SMS wording,
   sender, focus, language preference and a truthful delivered receipt. Never
   inject a test job into a real account without an agreed test time.
4. Save more/less feedback and confirm changed future wording. Pause, resume and
   stop; verify an already queued job cannot send after controls change. Verify
   global STOP (calls and texts) and quiet hours with the pilot. Restore the user's chosen final
   settings and remove any synthetic jobs.
5. Record transcript IDs, provider receipts, both test outcomes and user approval
   before changing either global gate. A failed test keeps both gates at zero.

Automated tests use isolated PostgreSQL schemas and fake SMS providers. Production
smoke tests must never create a live encouragement send or alter the real owner's
preferences. The Speechify guide and normal agents require no changes for this UI.
