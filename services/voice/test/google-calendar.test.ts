import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {openTestDb} from './helpers/db.ts';
import {loadScript} from '../src/script.ts';
import {phoneKey} from '../src/store/postgres.ts';
import {Scheduler} from '../src/schedule/scheduler.ts';
import {setCalendarInvitations,syncCalendarInvitations,useGoogleCalendar} from '../src/calendar/invitations.ts';
import {dispatchMessages} from '../src/messages/outbox.ts';
import {GoogleCalendarMailer} from '../src/calendar/google-mailer.ts';
import {syncGoogleCalendars} from '../src/calendar/google-sync.ts';
import {GoogleCalendarError,type GoogleCalendar,type GoogleEvent,type GoogleChanges} from '../src/calendar/google-client.ts';
import {decrypt} from '../src/store/crypto.ts';
import {accountState} from '../src/link/account.ts';
import {reschedulePage} from '../src/link/page.ts';
import type {CalendarEvent} from '../src/calendar/ical.ts';
import type {LoopDeps} from '../src/loop/deps.ts';
import type {Recap} from '../src/recap/compose.ts';

const opened=await openTestDb('google_calendar');
const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const now=new Date('2026-11-15T10:00:00Z'),slot={weekday:4,minute:17*60+45,timezone:'Europe/Oslo'};
const phone='+4799000891',hash=phoneKey(phone),email='calendar@example.com',script=loadScript();
const oldAt=new Date('2026-11-19T16:45:00Z'),movedAt=new Date('2026-11-20T09:00:00Z');
let letters:Recap[],google:FakeGoogle,deps:LoopDeps;

class FakeGoogle implements GoogleCalendar {
  calendarId='organizer@example.com'; events=new Map<string,GoogleEvent>(); writes:CalendarEvent[]=[];
  removed:string[]=[]; fail=false; reads=0;
  readRequests:Array<{calendarId:string|undefined;token:string|undefined;page:string|undefined}>=[];
  async changes(calendarId?:string,token?:string,page?:string):Promise<GoogleChanges> {this.readRequests.push({calendarId,token,page});this.reads++;if(this.fail)throw new GoogleCalendarError(503);return {items:structuredClone([...this.events.values()]),nextSyncToken:'private-cursor'};}
  async publish(to:string,event:CalendarEvent) {
    this.writes.push(structuredClone(event));
    if(event.method==='CANCEL')return await this.remove(event.google!.calendarId,event.google!.eventId);
    this.events.set(event.google!.eventId,{id:event.google!.eventId,etag:`published-${event.sequence}`,status:'confirmed',organizer:{self:true},
      start:{dateTime:event.at},end:{dateTime:new Date(+new Date(event.at)+15*60_000).toISOString()},attendees:[{email:to}],
      extendedProperties:{private:{eightand80Invitation:event.uid,eightand80Sequence:String(event.sequence)}}});
  }
  async remove(_calendarId:string,eventId:string) {this.removed.push(eventId);this.events.delete(eventId);}
}
beforeEach(async()=>{
  process.env['DATA_ENCRYPTION_KEY']=Buffer.alloc(32,8).toString('base64');
  process.env['PUBLIC_URL']='https://8and80.example';
  process.env['GOOGLE_CALENDAR_ENABLED']='1';process.env['GOOGLE_CALENDAR_ID']='organizer@example.com';
  process.env['GOOGLE_CALENDAR_CLIENT_ID']='test';process.env['GOOGLE_CALENDAR_CLIENT_SECRET']='test';process.env['GOOGLE_CALENDAR_REFRESH_TOKEN']='test';
  if(!db)return;
  await db.sql`truncate unblock_incidents,callers,calendar_invitations,google_calendar_sync,google_calendar_deletes,message_outbox,message_attempts,call_attempts cascade`;
  await db.store.upsertProfile(phone,{email});
  await db.sql`update callers set billing_status='comped',onboarding='complete',call_number=2 where phone_hash=${hash}`;
  await new Scheduler(db.sql).setSlot(phone,slot,now);
  letters=[];google=new FakeGoogle();
  deps={store:db.store,scheduler:new Scheduler(db.sql),script,googleCalendar:google,agent:{} as LoopDeps['agent'],sms:{send:async()=>({id:'sms'})},
    mailer:new GoogleCalendarMailer({retryWindowMs:24*3600_000,send:async(_to,letter)=>{letters.push(letter);return {id:`email-${letters.length}`};}},google)};
});
after(async()=>db?.close());

