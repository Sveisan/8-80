import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { BeliefRepository } from '../src/beliefs/repository.ts';
import { emptyPractice, applyCommand, type Practice, type Command } from '../src/beliefs/model.ts';
import { claimBeliefs, beliefTool, settleBeliefs, closeBeliefSession, tickBeliefs } from '../src/beliefs/runtime.ts';
import { sessionToken } from '../src/beliefs/protocol.ts';
import { encrypt, decrypt } from '../src/store/crypto.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { Links } from '../src/link/token.ts';
import { Pending } from '../src/signup/pending.ts';
import { composeExport } from '../src/legal/export.ts';
import { syncBeliefPurchase } from '../src/beliefs/billing.ts';
import { safetyDigest } from '../src/loop/digest.ts';
import { dispatchMessage } from '../src/messages/outbox.ts';
import { SendFailure } from '../src/messages/types.ts';
const opened=await openTestDb('beliefs');const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const now=new Date('2026-10-10T10:00:00Z');const phone='+4791000008';const hash=phoneKey(phone);
const deps=():LoopDeps=>({store:db!.store,scheduler:new Scheduler(db!.sql),script:loadScript(),agent:{placeCall:async()=>{throw Error('should not call base agent');}} as unknown as LoopDeps['agent'],sms:{send:async()=>undefined},mailer:{send:async()=>undefined}});
const repo=()=>new BeliefRepository(db!.sql);
let event=0;const run=(p:Practice,c:Command)=>applyCommand(p,c,'test-'+(++event),now);
function initial():Practice {
  let p=run(emptyPractice(),{type:'outcome',outcome:'My outcome'});
  for(let i=0;i<3;i++)p=run(p,{type:'queue',belief:'Thought '+i,trigger:'Trigger '+i});
  for(const b of p.beliefs.slice(0,2))p=run(p,{type:'prepare',id:b.id,decision:'Decision '+b.id,evidence:['A genuine experience'],balance:'A real challenge',opportunity:'A chosen step',confirmed:true});
  return run(p,{type:'understood',confirmed:true});
}
async function enroll(active=true) {
  await db!.store.upsertProfile(phone,{name:'Synthetic tester',email:'synthetic@example.com'});
  await repo().enroll(hash,now);
  if(active)await db!.sql`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(initial()))}, revision=${event}, standing='active', daily_minute=720, weekly_weekday=0,weekly_minute=1080,next_daily_at=${now},review_origin=${now},next_weekly_at=${new Date(+now+86400_000)} where phone_hash=${hash}`;
  // Use the actual aggregate revision, rather than event IDs, as the concurrency guard.
  const loaded=await repo().load(hash);
  await db!.sql`update belief_enrollments set revision=${loaded!.practice.revision} where phone_hash=${hash}`;
}
const token=(id:string)=>sessionToken(id,'t'.repeat(40));
function payload(id:string,said:string|string[]){return {type:'conversation.completed',data:{conversation_id:id,duration_ms:60000,messages:(typeof said==='string'?[said]:said).map(content=>({role:'user',content}))}};}
beforeEach(async()=>{
  if(db)await db.sql`truncate belief_refund_requests,belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries,heartbeats`;
  process.env['DATA_ENCRYPTION_KEY']=Buffer.alloc(32,12).toString('base64');
  process.env['BELIEFS_TOOL_SECRET']='t'.repeat(40);process.env['PUBLIC_URL']='https://8and80.example';process.env['OPERATOR_PHONE']='+4791000000';
  process.env['BILLING_PROVIDER']='stripe';process.env['BELIEFS_PRODUCT_ID']='price_module';process.env['BELIEFS_BASE_PRICE_ID']='price_month';process.env['STRIPE_SECRET_KEY']='test-key';
  process.env['BELIEFS_COVERAGE_START']='00:00';process.env['BELIEFS_COVERAGE_END']='24:00';process.env['BELIEFS_ENABLED']='false';process.env['BELIEFS_LIVE_CALLS']='false';delete process.env['OPERATOR_PHONE_BACKUP'];
});after(async()=>db?.close());

