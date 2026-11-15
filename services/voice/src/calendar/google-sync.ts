import { createHash, randomUUID } from 'node:crypto';
import type { LoopDeps } from '../loop/deps.ts';
import type { Database } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { Scheduler } from '../schedule/scheduler.ts';
import { describeAppointment } from '../schedule/time.ts';
import { enqueue } from '../messages/outbox.ts';
import { syncCalendarInvitations } from './invitations.ts';
import { callInProgress } from './appointments.ts';
import { GoogleCalendarError, publishedSequence, type GoogleEvent } from './google-client.ts';
import { log } from '../log.ts';
import { config } from '../config.ts';

interface Invitation {
  id:string; phone_hash:string; sequence:number; scheduled_at:Date; timezone:string;
  source_key:string; recipient_enc:string|null; google_etag:string|null; google_valid:boolean;
  phone_enc:string|null; email_enc:string|null; next_call_at:Date|null; calendar_invites_enabled:boolean;
  paused:boolean; all_calls_stopped:boolean; held_for_review:boolean; sms_opt_out:boolean;
}

async function notice(sql: Database, row: Invitation, event: GoogleEvent, deps: LoopDeps, result: 'moved'|'rejected', now: Date): Promise<void> {
  if (!row.recipient_enc) return;
  const when = describeAppointment(row.scheduled_at,row.timezone);
  const copy = result==='rejected' && row.scheduled_at<=now ? 'calendar.google.late' : `calendar.google.${result}`;
  const lead = (deps.script.get(copy) ?? '').replace('{{when}}',when);
  const signoff = deps.script.get('email.signoff') ?? '';
  const action = {label:deps.script.get('calendar.manage') ?? '',url:`${configOrigin()}/me`};
  const revision = createHash('sha256').update(event.etag ?? JSON.stringify(event)).digest('hex');
  await enqueue(sql,{eventKey:`google-calendar:${row.id}:${revision}:notice`,phoneHash:row.phone_hash,channel:'email',kind:'calendar-notice',reference:row.id,
    to:decrypt(row.recipient_enc),body:{subject:deps.script.get('calendar.email.update.subject') ?? '',
      parts:[{role:'lead',text:lead},{role:'signoff',text:signoff}],action,body:`${lead}\n\n${signoff}\n\n${action.label}: ${action.url}`}},now);
}

const configOrigin = (): string => config.link.publicUrl().replace(/\/$/,'');
const instant = (value: unknown): Date | undefined => typeof value==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : undefined;

/** A notification or a calendar field is not authority to select a customer. */
async function applyChange(deps: LoopDeps, calendarId: string, event: GoogleEvent, now: Date): Promise<void> {
  await deps.store.raw.begin(async tx => {
    const [row] = await tx<Invitation[]>`select i.*,c.phone_enc,c.email_enc,c.next_call_at,c.calendar_invites_enabled,c.paused,c.all_calls_stopped,c.held_for_review,c.sms_opt_out
      from calendar_invitations i join callers c on c.phone_hash=i.phone_hash
      where i.provider='google' and i.google_calendar_id=${calendarId} and i.google_event_id=${event.id} and i.state='active'
      for update of c`;
    if (!row || (event.etag && row.google_etag===event.etag && row.google_valid)) return;
    const remember = async (valid: boolean): Promise<void> => {
      await tx`update calendar_invitations set google_etag=${event.etag ?? null},google_valid=${valid} where id=${row.id}`;
    };
    if (event.status==='cancelled' || event.organizer?.self!==true
      || event.extendedProperties?.private?.['eightand80Invitation']!==`${row.id}@8and80`
      || !row.recipient_enc || !event.attendees?.some(a=>a.email?.toLowerCase()===decrypt(row.recipient_enc!).toLowerCase())) {
      await remember(false); return;
    }
    const sequence = publishedSequence(event);
    const newerGuestEdit = !row.google_valid && !!row.google_etag && !!event.etag && event.etag!==row.google_etag && sequence!==undefined && sequence<row.sequence;
    if (sequence!==row.sequence && !newerGuestEdit) {
      // Preserve null for a pending app operation; merely seeing its old
      // Google copy must not turn it into a guest-origin update.
      await tx`update calendar_invitations set google_valid=false where id=${row.id}`;
      // Rebuild a lost/expired outbound operation, but never defeat a pending app edit.
      const [pending] = await tx`select id from message_outbox where reference=${row.id} and kind='calendar' and status in ('pending','sending') limit 1`;
      if (!pending && sequence!==undefined && sequence<row.sequence) await syncCalendarInvitations(tx,row.phone_hash,deps.script,now,row.id);
      return;
    }
    const start = instant(event.start?.dateTime);
    const end = instant(event.end?.dateTime);
    const durationOkay = !!start && !!end && Number.isFinite(+start) && +end-+start===15*60_000 && !event.recurrence?.length && !event.recurringEventId;
    if (durationOkay && +start! === +row.scheduled_at) { await remember(true); return; }
    await remember(false);
    if (row.source_key!=='weekly' || row.paused || row.all_calls_stopped || row.held_for_review || row.sms_opt_out || !row.calendar_invites_enabled || !row.phone_enc || !row.email_enc
      || decrypt(row.email_enc)!==decrypt(row.recipient_enc) || !row.next_call_at || +row.next_call_at !== +row.scheduled_at || await callInProgress(tx,row.phone_hash)) return;
    const canMove = durationOkay && +start! >= +now+2*60_000
      && await new Scheduler(tx).moveIfActive(decrypt(row.phone_enc),start!);
    if (canMove) {
      // No weekly argument: only next_call_at changes; the fixed slot and zone survive.
      await syncCalendarInvitations(tx,row.phone_hash,deps.script,now,row.id);
      row.scheduled_at=start!;
      await notice(tx,row,event,deps,'moved',now);
    } else {
      // Restore a future invitation through the same versioned outbox as app changes.
      // A removed/late/unverifiable event stays blocked until it can be reconciled.
      if (row.scheduled_at>now) await syncCalendarInvitations(tx,row.phone_hash,deps.script,now,row.id);
      await notice(tx,row,event,deps,'rejected',now);
    }
  });
}

