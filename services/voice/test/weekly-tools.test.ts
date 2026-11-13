import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { openTestDb } from './helpers/db.ts';
import { weeklyCallContext, weeklyToolsAllowed, weeklyToken, weeklyTool } from '../src/weekly/runtime.ts';
import { reminderTime, relativeReminderTime, reminderLocalTime, queueDueReminders, pruneWeekly } from '../src/weekly/reminders.ts';
import { CANDIDATES, EXPERIMENT, chooseWinner, observeTip, optimizeTips, tipReport, type ExperimentGroup } from '../src/weekly/tips.ts';
import { weeklyOpenApi } from '../src/weekly/tool-schema.ts';
import { weeklyWebhookArguments, weeklySpeechifyDefaults } from '../src/weekly/transport.ts';
import { dispatchMessages, dispatchMessage } from '../src/messages/outbox.ts';
import { SendFailure } from '../src/messages/types.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { SpeechifyAgent } from '../src/agent/speechify.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { controlPlane } from '../src/control.ts';
import { composeExport } from '../src/legal/export.ts';
import { tick } from '../src/loop/tick.ts';
import { weeklyPrompt } from '../src/agent/prompt-pack.ts';
import { GUIDED_REMINDER_DELAY_MINUTES, GUIDED_REMINDER_SHIFT_MINUTES, GUIDED_REMINDER_TEXT } from '../src/weekly/guided-pilot.ts';

const opened=await openTestDb('weekly_tools');
const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const now=new Date('2026-11-03T11:00:00Z'), due=new Date('2026-11-04T09:00:00Z');
const phone='+4791000200', hash=phoneKey(phone), attempt='weekly-test-attempt';
const script=loadScript();
let texts:string[]=[], requests=0;
const deps=():LoopDeps=>({store:db!.store,scheduler:new Scheduler(db!.sql),script,agent:new SpeechifyAgent('synthetic','return','first'),
  mailer:{send:async()=>undefined},sms:{send:async(_phone,body)=>{texts.push(body);return {id:'synthetic-sms'};}}});
const call=(command:string,extra:Record<string,unknown>={},at=now,id=attempt)=>weeklyTool(deps(),{attempt_id:id,session_token:weeklyToken(id),command,request_id:`request-${++requests}`,...extra},at);
const envelope=(args:unknown)=>({arguments:args,timestamp:Date.now()/1000,tool_call_id:'synthetic-tool-call',tool_name:'weekly_assist'});
async function enrolled(at=now,id=attempt,p=phone):Promise<void>{
  await db!.store.upsertProfile(p,{name:'Synthetic',email:'synthetic@example.com'});
  await db!.sql`update callers set timezone='Europe/Oslo',onboarding='complete',call_number=2 where phone_hash=${phoneKey(p)}`;
  await db!.sql`insert into call_attempts(id,phone_hash,scheduled_for,status,started_at,provider_call_id)
    values(${id},${phoneKey(p)},${new Date(+at-300000)},'placed',${new Date(+at-300000)},${`provider-${id}`})`;
}
async function prepared(text='Take five minutes to meditate',time='10:00'){
  return await call('reminder_prepare',{text,date:'2026-11-04',time});
}
async function saved(text='Take five minutes to meditate',time='10:00'){
  const p=await prepared(text,time);return await call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true});
}
beforeEach(async()=>{
  Object.assign(process.env,{DATA_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),PUBLIC_URL:'https://8and80.example',WEEKLY_TOOLS_READY:'1',WEEKLY_TOOL_SECRET:'synthetic-weekly-secret-with-32-characters',SPEECHIFY_SEND_VARIABLES:'1',
    SMS_FROM_NUMBER:'+4791000000',SPEECHIFY_CALLER_ID_NUMBER:'+4791000000',SPEECHIFY_AGENT_ID:'return',SPEECHIFY_FIRST_CALL_AGENT_ID:'first',SPEECHIFY_FEMALE_AGENT_ID:'female-return',SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID:'female-first'});
  texts=[];requests=0;
  delete process.env['WEEKLY_TOOLS_PILOT_HASH'];
  if(db)await db.sql`truncate product_feedback,weekly_reminder_drafts,weekly_reminders,weekly_tool_requests,weekly_tip_offers,weekly_tip_assignments,weekly_tip_experiments,weekly_tip_counters,belief_sessions,unblock_sessions,belief_refund_requests,belief_enrollments,unblock_enrollments,journey_events,message_attempts,message_outbox,call_attempts,callers,links,feedback,signups,access_codes`;
});
after(async()=>{await db?.close();});

