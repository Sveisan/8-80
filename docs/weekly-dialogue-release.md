# Weekly dialogue: customer release

The weekly dialogue policy can now run independently of optional feature tips and
SMS tools. `WEEKLY_DIALOGUE_READY=1` routes ordinary first and returning calls to
the four verified dialogue agents and applies confirmed-action extraction.
`WEEKLY_TOOLS_READY=0` keeps those optional capabilities unavailable to ordinary
callers. Existing bookings use the new dialogue on their next call after release;
the update does not move bookings or place an immediate call.

## Evidence, 13 November 2026

- The PR27 source passed 120/120 native conversation checks across all four roles.
- The owner completed first and returning phone pilots. Confirmed first-call
  facts matched storage, the return request matched storage, and the agent used
  the saved action without the caller first repeating it. The owner confirmed
  both goodbyes sounded natural.
- A separate paused, non-dialable owner test profile received a signed completion
  event through the running production HTTP handler. Automatic processing saved
  the four expected memory fields and incremented the counter once. Three
  deliveries of that event produced one recap intent, one transport attempt and
  one provider receipt. Redispatching the accepted outbox item did not send again.
  Resend subsequently reported `delivered`; inbox placement/opening is not measured.
- That email went only to the owner's registered address. No new phone call or
  SMS was placed, and the owner's real profile and booking were unchanged.

The live aftercare test ran on the installed backend, not an undeployed branch.
Its outcome, settlement, storage, webhook and outbox source hashes must match the
release. The new dialogue-only route and strict extraction are also covered by a
database-backed signed-webhook first/return regression test, including duplicate
callbacks and rejected unconfirmed memory. A replay test demonstrates this path;
it is not a universal guarantee of exactly-once delivery during every provider
failure. Unknown sends retain the existing outbox reconciliation rules.

## Release procedure

1. Merge the release and deploy its exact commit with the merged
   `scripts/update-safe.sh`, not the older installed copy of that script.
2. Supply `--dialogue-approval /path/to/private/approval.json`. This is a private
   operator evidence file, owned by the service user and mode 600, prepared from
   the actual pilot reports. It must name the deployed commit, exact source and
   tested prompts/settings; it expires after 48 hours. Do not paste it into chat.
3. The updater pauses scheduler startup, obtains the scheduler's exclusive release
   lock and refuses to proceed while any call is in flight. It preserves private
   backups, updates code/dependencies/migrations, checks configuration, then runs
   `node --import tsx services/voice/src/weekly/rollout-cli.ts --activate APPROVAL`
   **as the service user**. It health-checks the web service before restoring the
   timer's previous state. `--resume` explicitly enables a previously paused timer.
4. Activation reads all four actual agents, tool bindings, variable catalogs and
   separate flow/version endpoints. Prompt/greeting, provider configuration
   (including STT, turn handling and duration), private memory/recording settings,
   voicemail handling and real worker tools must match the approved evidence.
   Published or draft flow overrides are refused for this release. Tracked local
   edits, missing evidence or changed settings stop activation.

Only `WEEKLY_DIALOGUE_READY` is changed in `.env`; other values are preserved and
a private backup is made. There are no prompt uploads, calls, messages or booking
changes in activation. The existing four private agents are reused. A read-only
precheck is available with the same CLI's `--check APPROVAL` option.

If activation or subsequent startup fails, the updater attempts dialogue rollback
and legacy web recovery, leaves scheduling paused and reports fixed status lines.
Rollback can also run as the service user with the CLI's `--disable` option, then
restart the web service. It changes routing for future calls; existing transcript
policy markers continue to govern already placed calls. Never terminate an
ongoing call to deploy or rollback. Keep diagnostics, private evidence and database
backups on the server; share only the updater's status report.
