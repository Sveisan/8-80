# Retention improvements and release checks

Prepared 9 October 2026 on top of merged commit `46fde7f`. The earlier first-month PR has already merged. This follow-up implements the authorized workshop recommendations; customer research and retention uplift remain unmeasured.

## What changes

- Booking and access prefill an editable `+47` country code. People enter their Norwegian number after it or replace it for another country, without an explanatory paragraph. Phone/email labels remain visible after entry, and submitted values survive validation errors.
- Booking previews the actual first date and local zone using the same `nextSlotAfter` calculation as enrollment. Changing a slot refreshes the date; the server check-date button preserves choices and works without JavaScript. Date checking does not enroll someone or send an SMS. The code-entry page also shows a dated appointment.
- Returning controls are grouped into next call, notes, plan, contact/preferences and data. Time, goal and email editing expand when needed. Skip, pause, cancellation and data actions remain discoverable. Sensitive actions retain their existing proof requirements.
- Returning prompts handle a missing previous action with an ordinary check-in, skip the completion/undone-week questions, and explicitly accept declining an action. Introduction completion remains independent of choosing an action. Recent three-month wording is preserved and aligned in goal-editing labels.
- Review-held accounts show an honest hold state. Appointment lookups and move/resume eligibility respect the existing hold. The review mechanism and operator authority are unchanged.
- `npm run journey` adds a separate `retention` result. Backend-completed, post-introduction conversations include no-action calls. Callbacks share their original cycle; missed callbacks, skips, permanent changes, resumption and fresh weekly claims reset the association when appropriate.

No new customer sendout campaign is introduced. The earlier-first-appointment and advance-expiry-email ideas remain conditional experiments from the workshop.

## Interpreting retention

The proposed primary operational proxy is late-month return: at least two distinct conversation cycles, with the first completed conversation of one cycle from 21 elapsed days up to, but excluding, the 30-day boundary after verification. Separate fields report two-cycle return and three-cycle depth. Duration/provider status/action extraction alone does not establish value; the backend classifier requires caller participation, and private customer research must assess usefulness and accuracy separately.

Only accounts verified after the tracking migration and observed for a complete 30 days enter the mature denominator. The report separately counts immature accounts and mature accounts without full tracking. A new deployment therefore initially reports no mature cohort and a null rate. Account deletion and 60-day pruning limit historical completeness; those limitations remain in the JSON. Paused/stopped retained accounts remain in the denominator. SQL uses elapsed-hour windows across daylight saving.

Migration `0022_retention_cycles.sql` adds opaque cycle references to caller scheduling, call attempts and journey events, plus a global instrumentation start date. It does not backfill old conversations or extend personal-data retention. Apply migrations before restarting code or scheduled calls. The privacy description includes the new opaque reference.

## What Eirik needs to do

1. Review and merge this PR into `claude/8-80-prompt-v3-f9tk4m`.
2. In Speechify, save the generated first-call and returning prompts on their respective agents. Copy the complete generated files from the local audit folder; do not paste transcript data or credentials. Regenerate later with `npm run --silent prompt -- first console` and `npm run --silent prompt -- console`.
3. Both agents must declare every variable their prompt uses. The full shared list is `call_number`, `first_name`, `last_commitment`, `last_day`, `own_eight`, `own_eighty`, `last_belief`, `weeks_undone_running`, `own_goals`, `booked_slot`, `next_appointment`, `onboarding_progress`. Compared with the nine variables previously shared, add `first_name`, `next_appointment`, and `onboarding_progress`. Use string types; `call_number` defaults to `1`, `onboarding_progress` to `pending`, and optional context to empty. Live calls supply the actual values.
4. Run the secret-safe server status check and release update instructions provided with this PR. The updater needs the full release commit. It preserves an active scheduler; an already paused scheduler stays paused unless explicitly run with `--resume`, after saving both agent prompts.
5. Rehearse an authorized real first call, interruption/callback, and second call. Confirm correct caller identity, disclosure, remembered words, voluntary action, accurate recap and next date. Share only pass/fail observations and service states here.
6. Recruit the proposed six-person research round through an authorized process: two new, two returning, two stopped/missed users. Use synthetic accounts for navigation and consent for conversation discussion. This code review has not performed outreach or customer interviews.

The updater keeps configuration, database backup and diagnostics in a root-private server directory. Its public output contains fixed status lines, not `.env`, connection strings, provider response bodies, phone numbers or private logs. A failed update keeps the scheduler stopped once the pause step has run. Keep private diagnostics on the server.

## Validation

The complete check passed typecheck, lint and all 585 tests, with zero failures and zero skips, using an isolated PostgreSQL instance. New cases cover no-action continuity, callback cycle inheritance and expiry, mature versus immature/unobserved cohorts, callback deduplication, deletion/pruning, exact boundaries across daylight saving, date preview without contact details/sendouts, and honest review-held controls. Five updater smoke cases verify scheduler-state preservation, explicit resumption, failure behavior and private output.

Browser checks use synthetic accounts and fake providers. They cover date updates, persistent input help, expandable editing and visible cancellation at mobile widths. Actual provider delivery, saved console prompts, conversation quality and production scheduler state still need the human checks above. The release handoff supplies the full PR commit to the updater; the updater rejects it until it is merged.