test('the weekly tool refuses an Unblock or Beliefs session, even with a valid weekly token',options,async()=>{
  const sessions=[['unblock-session','unblock_sessions'],['beliefs-session','belief_sessions']] as const;
  for(const [i,[id,table]] of sessions.entries()){
    const at=new Date(+now-(i+1)*3600_000);await enrolled(at,id);
    if(table==='unblock_sessions'){
      await db!.sql`insert into unblock_enrollments(id,checkout_reference,phone_hash,programme_enc,consent_version,consent_at) values(${'p-'+id},${'ref-'+id},${hash},'x','v',${now})`;
      await db!.sql`insert into unblock_sessions(id,phone_hash,programme_id,kind,week,snapshot_enc) values(${id},${hash},${'p-'+id},'light',0,'x')`;
    } else {
      await db!.sql`insert into belief_enrollments(id,checkout_reference,phone_hash,practice_enc,consent_version,consent_at) values(${'p-'+id},${'ref-'+id},${hash},'x','v',${now})`;
      await db!.sql`insert into belief_sessions(id,phone_hash,programme_id,kind,snapshot_enc) values(${id},${hash},${'p-'+id},'daily','x')`;
    }
    await assert.rejects(call('status',{},at,id),/session_closed/,id);
    await assert.rejects(call('reminder_prepare',{text:'Take five minutes to meditate',date:'2026-11-04',time:'10:00'},at,id),/session_closed/,id);
  }
  assert.equal((await db!.sql`select count(*)::int as n from weekly_reminder_drafts`)[0]!['n'],0);
  // The same call, from a plain weekly attempt, is accepted: the refusal is about the session kind.
  const plain=new Date(+now-3*3600_000);await enrolled(plain,'plain-weekly-session');
  assert.equal(typeof (await call('status',{},plain,'plain-weekly-session'))['tips_enabled'],'boolean');
});
test('only editorial scores above seven have live copy; provider prompts require server results and explicit confirmation',()=>{
  assert.equal(CANDIDATES.length,20);
  for(const [id,,score] of CANDIDATES)assert.equal(script.has(`tips.${id}`),score>7,id);
  assert.equal(CANDIDATES.filter(c=>c[2]>7).length,12);
  for(const first of [true,false]){
    const p=weeklyPrompt(first);assert.match(p,/\{\{weekly_context\}\}/);assert.match(p,/reminder_prepare/);assert.match(p,/explicit agreement/);assert.match(p,/at most one tip/);
  }
  const schema=weeklyOpenApi('https://8and80.example');assert.equal(schema.paths['/weekly/tool'].post.operationId,'weekly_assist');
  delete process.env['WEEKLY_TOOLS_READY'];assert.deepEqual(JSON.parse(weeklyCallContext(attempt,'Europe/Oslo',now)),{available:false});
});

test('wall clock validation rejects gaps, repeated hours, impossible dates and past or distant dates',()=>{
  assert.equal(reminderTime('2026-11-04','10:00','Europe/Oslo',now).toISOString(),due.toISOString());
  assert.throws(()=>reminderTime('2026-10-25','02:30','Europe/Oslo',new Date('2026-10-24T00:00Z')),/ambiguous/);
  assert.throws(()=>reminderTime('2027-03-28','02:30','Europe/Oslo',new Date('2027-03-27T00:00Z')),/nonexistent/);
  assert.throws(()=>reminderTime('2026-11-31','10:00','Europe/Oslo',now),/nonexistent/);
  assert.throws(()=>reminderTime('2026-11-03','10:00','Europe/Oslo',now),/two_minutes/);
  assert.throws(()=>reminderTime('2027-01-01','10:00','Europe/Oslo',now),/thirty_days/);
});

test('Speechify transport unwraps only a named tool envelope and rejects ambiguous authority',()=>{
  const args={attempt_id:attempt,session_token:'synthetic',command:'status'};
  assert.equal(weeklyWebhookArguments(args),args);
  assert.equal(weeklyWebhookArguments(envelope(args)),args);
  for(const input of [{...envelope(args),tool_name:'another_tool'},{...envelope(args),tool_call_id:''},
    {...envelope(args),timestamp:'invalid'},envelope([]),envelope(JSON.stringify(args)),
    {...envelope(args),session_token:'outer-credential'},{...envelope(args),command:'tips_off'}]){
    assert.throws(()=>weeklyWebhookArguments(input),/unauthorized/);
  }
});

