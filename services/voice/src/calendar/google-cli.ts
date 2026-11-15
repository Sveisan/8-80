import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';
import { googleCalendarConfig, googleCalendarReady } from './google-config.ts';
import { openGoogleCalendar } from './google-client.ts';

try {
  const action=process.argv[2] ?? 'status';
  if (action==='check') {
    const google=openGoogleCalendar();
    if (!google) throw new Error('configuration');
    await google.changes(google.calendarId);
    console.log('Google Calendar API: reachable. No event was created or changed.');
  } else if(action==='status') {
    const status:Record<string,unknown>={rolloutEnabled:googleCalendarConfig().enabled,configured:googleCalendarReady()};
    if(config.database.url) {
      const store=new PostgresStore(config.database.url);
      try {
        const states=await store.raw`select last_synced_at,failed from google_calendar_sync order by calendar_id`;
        const [events]=await store.raw`select count(*)::int as active,count(*) filter(where not google_valid)::int as unconfirmed from calendar_invitations where provider='google' and state='active'`;
        const [cleanup]=await store.raw`select count(*)::int as pending from google_calendar_deletes`;
        status['calendars']=states.map(row=>({lastSyncedAt:row['last_synced_at'],failed:row['failed']}));
        status['invitations']=events;status['cleanupPending']=cleanup?.['pending'];
      } finally {await store.close();}
    }
    console.log(JSON.stringify(status,null,2));
  } else throw new Error('usage');
} catch {
  console.error('Google Calendar check unavailable. Check migration 0036 and organizer OAuth configuration; credentials and provider details are not printed.');
  process.exitCode=1;
}