/** Minute-based incremental sync also catches changes made while the service was down. */
export async function syncGoogleCalendars(deps: LoopDeps, now = new Date()): Promise<void> {
  const google = deps.googleCalendar;
  if (!google) {
    await deps.store.raw`update google_calendar_sync set failed=true where failed=false`;
    return;
  }
  const calendars = new Set([google.calendarId]);
  for (const row of await deps.store.raw`select distinct google_calendar_id from calendar_invitations where provider='google' and state='active'`) calendars.add(row['google_calendar_id'] as string);
  for (const calendarId of calendars) {
    const leaseId = randomUUID();
    await deps.store.raw`insert into google_calendar_sync (calendar_id) values (${calendarId}) on conflict do nothing`;
    const [state] = await deps.store.raw<{sync_token_enc:string|null}[]>`update google_calendar_sync
      set lease_id=${leaseId},lease_until=${new Date(+now+5*60_000)},failed=true
      where calendar_id=${calendarId} and (lease_until is null or lease_until<=${now}) returning sync_token_enc`;
    if (!state) continue;
    let token: string|undefined;
    try {token=state.sync_token_enc ? decrypt(state.sync_token_enc) : undefined;}
    catch { /* A damaged cursor is recoverable with a fresh organizer scan. */ }
    let page: string|undefined, reset = false;
    try {
      if (!token) await deps.store.raw`update calendar_invitations set google_valid=false where provider='google' and google_calendar_id=${calendarId} and state='active'`;
      for (let pages=0; ; pages++) {
        if (pages>=100) throw new Error('Calendar sync page limit');
        let result;
        try { result=await google.changes(calendarId,token,page); }
        catch(error) {
          if (error instanceof GoogleCalendarError && error.status===410 && !reset) {
            token=undefined;page=undefined;reset=true;
            await deps.store.raw`update calendar_invitations set google_valid=false where provider='google' and google_calendar_id=${calendarId} and state='active'`;
            continue;
          }
          throw error;
        }
        const [owned] = await deps.store.raw`update google_calendar_sync set lease_until=${new Date(Date.now()+5*60_000)} where calendar_id=${calendarId} and lease_id=${leaseId} returning calendar_id`;
        if (!owned) throw new Error('Calendar sync lease lost');
        for (const event of result.items ?? []) await applyChange(deps,calendarId,event,now);
        if (result.nextPageToken) {page=result.nextPageToken;continue;}
        if (!result.nextSyncToken) throw new Error('Missing calendar sync cursor');
        await deps.store.raw`update google_calendar_sync set sync_token_enc=${encrypt(result.nextSyncToken)},last_synced_at=${now},failed=false
          where calendar_id=${calendarId} and lease_id=${leaseId}`;
        break;
      }
    } catch { log('calendar.google.sync_unavailable',{}); }
    finally {
      await deps.store.raw`update google_calendar_sync set lease_id=null,lease_until=null where calendar_id=${calendarId} and lease_id=${leaseId}`;
    }
  }
  // Account deletion must not leave the organizer's attendee copy behind.
  const deletions = await deps.store.raw`select * from google_calendar_deletes order by created_at limit 20`;
  for (const row of deletions) {
    try {
      await google.remove(row['calendar_id'] as string,row['event_id'] as string,row['notify'] as boolean);
      await deps.store.raw`delete from google_calendar_deletes where event_id=${row['event_id']}`;
    } catch { log('calendar.google.cleanup_pending',{}); }
  }
}
