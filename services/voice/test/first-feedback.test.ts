import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { SpeechifyAgent } from '../src/agent/speechify.ts';
import { femaleVoiceReady } from '../src/agent/voices.ts';
import { readSignup } from '../src/signup/form.ts';
import { Pending } from '../src/signup/pending.ts';
import { nextNudgeAfter, nudgeWindow, queueDueNudges, setNudges } from '../src/sms/nudges.ts';
import { dispatchMessages, dispatchMessage, enqueue } from '../src/messages/outbox.ts';
import { controlPlane } from '../src/control.ts';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { tick } from '../src/loop/tick.ts';

const opened = await openTestDb('first_feedback');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const now = new Date('2026-11-03T11:00:00Z');
const phone = '+4791000100';
const hash = phoneKey(phone);
const script = loadScript();
let texts: string[] = [];
const wire: Record<string, unknown>[] = [];
const fetcher: typeof fetch = async (_input, init) => { wire.push(JSON.parse(String(init?.body))); return Response.json({conversation_id:`synthetic-${wire.length}`}); };
const agent = () => new SpeechifyAgent('synthetic', 'male-return', 'male-first', 'https://synthetic.example', undefined, fetcher);
const deps = (): LoopDeps => ({store:db!.store, scheduler:new Scheduler(db!.sql), agent:agent(), script, mailer:{send:async()=>undefined}, sms:{send:async(_to, body)=>{texts.push(body);return {id:'synthetic'};}}});
const form = (extra: Record<string, string> = {}) => new URLSearchParams({name:'Synthetic', phone, email:'test@example.com', weekday:'2', time:'12:00', timezone:'Europe/Oslo', ...extra});

beforeEach(async () => {
  Object.assign(process.env, {DATA_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'), PUBLIC_URL:'https://8and80.example', SIGNUP_OPEN:'1', TWILIO_ACCOUNT_SID:'test', TWILIO_AUTH_TOKEN:'test',
    SMS_FROM_NUMBER:'+4791000000', SPEECHIFY_CALLER_ID_NUMBER:'+4791000000', SPEECHIFY_AGENT_ID:'male-return', SPEECHIFY_FIRST_CALL_AGENT_ID:'male-first',
    SPEECHIFY_FEMALE_AGENT_ID:'female-return', SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID:'female-first'});
  texts=[]; wire.length=0;
  if (db) await db.sql`truncate product_feedback,belief_sessions,unblock_sessions, belief_refund_requests, belief_enrollments,unblock_enrollments, journey_events, journey_counts, message_attempts, message_outbox, callers, links, signups, call_attempts`;
});
after(async()=>{await db?.close();});

test('both female call stages use dedicated agents; male and legacy profiles retain the existing pair', async () => {
  const a=agent();
  for (const firstCall of [true,false]) {
    await a.placeCall({to:phone, firstCall, voice:'female', callerIdNumber:'+4791000000'});
    assert.equal(wire.at(-1)!['agent_id'], firstCall?'female-first':'female-return');
    assert.equal(wire.at(-1)!['caller_id_number'],'+4791000000');
    await a.placeCall({to:phone,firstCall,voice:'male'});
    assert.equal(wire.at(-1)!['agent_id'],firstCall?'male-first':'male-return');
  }
  await a.placeCall({to:phone});assert.equal(wire.at(-1)!['agent_id'],'male-return');
  delete process.env['SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID'];
  assert.equal(femaleVoiceReady(),false);
  const count=wire.length;
  await assert.rejects(a.placeCall({to:phone,voice:'female'}),/not configured/);
  assert.equal(wire.length,count,'no wrong-voice fallback or provider request');
});

