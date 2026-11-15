# Google Calendar: move only the next call

The optional Google transport creates a private, single event on the 8&80
organizer's calendar. The invited person can move it in Google Calendar. The
minute tick reads Google's incremental changes **before claiming weekly calls**,
updates `next_call_at` through `Scheduler.moveIfActive` without its weekly-slot
argument, and sends a short confirmation through the existing email outbox.
`slot_weekday`, `slot_minute` and the saved booking timezone stay unchanged. The
call after the moved call returns to that ordinary weekly slot.

Customers authorize no access to their other calendar events. Only the 8&80
organizer authorizes OAuth, and the service reads that organizer calendar. Use a
dedicated 8&80 Google account/calendar. Google permissions let guests edit the
event; the feature is not offered as a general Outlook/Apple Calendar promise.
The existing **Manage your calls** link remains available.

## Transport and rollout

- Disabled by default with `GOOGLE_CALENDAR_ENABLED=0`.
- When enabled, newly queued **weekly** invitations use native Google events with
  guest modification enabled. Additional programmes retain their ICS transport.
- Google sends the native invitation/update/cancellation (`sendUpdates=all`). A
  second ICS email is **not** sent for that event. The event description carries
  the existing warm calendar copy, short practical text and permanent `/me` link.
- Each invitation captures its transport and explicit organizer calendar ID.
  Existing ICS invitations are not silently imported, replaced or resent.
- An existing subscriber can choose **Use Google Calendar** under Contact and
  preferences. This cancels only their old weekly ICS invitation and creates the
  new native one, without changing either the booked instant or weekly slot.
  Other programme invitations keep their identities. Repeating it is a no-op.
- Turning the rollout flag off stops new Google invitations. Keep OAuth
  credentials configured: existing native events still need sync/cancellation.
- No production connection, account permission grant or live invitation is made
  by the migration or tests in this PR.

## Provision the organizer before activation

1. Merge the PR, back up and apply **0036_google_calendar_sync**, and deploy with
   `GOOGLE_CALENDAR_ENABLED=0`. The migration preserves existing invitation IDs
   and transport. No voice prompt change is required.
2. Enable the Google Calendar API in an operator-controlled Google Cloud project.
   Configure an OAuth client for the 8&80 organizer and obtain an offline refresh
   token for `https://www.googleapis.com/auth/calendar.events.owned`. Use a user
   OAuth token: a service account cannot invite attendees without Workspace
   domain-wide delegation. Only sign in as the intended 8&80 organizer.
3. One manual authorization option is Google's OAuth Playground with **your own
   OAuth credentials**, its documented redirect URI and offline access. Complete
   Google's consent/publishing requirements for a durable production token;
   don't rely on a short-lived external-Testing configuration for unattended
   production. Store secrets directly in the server's private environment, never
   in chat, the repository, logs or PR comments.
4. Configure `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`,
   `GOOGLE_CALENDAR_REFRESH_TOKEN` and `GOOGLE_CALENDAR_ID`. Copy the explicit
   calendar ID from the organizer's Calendar settings, not the alias `primary`.
   Keep `RESEND_API_KEY`, `RECAP_FROM_ADDRESS` and the HTTPS `PUBLIC_URL` configured
   for confirmations and the management link.
5. Run `npm run preflight` and `npm run calendar:google -- check`. The latter only
   reads an API page and prints a fixed reachability result; it does not create an
   event or print attendees, calendar IDs, tokens or provider response bodies.
6. Enable `GOOGLE_CALENDAR_ENABLED=1` and restart the control service. The existing
   minute timer performs synchronization; there is no new public webhook or
   separately scheduled worker to maintain.
7. With an authorized test subscriber, enable/upgrade invitations, accept the
   native Google invitation, move it to a later valid time, and wait for the
   confirmation (normally within a minute). Check My page, one calendar event and
   the unchanged usual weekly time. Rehearse an app-side move, opt-out and
   cancellation before general rollout. Do not move a real appointment to test.

`npm run calendar:google -- status` reports aggregate counts, whether the setup
is complete, cursor health and last successful sync times without disclosing
customers or credentials. If Google cannot be reached, affected calls wait;
legacy calls remain eligible. Investigate failed/stale sync or cleanup tasks
before removing credentials or the organizer account.

## Consistency and failure behavior

- The incremental cursor is encrypted, saved only after all pages succeed, and
  protected by a renewable database lease. A 410 response starts a full scan.
  Reprocessing pages after an interruption is idempotent. Unknown events cannot
  select a caller; a stored event ID/calendar ID, organizer copy, recipient and
  private invitation marker must match.
- Only the currently booked weekly call can move. Edits cannot revive a paused,
  stopped, opted-out, held or already in-progress call. A valid move received at
  the original due time is applied before claiming, with the same event identity.
- Changed events must be timed, non-recurring, exactly 15 minutes, and at least
  two minutes into the future. Rejected future changes are restored and produce
  a single explanatory email. Late/unverifiable/deleted organizer events are held
  for reconciliation, not treated as instructions to dial at an obsolete time.
  Deletion/decline is not implemented as subscription cancellation. Use My page
  to stop or change calls; re-enable invitations to replace a deleted event.
- An app change already waiting for publication wins over an older Google
  revision. Published revisions, stable event IDs and ETag preconditions prevent
  retries from reverting guest changes or duplicating events. A guest move gets
  one email confirmation without an ICS attachment. Its metadata acknowledgment
  does not generate another native invitation email.
- Calendar changes and notices share the existing per-caller lock and versioned
  outbox. A stale confirmation is suppressed after another schedule change or
  opt-out. Native `gcal/` delivery receipts mean the calendar operation was
  published; they do not assert delivery of Google's notification email.
- A native call is eligible only when its event has been reconciled and the
  organizer cursor is healthy and no more than two minutes old. API/token failures
  therefore hold affected calls instead of using an unconfirmed old time.
- Account erasure records a durable, opaque Google cleanup task before deleting
  local customer data. The tick retries native deletion without keeping the
  customer's address or phone hash in the task. Finished organizer events are
  removed after 30 days without notifying guests again. Provider-side deletion
  still depends on working authorization and API availability.

## Verification scope

Automated tests use isolated PostgreSQL and fake Google/email providers. They
exercise outbound event permissions and IDs, native updates/cancellation,
guest-to-scheduler moves, unchanged weekly slots/DST, duplicates, app/calendar
races, paused/held/in-progress controls, invalid times, outages, cursor recovery,
concurrent workers and erasure cleanup. A live Google Calendar pilot is required
before activation; no production credentials or customer calendars are used by
the tests.

References: [event permissions](https://developers.google.com/workspace/calendar/api/v3/reference/events),
[event creation and attendees](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync),
[organizer OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