async function create() {await setCalendarInvitations(db!.sql,hash,true,script,now);await dispatchMessages(deps,now);await syncGoogleCalendars(deps,now);}
async function moveInGoogle(at=movedAt,duration=15) {
  const [event]=google.events.values();assert(event);
  event.start={dateTime:at.toISOString()};event.end={dateTime:new Date(+at+duration*60_000).toISOString()};event.etag=`guest-${at.toISOString()}-${duration}`;
}

test('native Google invitations use one event, no second ICS email, and explain one-call moves',options,async()=>{
  await create();
  const [row]=await db!.sql`select * from calendar_invitations`;
  assert(row);
  assert.equal(row.provider,'google');assert.equal(row.google_valid,true);assert.equal(google.events.size,1);assert.equal(letters.length,0);
  assert.match(google.writes[0]!.description!,/Only this call moves; your usual weekly time stays the same/);
  assert((await accountState(db!.sql,hash,now))?.googleCalendarInvites);
  assert.match(reschedulePage(slot,script,undefined,email,undefined,{account:(await accountState(db!.sql,hash,now))!}),/Only this call moves/);
});

test('a guest move reschedules only the next call and repeated sync cannot duplicate confirmation or drift the weekly slot',options,async()=>{
  await create();const id=google.writes[0]!.google!.eventId;
  await moveInGoogle();
  await syncGoogleCalendars(deps,new Date(+now+60_000));
  await syncGoogleCalendars(deps,new Date(+now+120_000));
  let [caller]=await db!.sql`select * from callers where phone_hash=${hash}`;
  assert(caller);
  assert.equal(caller.next_call_at.toISOString(),movedAt.toISOString());
  assert.equal(caller.slot_weekday,slot.weekday);assert.equal(caller.slot_minute,slot.minute);assert.equal(caller.timezone,slot.timezone);
  assert.equal((await db!.sql`select * from message_outbox where kind='calendar-notice'`).length,1);
  const [row]=await db!.sql`select * from calendar_invitations`;
  assert(row);
  assert.equal(row.sequence,1);assert.equal(row.google_event_id,id);
  await dispatchMessages(deps,new Date(+now+120_000));await syncGoogleCalendars(deps,new Date(+now+180_000));
  assert.equal(google.events.size,1);assert.equal(letters.length,1);assert.equal(letters[0]!.calendar,undefined);
  assert.match(letters[0]!.body,/Friday 20 November at 10:00 CET/);
  assert.match(letters[0]!.body,/usual weekly time stays the same/);
  await syncGoogleCalendars(deps,oldAt);assert.equal((await deps.scheduler.claimDue(oldAt)).length,0);
  await syncGoogleCalendars(deps,movedAt);const [claim]=await deps.scheduler.claimDue(movedAt);assert(claim);
  assert.equal(claim.nextCallAt.toISOString(),'2026-11-26T16:45:00.000Z');
  [caller]=await db!.sql`select * from callers where phone_hash=${hash}`;assert(caller);assert.equal(caller.slot_minute,slot.minute);
});

test('a calendar move received at the original due time beats claiming that call',options,async()=>{
  await create();const later=new Date(+oldAt+3600_000);await moveInGoogle(later);
  await syncGoogleCalendars(deps,oldAt);
  const [caller]=await db!.sql`select next_call_at from callers where phone_hash=${hash}`;
  assert(caller);
  assert.equal(caller.next_call_at.toISOString(),later.toISOString());assert.equal((await deps.scheduler.claimDue(oldAt)).length,0);
  assert.equal((await db!.sql`select * from calendar_invitations where state='active'`).length,1);
});

test('DST moves preserve the fixed booking timezone and the ordinary weekly slot',options,async()=>{
  await create();const at=new Date('2027-03-28T08:00:00Z');await moveInGoogle(at);
  await syncGoogleCalendars(deps,new Date(+now+60_000));await dispatchMessages(deps,new Date(+now+60_000));
  assert.match(letters[0]!.body,/10:00 CEST/);
  const [caller]=await db!.sql`select slot_weekday,slot_minute,timezone from callers where phone_hash=${hash}`;
  assert.deepEqual({...caller}, {slot_weekday:4,slot_minute:1065,timezone:'Europe/Oslo'});
});

test('a guest calendar timezone changes the instant, not the stored weekly timezone',options,async()=>{
  await create();const [event]=google.events.values();assert(event);
  event.start={dateTime:'2026-11-20T09:00:00-05:00'};event.end={dateTime:'2026-11-20T09:15:00-05:00'};event.etag='new-york';
  await syncGoogleCalendars(deps,new Date(+now+60_000));
  const [caller]=await db!.sql`select next_call_at,timezone,slot_minute from callers where phone_hash=${hash}`;assert(caller);
  assert.equal(caller.next_call_at.toISOString(),'2026-11-20T14:00:00.000Z');assert.equal(caller.timezone,'Europe/Oslo');assert.equal(caller.slot_minute,slot.minute);
});