test('signup validates available voices and optional texts without changing legacy submissions', () => {
  assert.equal(readSignup(form({voice:'female',nudges:'yes'})).ok,true);
  const legacy=readSignup(form());assert.ok(legacy.ok);assert.equal(legacy.signup.voice,undefined);assert.equal(legacy.signup.nudges,undefined);
  assert.equal(readSignup(form({voice:'invented'})).ok,false);
  process.env['SPEECHIFY_FEMALE_AGENT_ID']='male-return';
  assert.equal(readSignup(form({voice:'female'})).ok,false);
  process.env['SMS_FROM_NUMBER']='+4791000001';
  assert.equal(readSignup(form({nudges:'yes'})).ok,false);
});

test('varying daytime slots use local calendar days through DST and do not reroll per tick', () => {
  for (const zone of ['Europe/Oslo','America/New_York','Australia/Sydney','Asia/Kolkata']) for (const at of ['2026-03-27T12:00:00Z','2026-10-23T12:00:00Z']) {
    const start=new Date(at);const slots=new Set<number>();
    for(let i=0;i<20;i++) {
      const next=nextNudgeAfter(start,zone,`caller-${i}`);const window=nudgeWindow(next,zone);
      assert.ok(next>=window.start && next<window.end);
      assert.ok(+next-+start>24*3600_000 && +next-+start<5*24*3600_000);
      assert.equal(+next,+nextNudgeAfter(start,zone,`caller-${i}`));slots.add(+next);
    }
    assert.ok(slots.size>15);
  }
});

test('real registration preserves voice and opt-in across wrong code, edit and phone verification; account can change both', options, async () => {
  const d=deps();const server=controlPlane(d,'synthetic-secret');
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post=(body:URLSearchParams,cookie?:string):RequestInit=>({method:'POST',body,redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})}});
  try {
    const start=await fetch(base+'/start',post(form({voice:'female',nudges:'yes'})));assert.equal(start.status,200);
    const html=await start.text();const draft=/name="draft" value="([^"]+)"/.exec(html)?.[1];assert.ok(draft);
    const code=texts[0]?.match(/^\d{6}/)?.[0];assert.ok(code);
    const pending=new Pending(db!.sql);assert.equal((await pending.draft(draft))?.voice,'female');assert.equal((await pending.draft(draft))?.nudges,true);
    const wrong=await fetch(base+'/start/verify',post(new URLSearchParams({phone,draft,code:'wrong'})));assert.equal(wrong.status,400);
    const edit=await fetch(base+'/start/edit',post(new URLSearchParams({draft})));const edited=await edit.text();
    assert.match(edited,/name="voice" value="female" checked/);assert.match(edited,/name="nudges" value="yes" checked/);
    const verified=await fetch(base+'/start/verify',post(new URLSearchParams({phone,draft,code})));assert.equal(verified.status,303);
    const cookie=verified.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
    assert.equal((await db!.store.load(phone)).voice,'female');
    const [record]=await db!.sql`select nudges_enabled,next_nudge_at from callers where phone_hash=${hash}`;assert.equal(record!['nudges_enabled'],true);assert.ok(record!['next_nudge_at']);
    assert.equal(await queueDueNudges(d,now),0,'registration does not send an extra optional text');
    const change=await fetch(base+'/me',post(new URLSearchParams({action:'voice',voice:'male'}),cookie));assert.equal(change.status,200);assert.equal((await db!.store.load(phone)).voice,'male');
    const off=await fetch(base+'/me',post(new URLSearchParams({action:'nudges-off'}),cookie));assert.equal(off.status,200);
    assert.equal((await db!.sql`select nudges_enabled from callers where phone_hash=${hash}`)[0]!['nudges_enabled'],false);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

async function enrolled():Promise<void> {
  await db!.store.upsertProfile(phone,{voice:'female'});
  await db!.sql`update callers set timezone='Europe/Oslo',call_number=2,onboarding='complete',nudges_enabled=true,next_nudge_at=${now},next_call_at=null where phone_hash=${hash}`;
}

