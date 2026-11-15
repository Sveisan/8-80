import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { decrypt } from '../store/crypto.ts';
import type { ScriptLines } from '../script.ts';
import type { Recap } from '../recap/compose.ts';
import type { CalendarEvent } from './ical.ts';
import { describeAppointment } from '../schedule/time.ts';
import { enqueue } from '../messages/outbox.ts';
import { bookedAppointments, callInProgress } from './appointments.ts';
import { googleCalendarConfig, googleCalendarReady } from './google-config.ts';
import { googleEventId } from './google-client.ts';

interface Invitation {
  id: string; phone_hash: string; source_key: string; scheduled_at: Date; timezone: string;
  recipient_enc: string | null; sequence: number; state: string;
  provider: string; google_calendar_id: string | null; google_event_id: string | null;
  google_valid?: boolean;
  google_etag?: string | null;
}

/** Runs under the same caller lock as scheduling, settlement and STOP. */
export async function syncCalendarInvitations(sql: Database, hash: string, script: ScriptLines, now = new Date(), forceGoogle?: string, migrateWeekly = false): Promise<string[]> {
  return transaction(sql, async tx => {
    const [caller] = await tx`select calendar_invites_enabled,email_enc from callers where phone_hash = ${hash} for update`;
    if (!caller) return [];
    const enabled = caller['calendar_invites_enabled'] && caller['email_enc'];
    const appointments = enabled ? await bookedAppointments(tx, hash, now) : [];
    const activeCall = await callInProgress(tx, hash);
    const current = await tx<Invitation[]>`select * from calendar_invitations where phone_hash = ${hash} and state = 'active' order by id`;
    const ids: string[] = [];
    const queue = async (row: Invitation, method: CalendarEvent['method'], updated = false): Promise<void> => {
      if (!row.recipient_enc) return;
      const when = describeAppointment(row.scheduled_at, row.timezone);
      const fill = (key: string): string => (script.get(key) ?? '').replace('{{when}}', when).replace('{{timezone}}', row.timezone);
      const cancelled = method === 'CANCEL';
      const subject = fill(cancelled ? 'calendar.email.cancel.subject' : updated ? 'calendar.email.update.subject' : 'calendar.email.invite.subject');
      // A calendar entry can be forwarded or kept for months. Use the existing
      // authenticated account page rather than embedding a temporary access code.
      const base = config.link.publicUrl().replace(/\/$/, '');
      const action = base ? { label: fill('calendar.manage'), url: `${base}/me` } : undefined;
      const manage = action ? `${action.label}: ${action.url}` : undefined;
      const parts: Recap['parts'] = cancelled ? [{ role: 'lead', text: fill('calendar.email.cancel.body') }] : [
        { role: 'lead', text: fill('calendar.email.invite.lead') },
        { role: 'body', text: fill('calendar.email.invite.prepare') },
        { role: 'body', text: fill('calendar.email.invite.body') },
        { role: 'quiet', text: fill(row.provider === 'google' ? 'calendar.google.invite' : 'calendar.email.invite.calendar') },
      ];
      parts.push({ role: 'signoff', text: fill('email.signoff') });
      const text = [...parts.map(part => part.text), ...(manage ? [manage] : [])].join('\n\n');
      const description = [...(cancelled ? [fill('calendar.email.cancel.body')] : [fill('calendar.email.invite.lead'), fill('calendar.email.invite.prepare'), fill('calendar.event.logistics')]), ...(manage ? [manage] : [])].join('\n\n');
      const event: CalendarEvent = { uid: `${row.id}@8and80`, sequence: row.sequence, method, at: row.scheduled_at.toISOString(), stamp: now.toISOString(), timezone: row.timezone,
        title: fill('calendar.event.title'), description, location: null,
        ...(row.provider === 'google' ? {google:{calendarId:row.google_calendar_id!,eventId:row.google_event_id!,
          ...(row.id===forceGoogle && row.google_etag ? {expectedEtag:row.google_etag} : {})}} : {}) };
      if (row.provider === 'google' && !cancelled) event.description += `\n\n${fill('calendar.google.invite')}`;
      const body: Recap = { subject, body: text, parts, calendar: event, ...(action ? { action } : {}) };
      ids.push(await enqueue(tx, { eventKey: `calendar:${row.id}:${row.sequence}`, phoneHash: hash, channel: 'email', kind: 'calendar', reference: row.id,
        to: decrypt(row.recipient_enc), body, expiresAt: method === 'REQUEST' ? new Date(Math.min(+row.scheduled_at, +now + 23 * 3600_000)) : undefined }, now));
    };
    const pending = new Map(appointments.map(a => [a.key, a]));
    for (const row of current) {
      if (migrateWeekly && !activeCall && row.scheduled_at>now && row.source_key==='weekly' && row.provider==='ics' && pending.has(row.source_key)) {
        row.sequence++;
        await tx`update calendar_invitations set state='cancelled',sequence=${row.sequence},updated_at=${now} where id=${row.id}`;
        await queue(row,'CANCEL');
        continue;
      }
      // A past invitation is history, not a cancellation. Keep it while its call is settling.
      if (row.scheduled_at <= now && row.id !== forceGoogle) {
        if (row.provider === 'google' && !row.google_valid && !activeCall) {
          row.sequence++;
          await tx`update calendar_invitations set state='cancelled',sequence=${row.sequence},updated_at=${now} where id=${row.id}`;
          await queue(row,'CANCEL');
          continue;
        }
        if (!activeCall) await tx`update calendar_invitations set state = 'finished', recipient_enc = null, updated_at = ${now} where id = ${row.id}`;
        continue;
      }
      const appointment = pending.get(row.source_key);
      const addressMatches = !!row.recipient_enc && !!caller['email_enc'] && decrypt(row.recipient_enc) === decrypt(caller['email_enc']);
      if (!appointment || !addressMatches) {
        row.sequence++;
        await tx`update calendar_invitations set state = 'cancelled', sequence = ${row.sequence}, updated_at = ${now} where id = ${row.id}`;
        await queue(row, 'CANCEL');
        continue;
      }
      pending.delete(row.source_key);
      if (+row.scheduled_at !== +appointment.at || row.timezone !== appointment.timezone || row.id === forceGoogle) {
        row.sequence++; row.scheduled_at = appointment.at; row.timezone = appointment.timezone;
        // Null marks an app-origin publication; a Google-origin acknowledgment
        // retains the observed ETag so it cannot overwrite a newer guest edit.
        if (row.id!==forceGoogle) row.google_etag=null;
        await tx`update calendar_invitations set scheduled_at = ${row.scheduled_at}, timezone = ${row.timezone}, sequence = ${row.sequence},
          google_etag=${row.google_etag ?? null},google_valid = case when provider='google' then false else google_valid end, updated_at = ${now} where id = ${row.id}`;
        await queue(row, 'REQUEST', true);
      }
    }
    // Claiming advances next_call_at before the phone rings. Wait for settlement before inviting its successor.
    if (!activeCall) for (const appointment of pending.values()) {
      const google = appointment.key === 'weekly' && googleCalendarConfig().enabled;
      if (google && !googleCalendarReady()) throw new Error('Google Calendar configuration is incomplete');
      const id = randomUUID();
      const row: Invitation = { id, phone_hash: hash, source_key: appointment.key, scheduled_at: appointment.at,
        timezone: appointment.timezone, recipient_enc: caller['email_enc'], sequence: 0, state: 'active',
        provider:google ? 'google' : 'ics',google_calendar_id:google ? googleCalendarConfig().calendarId : null,google_event_id:google ? googleEventId(id) : null };
      await tx`insert into calendar_invitations (id,phone_hash,source_key,scheduled_at,timezone,recipient_enc,updated_at,provider,google_calendar_id,google_event_id)
        values (${row.id},${hash},${row.source_key},${row.scheduled_at},${row.timezone},${row.recipient_enc},${now},${row.provider},${row.google_calendar_id},${row.google_event_id})`;
      await queue(row, 'REQUEST');
    }
    await tx`update callers set calendar_synced_at = ${now} where phone_hash = ${hash}`;
    return ids;
  });
}