test('Speechify empty optional defaults cannot create a competing time mode or manufacture consent',()=>{
  const raw={attempt_id:attempt,session_token:'synthetic',command:'reminder_prepare',text:'Short break',after_minutes:10,shift_minutes:0,date:'',time:'',draft_id:'',revision:0,confirmed:false,tip_id:'',response:''};
  const normalized=weeklyWebhookArguments(envelope(raw));
  assert.deepEqual(normalized,{attempt_id:attempt,session_token:'synthetic',command:'reminder_prepare',text:'Short break',after_minutes:10});
  assert.equal(raw.shift_minutes,0,'normalization must not mutate the provider record');
  assert.equal(weeklyWebhookArguments(raw),raw,'flat API requests remain strict');
  assert.equal(weeklySpeechifyDefaults({...raw,shift_minutes:2})['shift_minutes'],2,'a meaningful competing shift must survive for rejection');
  assert.equal(weeklySpeechifyDefaults({...raw,date:'2030-11-13'})['date'],'2030-11-13','a meaningful competing date must survive');
  assert.equal(weeklySpeechifyDefaults({command:'reminder_prepare',shift_minutes:0})['shift_minutes'],0,'an actual zero shift must still fail validation');
  for(const confirmed of [false,null])assert.equal(weeklySpeechifyDefaults({command:'reminder_confirm',draft_id:'draft',confirmed})['confirmed'],confirmed);
  assert.equal(weeklySpeechifyDefaults({command:'reminder_cancel',revision:0})['revision'],0,'an invalid cancellation revision cannot be invented');
});

test('relative time uses server elapsed minutes across midnight and DST, independently of UTC display',()=>{
  const at=new Date('2026-11-04T10:38:27Z');
  assert.equal(relativeReminderTime(5,at).toISOString(),'2026-11-04T10:43:27.000Z');
  assert.deepEqual(reminderLocalTime(relativeReminderTime(5,at),'Europe/Oslo'),{date:'2026-11-04',time:'11:43'});
  assert.deepEqual(reminderLocalTime(relativeReminderTime(5,new Date('2026-11-04T22:58Z')),'Europe/Oslo'),{date:'2026-11-05',time:'00:03'});
  assert.deepEqual(reminderLocalTime(relativeReminderTime(5,new Date('2027-03-28T00:58Z')),'Europe/Oslo'),{date:'2027-03-28',time:'03:03'});
  for(const minutes of [5.5,'5'])assert.throws(()=>relativeReminderTime(minutes,at),/whole_minutes/);
  for(const minutes of [1,0,-2,43201])assert.throws(()=>relativeReminderTime(minutes,at),/two_minutes/);
});

test('relative create and revision-guarded shifts return server local proposals before confirmation',options,async()=>{
  await enrolled();
  const status=await call('status');assert.equal(status['time'],'12:00');
  let p=await call('reminder_prepare',{text:'Short break',after_minutes:5});
  assert.equal(p['time'],'12:05');assert.equal(p['date'],'2026-11-03');assert.equal(p['timezone'],'Europe/Oslo');
  assert.equal((await db!.sql`select * from weekly_reminders`).length,0);
  const created=await call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true});
  const revision=(created['reminder'] as {revision:number}).revision;
  await assert.rejects(call('reminder_prepare',{text:'Short break',shift_minutes:2,revision:revision-1}),/revision_required/);
  await assert.rejects(call('reminder_prepare',{text:'Short break',after_minutes:5,date:'2026-11-03',time:'12:05'}),/one_time_mode/);
  await assert.rejects(call('reminder_prepare',{text:'Short break',after_minutes:5,shift_minutes:2}),/one_time_mode/);
  p=await call('reminder_prepare',{text:'Short break',shift_minutes:2,revision},new Date(+now+60000));
  assert.equal(p['time'],'12:07','shift starts at the pending due time, not current time');
  const changed=await call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true},new Date(+now+60000));
  assert.equal((changed['reminder'] as {at:string}).at,new Date(+now+7*60000).toISOString());
  assert.equal((await call('reminder_cancel',{revision:revision+1},new Date(+now+60000)))['cancelled'],true);
});

test('pilot setup authorizes only its test caller until global activation',()=>{
  process.env['WEEKLY_TOOLS_READY']='0';process.env['WEEKLY_TOOLS_PILOT_HASH']=hash;
  assert.equal(weeklyToolsAllowed(hash),true);assert.equal(weeklyToolsAllowed('another-account'),false);
  assert.equal(JSON.parse(weeklyCallContext(attempt,'Europe/Oslo',now,hash)).available,true);
  assert.equal(JSON.parse(weeklyCallContext(attempt,'Europe/Oslo',now,'another-account')).available,false);
  process.env['WEEKLY_TOOLS_READY']='1';assert.equal(weeklyToolsAllowed('another-account'),true);
});

