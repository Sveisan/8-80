import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { BeliefRepository } from '../src/beliefs/repository.ts';
import { emptyPractice, applyCommand, type Practice, type Command } from '../src/beliefs/model.ts';
import { claimBeliefs, beliefTool, settleBeliefs, closeBeliefSession } from '../src/beliefs/runtime.ts';
import { sessionToken } from '../src/beliefs/protocol.ts';
import { encrypt, decrypt } from '../src/store/crypto.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { Links } from '../src/link/token.ts';
import { Pending } from '../src/signup/pending.ts';
import { composeExport } from '../src/legal/export.ts';
import { syncBeliefPurchase } from '../src/beliefs/billing.ts';
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
function payload(id:string,said:string){return {type:'conversation.completed',data:{conversation_id:id,duration_ms:60000,messages:[{role:'user',content:said}]}};}
beforeEach(async()=>{
  if(db)await db.sql`truncate belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries`;
  process.env['DATA_ENCRYPTION_KEY']=Buffer.alloc(32,12).toString('base64');
  process.env['BELIEFS_TOOL_SECRET']='t'.repeat(40);process.env['PUBLIC_URL']='https://8and80.example';process.env['OPERATOR_PHONE']='+4791000000';
  process.env['BILLING_PROVIDER']='stripe';process.env['BELIEFS_PRODUCT_ID']='price_module';process.env['BELIEFS_BASE_PRICE_ID']='price_month';process.env['STRIPE_SECRET_KEY']='test-key';
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
  assert.ok(!retained.includes('I remember a real experience'));
  assert.equal((await settleBeliefs(payload('conversation_one',said),deps(),undefined,now))!.handled,false);
  assert.deepEqual(await db!.store.load(phone),before);
});
test('unconfirmed words and in-call concurrent edits do not overwrite canonical memory',options,async()=>{
  await enroll();const [s]=await claimBeliefs(deps(),now);const b=(await repo().load(hash))!.practice.beliefs[0]!;
  await db!.sql`update call_attempts set status='placed',provider_call_id='conversation_two' where id=${s!.id}`;
  await beliefTool(deps(),{session_id:s!.id,session_token:token(s!.id),event_id:'unverified',caller_text:b.decision+' Genuine new evidence. Still difficult.',command:{type:'practice',id:b.id,evidence:'Genuine new evidence',balance:'Still difficult'}},now);
  assert.equal((await settleBeliefs(payload('conversation_two','Different caller words'),deps(),undefined,now))!.status,'unverified');
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
  assert.equal((await settleBeliefs(payload('onboarding_voice',spoken.join(' ')),deps(),undefined,now))!.status,'completed');
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
  await enroll(false);const before=await db!.store.load(phone);
  const session={id:'cs_beliefs',mode:'payment',amount_subtotal:1000,currency:'nok',client_reference_id:'beliefs:'+hash,payment_status:'paid',line_items:{data:[{quantity:1,price:{id:'price_module',unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_module',status:'succeeded',latest_charge:{paid:true,refunded:false,disputed:false,amount_refunded:0}}};
  const fetcher:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes('/prices/')?{unit_amount:1000,currency:'nok',recurring:{interval:'month',interval_count:1}}:session));
  const webhook={type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_beliefs',client_reference_id:'beliefs:'+hash}}};
  assert.equal(await syncBeliefPurchase(deps(),webhook,{},fetcher),true);assert.equal(await syncBeliefPurchase(deps(),webhook,{},fetcher),true);
  assert.equal((await repo().load(hash))!.enrollment.standing,'active');assert.equal((await db!.sql`select count(*)::int as count from message_outbox where kind='beliefs'`)[0]!['count'],1);
  assert.deepEqual(await db!.store.load(phone),before);
});
