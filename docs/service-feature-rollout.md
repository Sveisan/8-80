# Feature tips, requested reminders and encouragement

The 13 November 2026 rollout enables the tested feature tips and one-off SMS
reminders in eligible weekly calls, and encouragement controls on every account's
My page. It uses the tested 1af750e backend and four verified dialogue agents from
the 6f9c987 prompt candidate. The separately prepared weekly conversation changes
in PR38/PR42 are outside this release and retain their own phone-test process.

Production flags after activation:

- `WEEKLY_TOOLS_READY=1`: caller-scoped authenticated tools available to all
  eligible weekly sessions. Existing tip opt-outs, contextual timing, one-tip
  spacing and reviewed scores above 7 remain enforced.
- `WEEKLY_DIALOGUE_READY=1`: scheduled calls use the four verified first/returning
  male/female agents that implement this tool protocol. No call is placed by
  activation; existing bookings and voice choices are preserved.
- `WEEKLY_DIALOGUE_PILOT=0`: no longer limits those agents to one test account.
- `ENCOURAGEMENT_READY=1` and `ENCOURAGEMENT_PHONE_TEST_PASSED=1`: My page controls
  become available to every account. Neither flag opts an account in.

Encouragement remains off by default. An account must explicitly save opt-in and
its frequency, tone/content, timezone and quiet hours. Pause/stop, carrier STOP,
account eligibility, revision checks and final-send controls still apply. The
rollout does not create preference rows, alter existing consent or queue a text.
One-off reminders still require a proposal and explicit confirmation in the call;
moving and cancelling remain caller-scoped and revision-checked.

The owner completed create, move and cancel on the real guided phone test. The
owner confirmed the move consent omitted from Speechify's transcript and receipt
of the separate encouragement SMS. The carrier returned delivered; the owner's
stated “More like this” choice was persisted through the production page form.
The owner clarified they had selected the feedback answer in chat rather than
tapping the page button. Automated browser testing covers that button. This
evidence does not claim that the owner personally completed its browser journey.

The owner subsequently explicitly requested all-user activation. Deployment
retains configuration/database backups, verifies the actual provider prompts,
tools, variable catalogs and flow state, and changes the flags under the scheduler
release lock with no calls in flight. A failed verification restores the previous
configuration. The isolated pilot account and its test history are retained;
pilot assignments/messages remain excluded from real-user results. Synthetic
sampling counters may be reset only before any randomized real participant exists.
Existing randomized cohorts and experiment decisions must never be reset.

New environments keep readiness flags at zero in `.env.example`. Production
activation is an operator action backed by the recorded tests and owner approval.
Rolling back readiness does not erase preferences or consent. It suppresses
encouragement at submission time; enabling again never constitutes new consent.