test('invalid duration, all-day and too-soon edits restore the saved time once without moving the caller',options,async()=>{
  await create();await moveInGoogle(movedAt,30);
  await syncGoogleCalendars(deps,new Date(+now+60_000));await dispatchMessages(deps,new Date(+now+60_000));
  const [caller]=await db!.sql`select next_call_at from callers where phone_hash=${hash}`;
  assert(caller);
  assert.equal(caller.next_call_at.toISOString(),oldAt.toISOString());assert.equal(letters.length,1);
  assert.match(letters[0]!.body,/couldn't apply that calendar change/);
  assert.equal(google.writes.at(-1)!.at,oldAt.toISOString());
  await syncGoogleCalendars(deps,new Date(+now+120_000));await dispatchMessages(deps,new Date(+now+120_000));assert.equal(letters.length,1);
  const [event]=google.events.values();event!.start={};event!.end={};event!.etag='all-day';
  await syncGoogleCalendars(deps,new Date(+now+180_000));await dispatchMessages(deps,new Date(+now+180_000));
  assert.equal(google.writes.at(-1)!.at,oldAt.toISOString());
  await moveInGoogle(new Date(+now+200_000));await syncGoogleCalendars(deps,new Date(+now+190_000));
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),oldAt.toISOString());
});

test('an app move pending publication wins over an older Google revision',options,async()=>{
  await create();const appAt=new Date('2026-11-21T12:00:00Z');
  await deps.scheduler.moveIfActive(phone,appAt);await syncCalendarInvitations(db!.sql,hash,script,new Date(+now+60_000));
  await moveInGoogle();await syncGoogleCalendars(deps,new Date(+now+120_000));
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),appAt.toISOString());
  assert.equal((await db!.sql`select * from message_outbox where kind='calendar-notice'`).length,0);
  await dispatchMessages(deps,new Date(+now+120_000));assert.equal(google.writes.at(-1)!.at,appAt.toISOString());
});

test('another app move suppresses the old guest-move confirmation and stale calendar revision',options,async()=>{
  await create();await moveInGoogle();await syncGoogleCalendars(deps,new Date(+now+60_000));
  const appAt=new Date('2026-11-21T12:00:00Z');await deps.scheduler.moveIfActive(phone,appAt);
  await syncCalendarInvitations(db!.sql,hash,script,new Date(+now+120_000));await dispatchMessages(deps,new Date(+now+120_000));
  assert.equal(letters.length,0);assert.equal(google.writes.at(-1)!.at,appAt.toISOString());
  assert.equal((await db!.sql`select status from message_outbox where kind='calendar-notice'`)[0]!.status,'suppressed');
});

test('a second guest move before publication supersedes the first move and its confirmation',options,async()=>{
  await create();await moveInGoogle();await syncGoogleCalendars(deps,new Date(+now+60_000));
  const later=new Date('2026-11-21T12:00:00Z');await moveInGoogle(later);
  await syncGoogleCalendars(deps,new Date(+now+120_000));await dispatchMessages(deps,new Date(+now+120_000));
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),later.toISOString());
  assert.equal(google.events.size,1);assert.equal(google.writes.at(-1)!.at,later.toISOString());assert.equal(letters.length,1);assert.match(letters[0]!.body,/Saturday 21 November/);
});

test('Google edits cannot revive paused, held, opted-out, in-progress or wrong-recipient calls',options,async()=>{
  await create();await db!.sql`update callers set paused=true where phone_hash=${hash}`;await moveInGoogle();
  await syncGoogleCalendars(deps,new Date(+now+60_000));
  assert.equal((await db!.sql`select paused,next_call_at from callers where phone_hash=${hash}`)[0]!.paused,true);
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),oldAt.toISOString());
  assert.equal(letters.length,0);
  await db!.sql`update callers set paused=false,held_for_review=true where phone_hash=${hash}`;
  await syncGoogleCalendars(deps,new Date(+now+120_000));
  await db!.sql`update callers set held_for_review=false where phone_hash=${hash}`;
  await db!.sql`update callers set sms_opt_out=true where phone_hash=${hash}`;
  await syncGoogleCalendars(deps,new Date(+now+120_000));
  await db!.sql`update callers set sms_opt_out=false,calendar_invites_enabled=false where phone_hash=${hash}`;
  await syncGoogleCalendars(deps,new Date(+now+120_000));
  await db!.sql`update callers set calendar_invites_enabled=true where phone_hash=${hash}`;
  await db!.sql`insert into call_attempts (id,phone_hash,scheduled_for,status) values ('in-progress',${hash},${oldAt},'claimed')`;
  await syncGoogleCalendars(deps,new Date(+now+180_000));
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),oldAt.toISOString());
  await db!.sql`delete from call_attempts where id='in-progress'`;
  const [event]=google.events.values();event!.attendees=[{email:'someone-else@example.com'}];event!.etag='wrong-recipient';
  await syncGoogleCalendars(deps,new Date(+now+240_000));
  assert.equal((await db!.sql`select next_call_at from callers where phone_hash=${hash}`)[0]!.next_call_at.toISOString(),oldAt.toISOString());
});