test('guided owner lifecycle stays unscheduled until confirmation and sends no SMS after cancellation',options,async()=>{
  await enrolled();process.env['WEEKLY_TOOLS_READY']='0';process.env['WEEKLY_TOOLS_PILOT_HASH']=hash;
  const worker=(command:string,extra:Record<string,unknown>={},at=now)=>weeklyTool(deps(),weeklyWebhookArguments(envelope({
    attempt_id:attempt,session_token:weeklyToken(attempt),command,request_id:`guided-request-${++requests}`,
    text:'',date:'',time:'',after_minutes:0,shift_minutes:0,draft_id:'',revision:0,confirmed:false,tip_id:'',response:'',...extra,
  })),at);
  const initial=await worker('reminder_prepare',{text:GUIDED_REMINDER_TEXT,after_minutes:GUIDED_REMINDER_DELAY_MINUTES});
  assert.equal((await worker('status'))['reminder'],null,'thinking after a proposal cannot create a pending reminder');
  await assert.rejects(worker('reminder_confirm',{draft_id:initial['draft_id'],confirmed:false}),/explicit_confirmation/);
  const args={draft_id:initial['draft_id'],confirmed:true,request_id:'guided-initial-confirm'};
  const created=await worker('reminder_confirm',args);
  assert.equal((await worker('reminder_confirm',args))['replayed'],true,'an identical retry cannot duplicate the SMS');
  const r=created['reminder'] as {revision:number;at:string};
  const replacement=await worker('reminder_prepare',{text:GUIDED_REMINDER_TEXT,shift_minutes:GUIDED_REMINDER_SHIFT_MINUTES,revision:r.revision},new Date(+now+30_000));
  assert.equal(((await worker('status'))['reminder'] as {at:string}).at,r.at,'a move proposal cannot change the saved time');
  const changed=await worker('reminder_confirm',{draft_id:replacement['draft_id'],confirmed:true},new Date(+now+40_000));
  const moved=changed['reminder'] as {revision:number;at:string};
  assert.equal(+new Date(moved.at)-+new Date(r.at),GUIDED_REMINDER_SHIFT_MINUTES*60_000);
  assert.equal((await worker('reminder_cancel',{revision:moved.revision},new Date(+now+50_000)))['cancelled'],true);
  const final=(await worker('status'))['reminder'] as {state:string};assert.equal(final.state,'cancelled');
  await queueDueReminders(deps(),new Date(+now+20*60_000));
  await dispatchMessages(deps(),new Date(+now+20*60_000));assert.deepEqual(texts,[]);
  const [row]=await db!.sql`select body_enc from weekly_reminders where phone_hash=${hash}`;assert.equal(row!['body_enc'],null);
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='reminder'`)[0]!['n'],0);
});

test('optimization withholds a winner for early data, overlapping intervals, sparse exposure or increased opt-outs',()=>{
  const a:ExperimentGroup={arm:'A',n:100,mature:100,returned:90,opted_out:0,exposed:80};
  const b:ExperimentGroup={...a,arm:'B',returned:30};
  assert.equal(chooseWinner([a,b]),'A');
  assert.equal(chooseWinner([{...a,returned:30},{...b,returned:90}]),'B');
  for(const changed of [{...a,mature:99},{...a,n:99},{...a,exposed:49},{...a,opted_out:1},{...a,returned:35}])assert.equal(chooseWinner([changed,b]),null);
});

test('preparation is private and inert; exact retries commit one reminder and conflicting retries fail',options,async()=>{
  await enrolled();const p=await prepared();assert.equal(p['channel'],'sms');assert.equal(p['replaces_existing'],false);
  assert.equal((await db!.sql`select * from weekly_reminders`).length,0);assert.equal(texts.length,0);
  assert.doesNotMatch((await db!.sql`select body_enc from weekly_reminder_drafts`)[0]!['body_enc'],/meditate/);
  await assert.rejects(call('reminder_confirm',{draft_id:p['draft_id'],confirmed:false}),/explicit_confirmation/);
  const args={draft_id:p['draft_id'],confirmed:true,request_id:'commit-once'};
  const [one,two]=await Promise.all([call('reminder_confirm',args),call('reminder_confirm',args)]);
  assert.equal(one['saved'],true);assert.equal(two['saved'],true);assert.equal(two['replayed'],true);
  assert.equal((await db!.sql`select revision from weekly_reminders`)[0]!['revision'],1);
  await assert.rejects(call('reminder_confirm',{...args,confirmed:false}),/request_id_conflict/);
});

test('create, change and stop work entirely in-call; replacing invalidates already queued old content',options,async()=>{
  await enrolled();await saved();
  await db!.sql`update call_attempts set status='completed'`;
  assert.equal(await queueDueReminders(deps(),due),1);
  await db!.sql`update call_attempts set status='placed'`;
  const proposal=await prepared('Use the new reminder','11:00');assert.equal(proposal['replaces_existing'],true);
  const change=await call('reminder_confirm',{draft_id:proposal['draft_id'],confirmed:true});assert.equal(change['saved'],true);
  assert.equal((await db!.sql`select status from message_outbox`)[0]!['status'],'suppressed');
  await dispatchMessages(deps(),due);assert.equal(texts.length,0);
  const status=await call('status');const r=status['reminder'] as {revision:number;text:string;at:string};assert.equal(r.text,'Use the new reminder');assert.equal(r.revision,2);
  await assert.rejects(call('reminder_cancel',{revision:1}),/reminder_changed/);
  assert.equal((await call('reminder_cancel',{revision:2}))['cancelled'],true);
  await queueDueReminders(deps(),new Date(+due+3600000));await dispatchMessages(deps(),new Date(+due+3600000));assert.equal(texts.length,0);
});

test('parallel due ticks and dispatches send one requested SMS, independently of nudge opt-in',options,async()=>{
  await enrolled();await saved();await db!.sql`update call_attempts set status='completed'`;
  const queued=await Promise.all([queueDueReminders(deps(),due),queueDueReminders(deps(),due)]);assert.equal(queued.reduce((a,b)=>a+b),1);
  const id=(await db!.sql`select id from message_outbox`)[0]!['id'];
  await Promise.all([dispatchMessage(deps(),id,due),dispatchMessage(deps(),id,due)]);
  assert.deepEqual(texts,['8&80 reminder: Take five minutes to meditate']);
  const [r]=await db!.sql`select state,body_enc from weekly_reminders`;assert.equal(r!['state'],'accepted');assert.equal(r!['body_enc'],null);
  assert.equal((await db!.sql`select payload_enc from message_outbox`)[0]!['payload_enc'],null);
});

test('send boundary respects stop, pause, safety, entitlement and sender changes after the SMS was queued',options,async()=>{
  await enrolled();await saved();await db!.sql`update call_attempts set status='completed'`;
  await queueDueReminders(deps(),due);
  const id=(await db!.sql`select id from message_outbox`)[0]!['id'];
  for(const field of ['paused','all_calls_stopped','held_for_review','sms_opt_out']){
    await db!.sql.unsafe(`update callers set ${field}=true`);
    assert.equal(await dispatchMessage(deps(),id,due),'suppressed',field);
    await db!.sql.unsafe(`update callers set ${field}=false`);
    await db!.sql`update weekly_reminders set state='queued'`;await db!.sql`update message_outbox set status='pending',available_at=${due}`;
  }
  process.env['SMS_FROM_NUMBER']='+4791000001';assert.equal(await dispatchMessage(deps(),id,due),'suppressed');
  assert.equal(texts.length,0);
});

test('missed delivery windows expire without catch-up or recurring subscription',options,async()=>{
  await enrolled();await saved();await db!.sql`update call_attempts set status='completed'`;
  assert.equal(await queueDueReminders(deps(),new Date(+due+16*60000)),0);
  assert.equal((await db!.sql`select state from weekly_reminders`)[0]!['state'],'expired');
  assert.equal((await db!.sql`select nudges_enabled from callers`)[0]!['nudges_enabled'],false);assert.equal(texts.length,0);
});

test('unknown provider outcomes are never retried as a new SMS and cannot be claimed cancelled',options,async()=>{
  await enrolled();await saved();await db!.sql`update call_attempts set status='completed'`;await queueDueReminders(deps(),due);
  const d=deps();let sends=0;d.sms={send:async()=>{sends++;throw new SendFailure('uncertain','synthetic timeout');}};
  await dispatchMessages(d,due);await dispatchMessages(d,new Date(+due+60000));assert.equal(sends,1);
  await db!.sql`update call_attempts set status='placed'`;
  const result=await call('reminder_cancel',{revision:1});assert.equal(result['cancelled'],false);
  assert.equal((result['reminder'] as {state:string}).state,'uncertain');
});

test('an interrupted in-flight request cannot produce a false cancellation claim',options,async()=>{
  await enrolled();await saved();await db!.sql`update call_attempts set status='completed'`;await queueDueReminders(deps(),due);
  await db!.sql`update message_outbox set status='sending',started_at=${due}`;
  await db!.sql`update call_attempts set status='placed'`;
  const result=await call('reminder_cancel',{revision:1});assert.equal(result['cancelled'],false);assert.equal(result['delivery_unconfirmed'],true);
  assert.equal(result['future_delivery_stopped'],true);assert.equal(texts.length,0);
  assert.equal(((await call('status'))['reminder'] as {state:string}).state,'cancellation_unconfirmed');
});

test('a reminder already sent while a replacement was discussed cannot be described as changed',options,async()=>{
  await enrolled();await saved();const p=await prepared('Replacement','11:00');
  await db!.sql`update weekly_reminders set state='accepted',body_enc=null`;
  await assert.rejects(call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true}),/original_reminder_no_longer_pending/);
});

test('call authentication is scoped, short-lived and invalid after completion; disabled setup fails closed',options,async()=>{
  await enrolled();
  await assert.rejects(weeklyTool(deps(),{attempt_id:attempt,session_token:weeklyToken('another-call'),command:'status'},now),/unauthorized/);
  await assert.rejects(call('status',{},new Date(+now+46*60000)),/session_closed/);
  await db!.sql`update call_attempts set status='completed'`;await assert.rejects(call('status'),/session_closed/);
  process.env['WEEKLY_TOOLS_READY']='0';await assert.rejects(call('status'),/unauthorized/);
});

test('the real scheduler placement injects a credential for its own attempt and the configured timezone',options,async()=>{
  await db!.store.upsertProfile(phone,{});
  const d=deps();await d.scheduler.setSlot(phone,{weekday:2,minute:720,timezone:'Europe/Oslo'},new Date(+now-86400_000));
  await db!.sql`update callers set onboarding='complete',call_number=2`;
  let wire:Record<string,unknown>={};
  d.agent=new SpeechifyAgent('synthetic','return','first','https://synthetic.example',{variables:true,amd:false,ringingTimeout:false,language:false},async(_url,init)=>{
    wire=JSON.parse(String(init?.body));return Response.json({conversation_id:'synthetic-scheduler-call'});
  });
  assert.equal((await tick(d,now)).placed,1);
  const context=JSON.parse((wire['dynamic_variables'] as Record<string,string>)['weekly_context']!) as {attempt_id:string;session_token:string;timezone:string};
  assert.equal(context.timezone,'Europe/Oslo');assert.equal(context.session_token,weeklyToken(context.attempt_id));
  assert.equal((await weeklyTool(d,{...context,command:'status'},new Date()))['reminders_available'],true);
});

test('billing changes, safety holds and expired drafts cannot create a promised reminder',options,async()=>{
  await enrolled();const p=await prepared();
  await db!.sql`update callers set trial_ends_at=${new Date(+now+3600000)},billing_status='trialing'`;
  await assert.rejects(call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true}),/beyond_access/);
  await db!.sql`update callers set billing_status='comped',held_for_review=true`;
  await assert.rejects(call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true}),/unavailable/);
  await db!.sql`update callers set held_for_review=false`;
  await assert.rejects(call('reminder_confirm',{draft_id:p['draft_id'],confirmed:true},new Date(+now+11*60000)),/draft_expired/);
  assert.equal((await db!.sql`select * from weekly_reminders`).length,0);
});

test('tips are selected once, self-reports are separate from signed exposure, sequences advance and opt-out leaves calls alone',options,async()=>{
  await enrolled();const first=await call('context');const tip=first['tip'] as {id:string;text:string};assert.ok(tip);
  assert.deepEqual((await call('context'))['tip'],tip);
  await call('tip_presented',{tip_id:tip.id});
  assert.equal((await call('context'))['tip'],null,'a reported tip is not offered again in this call');
  assert.equal((await db!.sql`select exposed_at from weekly_tip_offers`)[0]!['exposed_at'],null);
  await db!.sql.begin(tx=>observeTip(tx,attempt,['Something unrelated'],now));
  assert.equal((await db!.sql`select exposed_at from weekly_tip_offers`)[0]!['exposed_at'],null);
  await db!.sql.begin(tx=>observeTip(tx,attempt,[tip.text],now));
  const next=new Date(+now+7*86400_000);await enrolled(next,'call-two');
  const second=(await call('context',{},next,'call-two'))['tip'] as {id:string;text:string};assert.ok(second);assert.notEqual(second.id,tip.id);
  await call('tip_response',{tip_id:second.id,response:'declined'},next,'call-two');
  await call('tips_off',{},next,'call-two');assert.equal((await call('context',{},next,'call-two'))['tip'],null);
  const [c]=await db!.sql`select paused,tips_enabled,tip_progress from callers`;assert.equal(c!['paused'],false);assert.equal(c!['tips_enabled'],false);assert.ok(JSON.parse(c!['tip_progress']).topics.length>=2);
  await pruneWeekly(db!.sql,new Date(+now+70*86400_000));
  assert.ok(JSON.parse((await db!.sql`select tip_progress from callers`)[0]!['tip_progress']).topics.length>=2,'do not forget declined topics with analytics retention');
});

test('short and unfinished introductions do not get proactive tips; no request invents a missing voice capability',options,async()=>{
  await enrolled();await db!.sql`update call_attempts set started_at=${new Date(+now-60000)}`;
  assert.equal((await call('context'))['tip'],null);
  await db!.sql`update call_attempts set started_at=${new Date(+now-300000)}`;
  await db!.sql`update callers set onboarding='in_progress'`;assert.equal((await call('context'))['tip'],null);
  assert.equal((await db!.sql`select * from weekly_tip_assignments`).length,0);
  await db!.sql`update callers set onboarding='complete',tip_progress=${JSON.stringify({arm:'A',topics:['help']})}`;
  delete process.env['SPEECHIFY_FEMALE_AGENT_ID'];
  assert.equal(((await call('context'))['tip'] as {id:string}).id,'tips.12','skip unavailable voice routes');
});

test('fixed 14-day A/B cohort freezes once, conservatively promotes a clear winner only for new assignments',options,async()=>{
  const assigned=new Date(+now-15*86400_000);
  for(const arm of ['A','B'])for(let i=1;i<=100;i++){
    const h=`sample-${arm}-${i}`;
    await db!.sql`insert into weekly_tip_assignments(phone_hash,experiment,arm,randomized,sample_rank,assigned_at) values(${h},${EXPERIMENT},${arm},true,${i},${assigned})`;
    await db!.sql`insert into weekly_tip_offers(attempt_id,phone_hash,tip_id,topic,wording_enc,offered_at,exposed_at) values(${h},${h},'tips.01','help','synthetic-not-read',${assigned},${assigned})`;
    if(i<=(arm==='A'?90:30))await db!.sql`insert into journey_events(id,phone_hash,event,at) values(${h},${h},'conversation_completed',${new Date(+assigned+7*86400_000)})`;
  }
  await optimizeTips(db!.sql,new Date(+assigned+13*86400_000));assert.equal((await tipReport(db!.sql,now)).frozen,null);
  await optimizeTips(db!.sql,now);assert.equal((await tipReport(db!.sql,now)).frozen?.winner,'A');
  await db!.sql`delete from journey_events`;await optimizeTips(db!.sql,now);assert.equal((await tipReport(db!.sql,now)).frozen?.winner,'A');
  await enrolled();await call('context');const [a]=await db!.sql`select arm,randomized from weekly_tip_assignments where phone_hash=${hash}`;
  assert.equal(a!['arm'],'A');assert.equal(a!['randomized'],false);
});

test('deletion cannot silently replace a missing fixed-sample participant with a later one',options,async()=>{
  const assigned=new Date(+now-15*86400_000);
  for(const arm of ['A','B'])for(let i=1;i<=101;i++)await db!.sql`insert into weekly_tip_assignments(phone_hash,experiment,arm,randomized,sample_rank,assigned_at) values(${`${arm}-${i}`},${EXPERIMENT},${arm},true,${i},${assigned})`;
  await db!.sql`delete from weekly_tip_assignments where phone_hash='A-1'`;await optimizeTips(db!.sql,now);
  const report=await tipReport(db!.sql,now);assert.equal(report.groups[0]!.n,99);assert.equal(report.frozen,null);
});

test('account export includes reminder data and deletion clears all personal tool and experiment rows',options,async()=>{
  await enrolled();await saved();await call('context');
  const exported=await composeExport(db!.store,phone,script);assert.ok(exported?.body.includes('Take five minutes to meditate'));
  assert.ok(!exported?.body.includes(weeklyToken(attempt)));
  await db!.store.forget(phone);
  for(const table of ['weekly_reminders','weekly_reminder_drafts','weekly_tool_requests','weekly_tip_offers','weekly_tip_assignments'])assert.equal((await db!.sql.unsafe(`select * from ${table} where phone_hash=$1`,[hash])).length,0,table);
});

test('real HTTP operation rejects forged auth, malformed and oversized requests and advertises an importable schema',options,async()=>{
  const at=new Date();await enrolled(at);
  const server=controlPlane(deps(),'synthetic-webhook-secret');await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post=(body:string)=>fetch(base+'/weekly/tool',{method:'POST',headers:{'content-type':'application/json'},body});
  try{
    assert.equal((await post('{')).status,400);assert.equal((await post('x'.repeat(7000))).status,413);
    assert.equal((await post(JSON.stringify({attempt_id:attempt,session_token:'forged',command:'status'}))).status,401);
    const probe=await fetch(base+'/weekly/tool',{method:'POST',headers:{'content-type':'application/json','speechify-webhook-test':'true'},body:JSON.stringify({attempt_id:attempt,session_token:weeklyToken(attempt),command:'tips_off',request_id:'must-not-run'})});
    const probeResult=await probe.json() as {action_performed:boolean};assert.equal(probe.status,200);assert.equal(probeResult.action_performed,false);
    assert.equal((await db!.sql`select tips_enabled from callers where phone_hash=${hash}`)[0]!['tips_enabled'],true);
    assert.equal((await db!.sql`select count(*)::int as n from weekly_tool_requests`)[0]!['n'],0);
    assert.ok(!JSON.stringify(probeResult).includes(weeklyToken(attempt)));
    const forgedEnvelope=envelope({attempt_id:attempt,session_token:'forged',command:'status'});
    assert.equal((await post(JSON.stringify(forgedEnvelope))).status,401);
    assert.equal((await post(JSON.stringify({...forgedEnvelope,session_token:weeklyToken(attempt)}))).status,401);
    const yesterday=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(+at-86400_000));
    const past=await post(JSON.stringify(envelope({attempt_id:attempt,session_token:weeklyToken(attempt),command:'reminder_prepare',request_id:'past-local-time',text:'Test break',date:yesterday,time:'10:43'})));
    const pastResult=await past.json() as {reason:string;user_message:string};assert.equal(past.status,409);assert.equal(pastResult.reason,'past');assert.match(pastResult.user_message,/already passed/);
    assert.doesNotMatch(pastResult.user_message,/less than two|too soon/);assert.equal((await db!.sql`select * from weekly_reminder_drafts`).length,0);
    const response=await post(JSON.stringify({attempt_id:attempt,session_token:weeklyToken(attempt),command:'status'}));assert.equal(response.status,200);assert.equal((await response.json() as {reminders_available:boolean}).reminders_available,true);
    assert.equal((await (await fetch(base+'/weekly/openapi.json')).json() as {openapi:string}).openapi,'3.0.3');
    const invoke=async(command:string,extra:Record<string,unknown>={})=>{
      const response=await post(JSON.stringify(envelope({attempt_id:attempt,session_token:weeklyToken(attempt),command,request_id:`http-${++requests}`,...extra})));
      assert.equal(response.status,200);return await response.json() as Record<string,unknown>;
    };
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(+at+86400_000));
    const proposal=await invoke('reminder_prepare',{text:'Synthetic HTTP reminder',date,time:'15:30'});
    assert.equal((await invoke('reminder_confirm',{draft_id:proposal['draft_id'],confirmed:true}))['saved'],true);
    const replacement=await invoke('reminder_prepare',{text:'Synthetic replacement',date,time:'15:32'});
    const changed=await invoke('reminder_confirm',{draft_id:replacement['draft_id'],confirmed:true});
    assert.equal((changed['reminder'] as {revision:number}).revision,2);
    assert.equal((await invoke('reminder_cancel',{revision:2}))['cancelled'],true);
    const tip=(await invoke('context'))['tip'] as {id:string;text:string};assert.ok(tip);
    const body=JSON.stringify({event:'conversation.completed',conversation_id:`provider-${attempt}`,duration_ms:300000,messages:[{role:'agent',content:tip.text},{role:'user',content:'No action this week.'}]});
    const t=Math.floor(Date.now()/1000),signature=createHmac('sha256','synthetic-webhook-secret').update(`${t}.${body}`).digest('hex');
    const settled=await fetch(base+'/webhooks/speechify',{method:'POST',headers:{'content-type':'application/json','speechify-signature':`t=${t},v0=${signature}`},body});
    assert.equal(settled.status,200);assert.ok((await db!.sql`select exposed_at from weekly_tip_offers where attempt_id=${attempt}`)[0]!['exposed_at']);
    assert.equal((await post(JSON.stringify({attempt_id:attempt,session_token:weeklyToken(attempt),command:'status'}))).status,409,'settlement closes tool authority');
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