export async function setCalendarInvitations(sql: Database, hash: string, enabled: boolean, script: ScriptLines, now = new Date()): Promise<string[]> {
  return transaction(sql, async tx => {
    await tx`update callers set calendar_invites_enabled = ${enabled}, updated_at = ${now} where phone_hash = ${hash}`;
    return syncCalendarInvitations(tx, hash, script, now);
  });
}

/** Explicit replacement of the next legacy invitation; other programmes keep their identities. */
export async function useGoogleCalendar(sql: Database, hash: string, script: ScriptLines, now = new Date()): Promise<string[]> {
  if (!googleCalendarConfig().enabled || !googleCalendarReady()) return [];
  return await syncCalendarInvitations(sql,hash,script,now,undefined,true);
}

/** Also repairs notices after SMS scheduling, billing changes, missed webhooks or a restart. */
export async function queueCalendarInvitations(sql: Database, script: ScriptLines, now = new Date()): Promise<void> {
  const rows = await sql<{ phone_hash: string }[]>`select phone_hash from callers c where calendar_invites_enabled
    or exists (select 1 from calendar_invitations i where i.phone_hash = c.phone_hash and i.state = 'active')
    order by calendar_synced_at nulls first, phone_hash limit 50`;
  for (const row of rows) await syncCalendarInvitations(sql, row.phone_hash, script, now);
  await sql`insert into google_calendar_deletes (event_id,calendar_id,notify)
    select google_event_id,google_calendar_id,false from calendar_invitations
    where provider='google' and state <> 'active' and updated_at < ${new Date(+now - 30 * 86400_000)} on conflict do nothing`;
  await sql`delete from calendar_invitations where state <> 'active' and updated_at < ${new Date(+now - 30 * 86400_000)}`;
}