test('Google outage or missing OAuth gates native calls while unrelated legacy calls remain eligible',options,async()=>{
  await create();const other='+4799000892';await db!.store.upsertProfile(other,{email:'legacy@example.com'});
  await db!.sql`update callers set billing_status='comped' where phone_hash=${phoneKey(other)}`;
  await new Scheduler(db!.sql).setSlot(other,slot,now);
  google.fail=true;await syncGoogleCalendars(deps,oldAt);
  const claims=await deps.scheduler.claimDue(oldAt);assert.equal(claims.length,1);assert.equal(claims[0]!.phoneHash,phoneKey(other));
  const [event]=await db!.sql`select google_valid from calendar_invitations`;assert(event);assert.equal(event.google_valid,true);
  assert.equal((await db!.sql`select * from call_attempts where phone_hash=${hash}`).length,0);
  google.fail=false;await syncGoogleCalendars(deps,oldAt);
  const missing={...deps};delete missing.googleCalendar;await syncGoogleCalendars(missing,oldAt);
  assert.equal((await deps.scheduler.claimDue(oldAt)).length,0);
});

test('expired sync cursors restart a full scan, preserve identity and encrypt the replacement cursor',options,async()=>{
  await create();const changes=google.changes.bind(google);let calls=0;
  google.changes=async()=>{if(calls++===0)throw new GoogleCalendarError(410);return await changes();};
  await syncGoogleCalendars(deps,new Date(+now+60_000));assert.equal(calls,2);
  const [state]=await db!.sql`select * from google_calendar_sync`;assert(state);assert.equal(state.failed,false);
  assert.notEqual(state.sync_token_enc,'private-cursor');assert.equal(decrypt(state.sync_token_enc),'private-cursor');
  assert.equal(google.events.size,1);assert.equal(letters.length,0);
});

test('an interrupted multi-page sync preserves its cursor and replay does not duplicate a previously applied move',options,async()=>{
  await create();await moveInGoogle();const event=structuredClone([...google.events.values()][0]!);const pages:string[]=[];
  google.changes=async(_calendarId,token,page)=>{
    assert.equal(token,'private-cursor');pages.push(page??'first');
    if(!page)return {items:[event],nextPageToken:'second'};
    throw new GoogleCalendarError(503);
  };
  await syncGoogleCalendars(deps,new Date(+now+60_000));
  let [state]=await db!.sql`select * from google_calendar_sync`;assert(state);assert.equal(state.failed,true);assert.equal(decrypt(state.sync_token_enc),'private-cursor');
  google.changes=async(_calendarId,token,page)=>{assert.equal(token,'private-cursor');pages.push(page??'first');return page?{items:[],nextSyncToken:'complete-cursor'}:{items:[event],nextPageToken:'second'};};
  await syncGoogleCalendars(deps,new Date(+now+120_000));
  [state]=await db!.sql`select * from google_calendar_sync`;assert(state);assert.equal(state.failed,false);assert.equal(decrypt(state.sync_token_enc),'complete-cursor');
  assert.deepEqual(pages,['first','second','first','second']);assert.equal((await db!.sql`select * from message_outbox where kind='calendar-notice'`).length,1);
});

test('a damaged encrypted cursor triggers a full scan without taking unrelated callers down',options,async()=>{
  await create();await db!.sql`update google_calendar_sync set sync_token_enc='damaged'`;
  await syncGoogleCalendars(deps,new Date(+now+60_000));
  assert.equal((await db!.sql`select failed from google_calendar_sync`)[0]!.failed,false);
});

test('parallel sync workers use one lease and do not duplicate incoming moves',options,async()=>{
  await create();await moveInGoogle();const before=google.reads;
  let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const changes=google.changes.bind(google);
  google.changes=async()=>{entered();await pending;return await changes();};
  const first=syncGoogleCalendars(deps,new Date(+now+60_000));await started;
  await syncGoogleCalendars(deps,new Date(+now+60_000));release();await first;
  assert.equal(google.reads-before,1);assert.equal((await db!.sql`select * from message_outbox where kind='calendar-notice'`).length,1);
});