test('parallel nudge ticks record one intent, use the normal outbox and never expose private call details', options, async()=>{
  await enrolled();const d=deps();
  await db!.store.record(phone,{at:now.toISOString(),durationMs:600000,commitment:'Private secret commitment'});
  assert.equal((await Promise.all([queueDueNudges(d,now),queueDueNudges(d,now)])).reduce((a,b)=>a+b),1);
  assert.equal(texts.length,0);
  await dispatchMessages(d,now);await dispatchMessages(d,now);
  assert.equal(texts.length,1);assert.ok(texts[0]!.startsWith('8&80:'));assert.ok(!texts[0]!.includes('Private'));
  assert.equal(await queueDueNudges(d,now),0);
});

test('pending optional texts recheck opt-out, STOP, pause, safety, subscription and sender at the send boundary', options, async()=>{
  await enrolled();const d=deps();
  const send=async(key:string)=>enqueue(db!.sql,{eventKey:key,phoneHash:hash,channel:'sms',kind:'nudge',to:phone,reference:'0',body:'Synthetic optional text'},now);
  for(const field of ['paused','all_calls_stopped','held_for_review','sms_opt_out']) {
    const id=await send(field);await db!.sql.unsafe(`update callers set ${field}=true`);
    assert.equal(await dispatchMessage(d,id,now),'suppressed',field);await db!.sql.unsafe(`update callers set ${field}=false`);
  }
  let id=await send('billing');await db!.sql`update callers set billing_status='trialing',trial_ends_at=${new Date(+now-1)}`;
  assert.equal(await dispatchMessage(d,id,now),'suppressed');await db!.sql`update callers set billing_status='comped'`;
  id=await send('sender');process.env['SMS_FROM_NUMBER']='+4791000001';assert.equal(await dispatchMessage(d,id,now),'suppressed');process.env['SMS_FROM_NUMBER']='+4791000000';
  id=await send('off');await db!.sql.begin(tx=>setNudges(tx,hash,false,'Europe/Oslo',now));
  await db!.sql.begin(tx=>setNudges(tx,hash,true,'Europe/Oslo',now));assert.equal(await dispatchMessage(d,id,now),'suppressed','turning back on cannot revive an old text');assert.equal(texts.length,0);
});

test('late scheduler wakes and quiet hours skip optional texts instead of catching up',options,async()=>{
  await enrolled();const d=deps();
  await db!.sql`update callers set next_nudge_at=${new Date(+now-3*3600_000)}`;
  assert.equal(await queueDueNudges(d,now),0);
  const night=new Date('2026-11-03T22:00:00Z');await db!.sql`update callers set next_nudge_at=${night}`;
  assert.equal(await queueDueNudges(d,night),0);assert.equal(texts.length,0);
});

test('scheduler carries the stored female preference into actual hosted-agent requests',options,async()=>{
  await enrolled();const d=deps();await d.scheduler.setSlot(phone,{weekday:2,minute:12*60,timezone:'Europe/Oslo'},new Date(+now-1000));
  const result=await tick(d,now);assert.equal(result.placed,1);assert.equal(wire.at(-1)!['agent_id'],'female-return');
});

test('an optional text already claimed before opt-out cannot revive after re-enabling',options,async()=>{
  await enrolled();const d=deps();await queueDueNudges(d,now);
  const [row]=await db!.sql`select id,reference from message_outbox where kind='nudge'`;
  // Simulate the first dispatch transaction having claimed this item, before taking the caller lock.
  await db!.sql`update message_outbox set status='sending' where id=${row!['id']}`;
  await db!.sql.begin(tx=>setNudges(tx,hash,false,'Europe/Oslo',now));
  await db!.sql.begin(tx=>setNudges(tx,hash,true,'Europe/Oslo',now));
  // Recovered definitive-not-sent request returns to pending with the original preference version.
  await db!.sql`update message_outbox set status='pending' where id=${row!['id']}`;
  assert.equal(await dispatchMessage(d,row!['id'],now),'suppressed');assert.equal(texts.length,0);
});