test('standalone enrollment keeps base slot, trial, singular memory and call count untouched',options,async()=>{
  await enroll(false);const before=await db!.store.load(phone);
  assert.equal((await repo().load(hash))!.practice.state,'onboarding');
  assert.deepEqual(await db!.store.load(phone),before);assert.equal(await new Scheduler(db!.sql).slotFor(phone),undefined);
});
test('daily claim advances atomically; duplicate workers cannot ring twice',options,async()=>{
  await enroll();const groups=await Promise.all([claimBeliefs(deps(),now),claimBeliefs(deps(),now)]);
  assert.equal(groups.flat().length,1);assert.ok((await repo().load(hash))!.enrollment.next_daily_at!>now);
});
test('STOP, safety hold, payment hold, pause and completion prevent module claims',options,async()=>{
  await enroll();
  for(const field of ['all_calls_stopped','held_for_review','sms_opt_out']){
    await db!.sql.unsafe(`update callers set ${field}=true where phone_hash=$1`,[hash]);
    await db!.sql`update belief_enrollments set next_daily_at=${now} where phone_hash=${hash}`;
    assert.equal((await claimBeliefs(deps(),now)).length,0);
    await db!.sql.unsafe(`update callers set ${field}=false where phone_hash=$1`,[hash]);
  }
  await db!.sql`update belief_enrollments set standing='payment_hold',next_daily_at=${now} where phone_hash=${hash}`;
  assert.equal((await claimBeliefs(deps(),now)).length,0);
  await db!.sql`update belief_enrollments set standing='active',practice_enc=${encrypt(JSON.stringify({...initial(),state:'paused'}))} where phone_hash=${hash}`;
  assert.equal((await claimBeliefs(deps(),now)).length,0);
});
test('outage recovery skips overdue days rather than producing catch-up calls',options,async()=>{
  await enroll();await db!.sql`update belief_enrollments set next_daily_at=${new Date(+now-2*86400_000)} where phone_hash=${hash}`;
  assert.equal((await claimBeliefs(deps(),now)).length,0);assert.ok((await repo().load(hash))!.enrollment.next_daily_at!>now);
});
test('typed web edits use revision guards and base credentials cannot expose beliefs',options,async()=>{
  await enroll();const p=(await repo().load(hash))!.practice;
  await assert.rejects(()=>repo().command(hash,{type:'pause'},'page-event',p.revision-1));
  const base=await new Links(db!.sql).mint(hash,now,'browser');assert.equal((await new Links(db!.sql).open(base,now,'beliefs')).ok,false);
  const privateToken=await new Links(db!.sql).mint(hash,now,'beliefs');assert.equal((await new Links(db!.sql).open(privateToken,new Date(+now+3600_001),'beliefs')).ok,false);
});
test('a Beliefs phone challenge cannot create or overwrite a weekly signup',options,async()=>{
  const pending=new Pending(db!.sql);const input={phone,email:'',name:'Synthetic',weekday:0,minute:480,timezone:'Europe/Oslo'};
  const challenge=await pending.begin(input,now,undefined,'beliefs');
  assert.equal((await pending.verify(phone,challenge!.code,now,challenge!.id)).ok,false);
  const base=await pending.begin({...input,email:'base@example.com'},now);
  assert.equal((await pending.verify(phone,challenge!.code,now,challenge!.id,undefined,'beliefs')).ok,true);
  assert.equal((await pending.verify(phone,base.code,now,base.id)).ok,true);
});
test('provisional daily memories commit only from the signed caller transcript, once',options,async()=>{
  await enroll();const before=await db!.store.load(phone);const [s]=await claimBeliefs(deps(),now);assert.ok(s);
  await db!.sql`update call_attempts set status='placed',provider_call_id='conversation_one' where id=${s.id}`;
  const active=(await repo().load(hash))!.practice.beliefs.filter(b=>b.status==='active');let said='';
  for(const [i,b] of active.entries()){
    const text=b.decision+' I remember a real experience. A real challenge remains.';
    said+=' '+text;
    await beliefTool(deps(),{session_id:s.id,session_token:token(s.id),event_id:'daily-'+i,caller_text:text,command:{type:'practice',id:b.id,evidence:'I remember a real experience',balance:'A real challenge remains'}},now);
  }
  assert.equal((await repo().load(hash))!.practice.beliefs[0]!.evidence.length,1);
  assert.equal((await settleBeliefs(payload('conversation_one',said),deps(),undefined,now))!.status,'completed');
  assert.equal((await repo().load(hash))!.practice.beliefs[0]!.evidence.length,2);
  const [closed]=await db!.sql`select snapshot_enc from belief_sessions where id=${s.id}`;
  const retained=decrypt(closed!['snapshot_enc']);
  assert.equal(JSON.parse(retained).closed,true);
  assert.equal(JSON.parse(retained).canonicalVerified,true);
  assert.equal(JSON.parse(retained).eligibleBeliefIds.length,2);
  assert.deepEqual(JSON.parse(retained).captureKinds,['practice','practice']);
  assert.ok(!retained.includes('I remember a real experience'));
  assert.equal((await settleBeliefs(payload('conversation_one',said),deps(),undefined,now))!.handled,false);
  assert.deepEqual(await db!.store.load(phone),before);
});
test('unconfirmed words and in-call concurrent edits do not overwrite canonical memory',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);const b=(await repo().load(hash))!.practice.beliefs[0]!;
  await db!.sql`update call_attempts set status='placed',provider_call_id='conversation_two' where id=${s!.id}`;
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'unverified',caller_text:b.decision+' Genuine new evidence. Still difficult.',command:{type:'practice',id:b.id,evidence:'Genuine new evidence',balance:'Still difficult'}},now);
  assert.equal((await settleBeliefs(payload('conversation_two','Different caller words'),deps(),undefined,now))!.status,'unverified');
  const [closed]=await db!.sql`select snapshot_enc from belief_sessions where id=${s!.id}`;
  assert.equal(JSON.parse(decrypt(closed!['snapshot_enc'])).canonicalVerified,false);
  assert.equal((await repo().load(hash))!.practice.beliefs[0]!.evidence.length,1);
});
test('voice onboarding preserves provisional belief IDs and starts the daily rhythm atomically',options,async()=>{
  await enroll(false);
  await db!.sql`update belief_enrollments set standing='active',onboarding_at=${now},daily_minute=720,weekly_weekday=0,weekly_minute=1080 where phone_hash=${hash}`;
  const [session]=await claimBeliefs(deps(),now);assert.ok(session);
  await db!.sql`update call_attempts set status='placed',provider_call_id='onboarding_voice' where id=${session.id}`;
  const spoken:string[]=[];let n=0;
  const save=async(callerText:string,command:Record<string,unknown>)=>{
    spoken.push(callerText);
    return await beliefTool(deps(),{session_id:session.id,session_token:token(session.id),event_id:'onboard-'+(++n),caller_text:callerText,command},now);
  };
  await save('My chosen outcome',{type:'outcome',outcome:'My chosen outcome'});
  let result:Record<string,unknown>={};
  for(let i=0;i<3;i++)result=await save(`Synthetic thought ${i}. Synthetic situation ${i}.`,{type:'queue',belief:`Synthetic thought ${i}`,trigger:`Synthetic situation ${i}`});
  const mapped=(result['practice'] as Practice).beliefs;
  const chosen=[mapped[2]!,mapped[0]!,mapped[1]!];
  await save('Yes. Synthetic thought 2, then Synthetic thought 0, then Synthetic thought 1.',{type:'reorder',ids:chosen.map(b=>b.id),confirmed:true});
  for(const [i,belief] of chosen.slice(0,2).entries())await save(`Yes. My decision ${i}. My genuine experience ${i}. Some uncertainty remains. My chosen step.`,
    {type:'prepare',id:belief.id,decision:`My decision ${i}`,evidence:[`My genuine experience ${i}`],balance:'Some uncertainty remains',opportunity:'My chosen step',confirmed:true});
  await save('Yes, I understand this practice.',{type:'understood',confirmed:true});
  assert.equal((await repo().load(hash))!.practice.beliefs.length,0);
  assert.equal((await settleBeliefs(payload('onboarding_voice',spoken),deps(),undefined,now))!.status,'completed');
  const saved=(await repo().load(hash))!;
  assert.equal(saved.practice.understood,true);
  assert.deepEqual(saved.practice.beliefs.map(b=>b.id),chosen.map(b=>b.id));
  assert.equal(saved.practice.beliefs.filter(b=>b.status==='active').length,2);
  assert.ok(saved.enrollment.next_daily_at!>now);assert.ok(saved.enrollment.next_weekly_at!>now);
  assert.equal(saved.enrollment.onboarding_at,null);
});
test('caller keyword safety creates a shared hold and durable content-free urgent alert',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);
  const out=await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),caller_text:'I have thoughts of suicide'},now);assert.equal(out['held'],true);
  assert.equal((await db!.sql`select held_for_review from callers where phone_hash=${hash}`)[0]!['held_for_review'],true);
  const [message]=await db!.sql`select payload_enc from message_outbox where kind='safety'`;
  assert.ok(message);assert.ok(!decrypt(message['payload_enc']).includes('suicide'));
  assert.equal((await db!.sql`select safety_tier from call_attempts where id=${s!.id}`)[0]!['safety_tier'],1);
});
test('stale module calls get their own recovery destination, never a base weekly promise',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);assert.equal(await closeBeliefSession(deps(),s!.id,now),true);
  const [message]=await db!.sql`select kind,payload_enc from message_outbox where reference=${s!.id}`;
  assert.equal(message!['kind'],'beliefs');assert.ok(decrypt(message!['payload_enc']).includes('/beliefs/access'));
  assert.equal(await closeBeliefSession(deps(),s!.id,now),true);
  assert.equal((await db!.sql`select count(*)::int as count from message_outbox`)[0]!['count'],1);
});
test('export contains encrypted module history decoded, and erasure removes it',options,async()=>{
  await enroll();await claimBeliefs(deps(),now);
  const baseExport=await composeExport(db!.store,phone,loadScript());assert.ok(!baseExport!.body.includes('My outcome'));assert.ok(baseExport!.body.includes('fresh phone verification'));
  const exported=await composeExport(db!.store,phone,loadScript(),{includeBeliefs:true});assert.ok(exported!.body.includes('My outcome'));assert.ok(exported!.body.includes('beliefSessions'));
  await db!.store.forget(phone);
  assert.equal((await db!.sql`select * from belief_enrollments`).length,0);assert.equal((await db!.sql`select * from belief_sessions`).length,0);
});
test('one-time confirmation is independent and duplicate callbacks create one notice',options,async()=>{
  await enroll(false);const before=await db!.store.load(phone);const reference=(await repo().load(hash))!.enrollment.checkout_reference;
  const session={id:'cs_beliefs',mode:'payment',amount_subtotal:1000,currency:'nok',client_reference_id:reference,payment_status:'paid',line_items:{data:[{quantity:1,price:{id:'price_module',unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_module',status:'succeeded',latest_charge:{paid:true,refunded:false,disputed:false,amount_refunded:0}}};
  const fetcher:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes('/prices/')?{unit_amount:1000,currency:'nok',recurring:{interval:'month',interval_count:1}}:session));
  const webhook={type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_beliefs',client_reference_id:reference}}};
  assert.equal(await syncBeliefPurchase(deps(),webhook,{},fetcher),true);assert.equal(await syncBeliefPurchase(deps(),webhook,{},fetcher),true);
  assert.equal((await repo().load(hash))!.enrollment.standing,'active');assert.equal((await db!.sql`select count(*)::int as count from message_outbox where kind='beliefs'`)[0]!['count'],1);
  assert.deepEqual(await db!.store.load(phone),before);
});

test('moving one daily appointment preserves its following usual occurrence and guards retries',options,async()=>{
  await enroll();const before=await db!.store.load(phone);
  const booked=new Date('2026-10-11T06:30:00Z'), moved=new Date('2026-10-11T05:30:00Z');
  await db!.sql`update belief_enrollments set daily_minute=510,next_daily_at=${booked},next_weekly_at=${new Date('2026-10-11T15:30:00Z')} where phone_hash=${hash}`;
  const form=new URLSearchParams({action:'occurrence',kind:'daily',expected_at:booked.toISOString(),occurrence:moved.toISOString()});
  await repo().occurrence(hash,form,now);
  let e=(await repo().load(hash))!.enrollment;assert.equal(e.daily_minute,510);assert.equal(e.next_daily_at!.toISOString(),moved.toISOString());
  assert.equal(e.daily_resume_at!.toISOString(),'2026-10-12T06:30:00.000Z');
  await assert.rejects(()=>repo().occurrence(hash,form,now));
  const [s]=await claimBeliefs(deps(),moved);assert.equal(s!.kind,'daily');
  e=(await repo().load(hash))!.enrollment;assert.equal(e.next_daily_at!.toISOString(),'2026-10-12T06:30:00.000Z');assert.equal(e.daily_resume_at,null);
  assert.deepEqual(await db!.store.load(phone),before);
});
test('skip affects one occurrence; STOP, coverage and adjacent slots override moving',options,async()=>{
  await enroll();const booked=new Date('2026-10-11T06:30:00Z');
  await db!.sql`update belief_enrollments set daily_minute=510,next_daily_at=${booked},next_weekly_at=${new Date('2026-10-11T15:30:00Z')} where phone_hash=${hash}`;
  const form=new URLSearchParams({action:'occurrence',kind:'daily',expected_at:booked.toISOString(),occurrence:'2026-10-11T15:15:00Z'});
  await assert.rejects(()=>repo().occurrence(hash,form,now));
  form.set('occurrence','2026-10-11T05:30:00Z');process.env['BELIEFS_COVERAGE_START']='08:00';process.env['BELIEFS_COVERAGE_END']='20:00';
  await assert.rejects(()=>repo().occurrence(hash,form,now));process.env['BELIEFS_COVERAGE_START']='00:00';process.env['BELIEFS_COVERAGE_END']='24:00';
  await db!.sql`update callers set all_calls_stopped=true where phone_hash=${hash}`;
  await assert.rejects(()=>repo().occurrence(hash,form,now));await db!.sql`update callers set all_calls_stopped=false where phone_hash=${hash}`;
  form.set('action','skip');await repo().occurrence(hash,form,now);
  assert.equal((await repo().load(hash))!.enrollment.next_daily_at!.toISOString(),'2026-10-12T06:30:00.000Z');
  await assert.rejects(()=>repo().occurrence(hash,form,now));
});
test('active usual schedule edits omit onboarding and keep original review origin',options,async()=>{
  await enroll();const before=(await repo().load(hash))!.enrollment.review_origin;
  await repo().schedule(hash,new URLSearchParams({timezone:'Europe/Oslo',daily:'09:30',weekly:'18:30',weekday:'2'}),now);
  const e=(await repo().load(hash))!.enrollment;assert.equal(e.onboarding_at,null);assert.equal(e.daily_minute,570);assert.deepEqual(e.review_origin,before);
});
test('verified unfinished onboarding keeps genuine discovery and provides one continuation notice',options,async()=>{
  await enroll(false);await db!.sql`update belief_enrollments set standing='active',onboarding_at=${now} where phone_hash=${hash}`;
  const [s]=await claimBeliefs(deps(),now);await db!.sql`update call_attempts set status='placed',provider_call_id='partial_onboarding' where id=${s!.id}`;
  const text='Speak at the next discussion';
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'partial-outcome',caller_text:text,command:{type:'outcome',outcome:text}},now);
  assert.equal((await settleBeliefs(payload('partial_onboarding',text),deps(),undefined,now))!.status,'interrupted');
  const loaded=(await repo().load(hash))!;assert.equal(loaded.practice.outcome,text);assert.equal(loaded.practice.understood,false);assert.equal(loaded.enrollment.next_daily_at,null);
  const [message]=await db!.sql`select payload_enc from message_outbox where reference=${s!.id}`;assert.ok(decrypt(message!['payload_enc']).includes('unfinished'));assert.ok(!decrypt(message!['payload_enc']).includes(text));
});
test('late daily and weekly occurrences each owe at most one neutral recovery notice',options,async()=>{
  await enroll();await db!.sql`update belief_enrollments set next_daily_at=${new Date(+now-2*86400_000)},next_weekly_at=${new Date(+now-86400_000)} where phone_hash=${hash}`;
  assert.equal((await claimBeliefs(deps(),now)).length,0);assert.equal((await claimBeliefs(deps(),now)).length,0);
  const messages=await db!.sql`select payload_enc from message_outbox where kind='beliefs'`;assert.equal(messages.length,2);
  for(const m of messages){const text=decrypt(m['payload_enc']);assert.ok(text.includes('Check or change'));assert.ok(!text.includes('rang'));assert.ok(!text.includes('Decision'));}
});
test('an ambiguous voice score cannot retire a decision until the caller chooses one',options,async()=>{
  await enroll();let p=(await repo().load(hash))!.practice;const id=p.beliefs[0]!.id;
  p=run(p,{type:'review',id,week:0,score:1,reflection:'My previous reflection',confirmed:true});
  await db!.sql`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(p))},revision=${p.revision},next_daily_at=null,next_weekly_at=${now},review_origin=${new Date(+now-7*86400_000)} where phone_hash=${hash}`;
  const [s]=await claimBeliefs(deps(),now);assert.equal(s!.week,1);
  await db!.sql`update call_attempts set status='placed',provider_call_id='ambiguous_rating' where id=${s!.id}`;
  const command={type:'review',id,score:1,reflection:'My current reflection',confirmed:true};
  await assert.rejects(()=>beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'ambiguous',caller_text:'One or two. My current reflection. Yes.',command},now));
  assert.equal((await repo().load(hash))!.practice.beliefs[0]!.status,'active');
  const turns=['One or two. My current reflection.','I choose one.','Yes, correct.'];
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'chosen',caller_text:turns.join(' '),command},now);
  await settleBeliefs(payload('ambiguous_rating',turns),deps(),undefined,now);
  const saved=(await repo().load(hash))!.practice.beliefs[0]!;
  assert.equal(saved.status,'retired');assert.deepEqual(saved.reviews.map(r=>r.score),[1,1]);
});
test('programme completion clears future times and sends one content-free completion notice',options,async()=>{
  await enroll();let p=initial();
  for(const b of p.beliefs.slice(0,2))for(let week=0;week<2;week++)p=run(p,{type:'review',id:b.id,week,score:1,reflection:'Some reflection',confirmed:true});
  const id=p.beliefs[2]!.id;p=run(p,{type:'prepare',id,decision:'The final decision',evidence:['Some genuine evidence'],balance:'Some difficulty',opportunity:'Some opportunity',confirmed:true});
  p=run(p,{type:'review',id,week:2,score:1,reflection:'My earlier reflection',confirmed:true});
  await db!.sql`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(p))},revision=${p.revision},next_daily_at=${new Date(+now+86400_000)},next_weekly_at=${now},review_origin=${new Date(+now-21*86400_000)} where phone_hash=${hash}`;
  const [s]=await claimBeliefs(deps(),now);await db!.sql`update call_attempts set status='placed',provider_call_id='final_review' where id=${s!.id}`;
  const turns=['One. My final reflection.','Yes, correct.'];
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'final-review',caller_text:turns.join(' '),command:{type:'review',id,score:1,reflection:'My final reflection',confirmed:true}},now);
  assert.equal((await settleBeliefs(payload('final_review',turns),deps(),undefined,now))!.status,'completed');
  const result=(await repo().load(hash))!;assert.equal(result.practice.state,'completed');assert.equal(result.enrollment.next_daily_at,null);assert.equal(result.enrollment.next_weekly_at,null);
  await settleBeliefs(payload('final_review',turns),deps(),undefined,now);
  const messages=await db!.sql`select payload_enc from message_outbox where reference=${s!.id}`;assert.equal(messages.length,1);assert.ok(decrypt(messages[0]!['payload_enc']).includes('Calls have stopped'));assert.ok(!decrypt(messages[0]!['payload_enc']).includes('My final reflection'));
  await assert.rejects(()=>repo().command(hash,{type:'resume'},'completed-resume'));
});
test('failed urgent alerts remain durable; repeated flags do not create duplicate notices',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);
  for(let i=0;i<2;i++)await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),caller_text:'I have thoughts of suicide'},now);
  const [message]=await db!.sql`select id,payload_enc from message_outbox where kind='safety'`;assert.ok(message);
  const broken=deps();broken.sms={send:async()=>{throw new SendFailure('retry','synthetic transport failure');}};
  assert.equal(await dispatchMessage(broken,message['id'],now),'pending');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='safety'`)[0]!['n'],1);
  assert.equal((await db!.sql`select held_for_review from callers where phone_hash=${hash}`)[0]!['held_for_review'],true);
  assert.equal(await dispatchMessage(deps(),message['id'],new Date(+now+60001)),'accepted');
});
test('failed tier-two digest remains in the outbox for recovery rather than waiting a day',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),caller_text:'I feel unsafe'},now);
  const broken=deps();broken.sms={send:async()=>{throw new SendFailure('retry','synthetic transport failure');}};
  const evening=new Date('2026-10-10T18:00:00Z');await safetyDigest(broken,evening);await safetyDigest(broken,evening);
  const messages=await db!.sql`select id,status from message_outbox where kind='safety'`;assert.equal(messages.length,1);assert.equal(messages[0]!['status'],'pending');
  assert.equal(await dispatchMessage(deps(),messages[0]!['id'],new Date(+evening+60001)),'accepted');
});
test('reordered payment events re-read authoritative state and cannot undo a refund/dispute',options,async()=>{
  await enroll(false);const reference=(await repo().load(hash))!.enrollment.checkout_reference;let paid=true;let disputed=false;let refunded=false;
  const fetcher:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes('/prices/')?{unit_amount:1000,currency:'nok',recurring:{interval:'month',interval_count:1}}:{id:'cs_ordered',mode:'payment',amount_subtotal:1000,currency:'nok',client_reference_id:reference,payment_status:paid?'paid':'unpaid',line_items:{data:[{quantity:1,price:{id:'price_module',unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_ordered',status:paid?'succeeded':'processing',latest_charge:{paid,disputed,refunded,amount_refunded:refunded?1000:0}}}));
  const completed={type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_ordered',client_reference_id:reference}}};
  paid=false;await syncBeliefPurchase(deps(),completed,{},fetcher);assert.equal((await repo().load(hash))!.enrollment.standing,'payment_hold');
  paid=true;await syncBeliefPurchase(deps(),completed,{},fetcher);assert.equal((await repo().load(hash))!.enrollment.standing,'active');
  for(const type of ['charge.dispute.created','charge.refunded']){
    if(type==='charge.dispute.created')disputed=true;else refunded=true;
    await syncBeliefPurchase(deps(),{type,data:{object:{object:'charge',payment_intent:'pi_ordered'}}},{},fetcher);
    await syncBeliefPurchase(deps(),completed,{},fetcher);assert.equal((await repo().load(hash))!.enrollment.standing,'payment_hold');
  }
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='beliefs'`)[0]!['n'],1);
});
function fakeReady():void {
  for(const key of ['BELIEFS_ENABLED','BELIEFS_LIVE_CALLS','BELIEFS_SAFETY_APPROVED','BELIEFS_SCRIPTS_APPROVED','BELIEFS_AGENTS_VERIFIED','BELIEFS_PRICE_VERIFIED'])process.env[key]='true';
  Object.assign(process.env,{BELIEFS_PRICE_LABEL:'Synthetic price',BELIEFS_CHECKOUT_URL:'https://buy.stripe.com/synthetic',BELIEFS_SUPPORT_HOURS:'Synthetic staffed test window',SUPPORT_EMAIL:'support@example.com',BELIEFS_ONBOARDING_AGENT_ID:'synthetic-onboard',BELIEFS_DAILY_AGENT_ID:'synthetic-daily',BELIEFS_WEEKLY_AGENT_ID:'synthetic-weekly',TWILIO_ACCOUNT_SID:'synthetic',TWILIO_AUTH_TOKEN:'synthetic',SMS_FROM_NUMBER:'+4791000000',SPEECHIFY_API_KEY:'synthetic',SPEECHIFY_WEBHOOK_SECRET:'synthetic',STRIPE_WEBHOOK_SECRET:'synthetic'});
}
test('an uncertain provider placement is never automatically retried',options,async()=>{
  await enroll();fakeReady();
  let requests=0;const fetcher:typeof fetch=async()=>{requests++;throw new Error('synthetic uncertain request');};
  const first=await tickBeliefs(deps(),now,fetcher);assert.equal(first.claimed,1);assert.equal(first.failed,1);
  await tickBeliefs(deps(),new Date(+now+60000),fetcher);assert.equal(requests,1);
  const [attempt]=await db!.sql`select status,note from call_attempts`;assert.equal(attempt!['status'],'claimed');assert.ok(attempt!['note'].includes('do not redial'));
});
test('missing caller words and invalid scoped credentials cannot return a successful safety check',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);const before=(await repo().load(hash))!.practice;
  await assert.rejects(()=>beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),caller_text:'   '},now));
  await assert.rejects(()=>beliefTool(deps(),{session_id:s!.id,session_token:'wrong',caller_text:'Some words'},now));
  assert.deepEqual((await repo().load(hash))!.practice,before);
});
test('schedule collision checks compare actual instants across different saved zones',options,async()=>{
  await enroll();await db!.sql`update callers set slot_weekday=2,slot_minute=600,timezone='Europe/Oslo' where phone_hash=${hash}`;
  // London 09:00 and Oslo 10:00 are the same appointment during this test window.
  await assert.rejects(()=>repo().schedule(hash,new URLSearchParams({timezone:'Europe/London',daily:'09:00',weekly:'18:00',weekday:'0'}),now));
  await repo().schedule(hash,new URLSearchParams({timezone:'Europe/London',daily:'11:00',weekly:'18:00',weekday:'0'}),now);
  assert.equal((await repo().load(hash))!.enrollment.timezone,'Europe/London');
});
test('voice context includes preferred identity and first-month timing without base memories',options,async()=>{
  await enroll();fakeReady();
  await db!.sql`update belief_enrollments set next_daily_at=${new Date(+now+86400_000)},next_weekly_at=${now},review_origin=${new Date(+now-21*86400_000)} where phone_hash=${hash}`;
  let requests=0;const fetcher:typeof fetch=async(_url,init)=>{
    requests++;const body=JSON.parse(String(init!.body));const variables=body.dynamic_variables;const context=JSON.parse(variables.belief_context);
    assert.equal(context.call_context.preferred_name,'Synthetic tester');assert.equal(context.call_context.first_month_review,true);assert.equal(context.call_context.review_period,3);
    assert.equal(variables.call_kind,'weekly');assert.equal(variables.last_belief,undefined);assert.equal(variables.call_number,undefined);assert.equal(context.commitment,undefined);
    return new Response(JSON.stringify({conversation_id:'synthetic_context_call'}));
  };
  const result=await tickBeliefs(deps(),now,fetcher);assert.equal(result.placed,1);assert.equal(requests,1);
});
test('private owner export omits operator contacts and credentials serialized inside tool arguments',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);
  await db!.sql`update call_attempts set status='placed',provider_call_id='export_redaction' where id=${s!.id}`;
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),caller_text:'I have thoughts of suicide'},now);
  const body=JSON.stringify({messages:[{role:'tool',arguments:JSON.stringify({session_token:'synthetic-session-credential',caller_text:'Some caller words'})}]});
  await db!.sql`insert into webhook_deliveries(id,event,conversation_id,body_enc) values('synthetic-export','conversation.completed','export_redaction',${encrypt(body)})`;
  const exported=await composeExport(db!.store,phone,loadScript(),{includeBeliefs:true});
  assert.ok(exported!.body.includes('My outcome'));assert.ok(exported!.body.includes('Some caller words'));
  assert.ok(exported!.body.includes('operator contact omitted'));assert.ok(!exported!.body.includes('+4791000000'));assert.ok(!exported!.body.includes('synthetic-session-credential'));
  const [stored]=await db!.sql`select body_enc from webhook_deliveries where id='synthetic-export'`;assert.equal(decrypt(stored!['body_enc']),body);
});
test('combined-account signup preferences stay encrypted and support email never enters voice context',options,async()=>{
  await db!.store.upsertProfile(phone,{name:'Weekly name',email:'weekly@example.com'});const before=await db!.store.load(phone);
  await repo().enroll(hash,now,{name:'Beliefs name',email:'support-only@example.com'});
  assert.deepEqual((await repo().load(hash))!.practice.contact,{name:'Beliefs name',email:'support-only@example.com'});
  assert.deepEqual(await db!.store.load(phone),before);
  fakeReady();await db!.sql`update belief_enrollments set standing='active',onboarding_at=${now} where phone_hash=${hash}`;
  const fetcher:typeof fetch=async(_url,init)=>{
    const variables=JSON.parse(String(init!.body)).dynamic_variables;const context=JSON.parse(variables.belief_context);
    assert.equal(context.call_context.preferred_name,'Beliefs name');assert.equal(context.contact,undefined);assert.ok(!variables.belief_context.includes('support-only@example.com'));
    return new Response(JSON.stringify({conversation_id:'combined_identity'}));
  };
  assert.equal((await tickBeliefs(deps(),now,fetcher)).placed,1);
  const [s]=await db!.sql`select id from belief_sessions`;
  const result=await beliefTool(deps(),{session_id:s!['id'],session_token:token(s!['id']),event_id:'combined-outcome',caller_text:'My chosen outcome',command:{type:'outcome',outcome:'My chosen outcome'}},now);
  assert.equal((result['practice'] as Practice).contact,undefined);assert.deepEqual(await db!.store.load(phone),before);
});
test('Lemon Squeezy one-time purchase and reordered refund remain isolated from weekly billing',options,async()=>{
  await enroll(false);const before=await db!.store.load(phone);const reference=(await repo().load(hash))!.enrollment.checkout_reference;process.env['BILLING_PROVIDER']='lemonsqueezy';process.env['BELIEFS_PRODUCT_ID']='100';process.env['BELIEFS_BASE_PRICE_ID']='200';process.env['LEMONSQUEEZY_API_KEY']='synthetic';
  let refunded=false;let wrongProduct=false;
  const fetcher:typeof fetch=async url=>{
    const path=String(url);
    const data=path.includes('/orders/')?{id:'123',attributes:{first_order_item:{variant_id:wrongProduct?999:100,price:1000},subtotal:1000,currency:'NOK',store_id:1,status:'paid',refunded,refunded_amount:refunded?1000:0},relationships:{'order-items':{data:[{id:'item'}]}}}:path.includes('/variants/100')?{attributes:{is_subscription:false,price:1000}}:path.includes('/variants/200')?{attributes:{is_subscription:true,interval:'month',interval_count:1,price:1000}}:{attributes:{currency:'NOK'}};
    return new Response(JSON.stringify({data}));
  };
  const event=(name:string)=>({meta:{event_name:name,custom_data:{phone_hash:reference}},data:{type:'orders',id:'123'}});
  wrongProduct=true;await assert.rejects(()=>syncBeliefPurchase(deps(),event('order_created'),{},fetcher));assert.equal((await repo().load(hash))!.enrollment.standing,'awaiting_payment');
  wrongProduct=false;await syncBeliefPurchase(deps(),event('order_created'),{},fetcher);await syncBeliefPurchase(deps(),event('order_created'),{},fetcher);
  assert.equal((await repo().load(hash))!.enrollment.standing,'active');
  refunded=true;await syncBeliefPurchase(deps(),event('order_refunded'),{},fetcher);await syncBeliefPurchase(deps(),event('order_created'),{},fetcher);
  assert.equal((await repo().load(hash))!.enrollment.standing,'payment_hold');assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='beliefs'`)[0]!['n'],1);assert.deepEqual(await db!.store.load(phone),before);
});