test('legacy invitations stay ICS after enabling Google and existing Google invitations still cancel with rollout disabled',options,async()=>{
  process.env['GOOGLE_CALENDAR_ENABLED']='0';await setCalendarInvitations(db!.sql,hash,true,script,now);
  process.env['GOOGLE_CALENDAR_ENABLED']='1';await deps.scheduler.moveIfActive(phone,movedAt);await syncCalendarInvitations(db!.sql,hash,script,now);
  await dispatchMessages(deps,now);assert.equal(google.writes.length,0);assert.equal(letters.length,1);assert.equal(letters[0]!.calendar?.google,undefined);
  await setCalendarInvitations(db!.sql,hash,false,script,now);await dispatchMessages(deps,now);
  await setCalendarInvitations(db!.sql,hash,true,script,now);await dispatchMessages(deps,now);assert.equal(google.events.size,1);
  process.env['GOOGLE_CALENDAR_ENABLED']='0';await setCalendarInvitations(db!.sql,hash,false,script,now);await dispatchMessages(deps,now);
  assert.equal(google.events.size,0);assert.equal(google.removed.length,1);
});

test('the explicit Google upgrade cancels only the old weekly invitation, preserves the slot and is idempotent',options,async()=>{
  process.env['GOOGLE_CALENDAR_ENABLED']='0';await setCalendarInvitations(db!.sql,hash,true,script,now);await dispatchMessages(deps,now);
  const [old]=await db!.sql`select * from calendar_invitations`;assert(old);
  process.env['GOOGLE_CALENDAR_ENABLED']='1';
  assert.match(reschedulePage(slot,script,undefined,email,undefined,{account:(await accountState(db!.sql,hash,now))!}),/value="calendar-google"/);
  const ids=await useGoogleCalendar(db!.sql,hash,script,now);assert.equal(ids.length,2);
  await dispatchMessages(deps,now);
  const rows=await db!.sql`select * from calendar_invitations where state='active'`;assert.equal(rows.length,1);assert.equal(rows[0]!.provider,'google');
  assert.notEqual(rows[0]!.id,old.id);assert.equal(letters.at(-1)!.calendar!.method,'CANCEL');
  assert.equal(letters.at(-1)!.calendar!.uid,`${old.id}@8and80`);assert.equal(google.events.size,1);
  assert.equal((await useGoogleCalendar(db!.sql,hash,script,now)).length,0);
  const [caller]=await db!.sql`select next_call_at,slot_weekday,slot_minute,timezone from callers where phone_hash=${hash}`;assert(caller);
  assert.equal(caller.next_call_at.toISOString(),oldAt.toISOString());assert.equal(caller.slot_minute,slot.minute);
});

test('an explicit upgrade does not cancel an invitation for a call already in progress',options,async()=>{
  process.env['GOOGLE_CALENDAR_ENABLED']='0';await setCalendarInvitations(db!.sql,hash,true,script,now);await dispatchMessages(deps,now);
  await db!.sql`insert into call_attempts (id,phone_hash,scheduled_for,status) values ('active-upgrade',${hash},${oldAt},'active')`;
  process.env['GOOGLE_CALENDAR_ENABLED']='1';assert.deepEqual(await useGoogleCalendar(db!.sql,hash,script,oldAt),[]);
  assert.equal((await db!.sql`select state from calendar_invitations`)[0]!.state,'active');
});

test('erasure leaves only an opaque provider cleanup task and the next sync removes the organizer event',options,async()=>{
  await create();const id=google.writes[0]!.google!.eventId;await db!.store.forget(phone);
  const [cleanup]=await db!.sql`select * from google_calendar_deletes`;assert(cleanup);assert.equal(cleanup.event_id,id);assert.equal(cleanup.phone_hash,undefined);assert.equal(cleanup.email_enc,undefined);
  await syncGoogleCalendars(deps,new Date(+now+60_000));assert.deepEqual(google.removed,[id]);
  assert.equal((await db!.sql`select * from google_calendar_deletes`).length,0);assert.equal(google.events.size,0);
});

test('a missing or foreign organizer event cannot silently place a call at the obsolete time',options,async()=>{
  await create();const [event]=google.events.values();event!.status='cancelled';event!.etag='removed';
  await syncGoogleCalendars(deps,oldAt);assert.equal((await deps.scheduler.claimDue(oldAt)).length,0);
  assert.equal((await db!.sql`select google_valid from calendar_invitations`)[0]!.google_valid,false);
});
