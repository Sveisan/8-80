import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleCalendarClient,GoogleCalendarError} from '../src/calendar/google-client.ts';
import {googleCalendarReady} from '../src/calendar/google-config.ts';
import type {CalendarEvent} from '../src/calendar/ical.ts';
import {ResendMailer} from '../src/recap/resend.ts';

const event:CalendarEvent={uid:'one@8and80',sequence:0,method:'REQUEST',at:'2026-11-20T09:00:00Z',stamp:'2026-11-15T10:00:00Z',timezone:'Europe/Oslo',
  title:'8&80 call',description:'Generic invitation',location:null,google:{calendarId:'organizer@example.com',eventId:'e1234567890'}};
const current=(sequence=0,at=event.at)=>({id:event.google!.eventId,etag:'etag-1',status:'confirmed',organizer:{self:true},
  start:{dateTime:at},end:{dateTime:new Date(+new Date(at)+15*60_000).toISOString()},
  extendedProperties:{private:{eightand80Invitation:event.uid,eightand80Sequence:String(sequence)}}});

function api(responses:Response[]) {
  const requests:Array<{url:URL;init:RequestInit}> = [];
  const client=new GoogleCalendarClient('organizer@example.com',async()=>'test-token',async(input,init)=>{
    requests.push({url:new URL(String(input)),init:init!});const response=responses.shift();assert(response,'Unexpected provider request');return response;
  });
  return {client,requests};
}

test('native creation grants event editing, uses a deterministic ID, notifies guests and never creates recurrence',async()=>{
  const {client,requests}=api([new Response('',{status:404}),Response.json(current())]);
  await client.publish('guest@example.com',event);
  const request=requests[1]!,body=JSON.parse(request.init.body as string);
  assert.equal(request.init.method,'POST');assert.equal(request.url.origin,'https://www.googleapis.com');assert.equal(request.url.searchParams.get('sendUpdates'),'all');
  assert.equal(body.id,event.google!.eventId);assert.equal(body.guestsCanModify,true);assert.equal(body.visibility,'private');
  assert.deepEqual(body.attendees,[{email:'guest@example.com'}]);assert.equal(body.recurrence,undefined);assert.equal(body.location,undefined);
  assert.equal(body.extendedProperties.private.eightand80Invitation,event.uid);
});

test('a retry after provider acceptance does not undo a guest move or send another invitation',async()=>{
  const {client,requests}=api([Response.json(current(0,'2026-11-21T09:00:00Z'))]);
  await client.publish('guest@example.com',event);assert.equal(requests.length,1);
});

test('an app reschedule uses If-Match, preserves guest responses and notifies the guest',async()=>{
  const {client,requests}=api([Response.json(current()),Response.json({})]);
  await client.publish('guest@example.com',{...event,sequence:1,at:'2026-11-21T09:00:00Z'});
  assert.equal(requests[1]!.init.method,'PATCH');assert.equal((requests[1]!.init.headers as Record<string,string>)['If-Match'],'etag-1');
  assert.equal(JSON.parse(requests[1]!.init.body as string).attendees,undefined);
  assert.equal(requests[1]!.url.searchParams.get('sendUpdates'),'all');
});

test('repairing an all-day or recurring edit explicitly clears its date and recurrence fields',async()=>{
  const allDay={...current(),start:{date:'2026-11-20'},end:{date:'2026-11-21'},recurrence:['RRULE:FREQ=WEEKLY']};
  const {client,requests}=api([Response.json(allDay),Response.json({})]);
  await client.publish('guest@example.com',{...event,sequence:1});
  const body=JSON.parse(requests[1]!.init.body as string);
  assert.equal(body.start.date,null);assert.equal(body.end.date,null);assert.deepEqual(body.recurrence,[]);
});

test('acknowledging a guest move updates its private revision without emailing a second calendar invitation',async()=>{
  const {client,requests}=api([Response.json(current()),Response.json({})]);
  await client.publish('guest@example.com',{...event,sequence:1});
  assert.equal(requests[1]!.url.searchParams.get('sendUpdates'),'none');
  assert.equal(JSON.parse(requests[1]!.init.body as string).extendedProperties.private.eightand80Sequence,'1');
});

test('a pending guest acknowledgment cannot overwrite a second guest move made before publication',async()=>{
  const newer=current(0,'2026-11-21T09:00:00Z');newer.etag='newer-guest';
  const {client,requests}=api([Response.json(newer)]);
  await assert.rejects(client.publish('guest@example.com',{...event,sequence:1,google:{...event.google!,expectedEtag:'first-guest'}}),error=>error instanceof GoogleCalendarError && error.status===412);
  assert.equal(requests.length,1);
});

test('cancellation is idempotent when the provider event is already gone',async()=>{
  const {client,requests}=api([new Response('',{status:410})]);
  await client.publish('guest@example.com',{...event,method:'CANCEL',sequence:1});
  assert.equal(requests[0]!.init.method,'DELETE');assert.equal(requests[0]!.url.searchParams.get('sendUpdates'),'all');
});

test('an event-ID collision is rejected even if the foreign event has a higher revision',async()=>{
  const foreign=current(20);foreign.extendedProperties.private.eightand80Invitation='another@8and80';
  const {client,requests}=api([Response.json(foreign)]);
  await assert.rejects(client.publish('guest@example.com',event),/identity mismatch/);assert.equal(requests.length,1);
});

test('conflicts are retriable and provider error bodies never enter the error',async()=>{
  const {client}=api([Response.json(current()),new Response('private-address-and-provider-details',{status:412})]);
  await assert.rejects(client.publish('guest@example.com',{...event,sequence:1}),error=>error instanceof GoogleCalendarError && error.disposition==='retry' && !error.message.includes('private-address'));
});

test('incremental sync retains deleted entries and passes cursor and page tokens without a changing time filter',async()=>{
  const {client,requests}=api([Response.json({items:[{id:'deleted',status:'cancelled'}],nextSyncToken:'next'})]);
  const result=await client.changes('organizer@example.com','cursor','page');
  assert.equal(result.items![0]!.status,'cancelled');const query=requests[0]!.url.searchParams;
  assert.equal(query.get('syncToken'),'cursor');assert.equal(query.get('pageToken'),'page');assert.equal(query.get('showDeleted'),'true');assert.equal(query.has('timeMin'),false);
});

test('organizer configuration requires a stable explicit calendar and a complete OAuth credential set',()=>{
  const env={GOOGLE_CALENDAR_CLIENT_ID:'id',GOOGLE_CALENDAR_CLIENT_SECRET:'secret',GOOGLE_CALENDAR_REFRESH_TOKEN:'refresh',GOOGLE_CALENDAR_ID:'organizer@example.com'};
  assert(googleCalendarReady(env));assert(!googleCalendarReady({...env,GOOGLE_CALENDAR_ID:'primary'}));assert(!googleCalendarReady({...env,GOOGLE_CALENDAR_REFRESH_TOKEN:''}));
});

test('a disconnected native calendar can never fall back to a duplicate ICS invitation',async()=>{
  const mailer=new ResendMailer('unused','8&80 <calls@example.com>');
  await assert.rejects(mailer.send('guest@example.com',{subject:'Call',body:'Call',parts:[],calendar:event}),/a second ICS invitation was not sent/);
});
