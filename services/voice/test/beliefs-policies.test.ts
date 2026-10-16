import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPractice, applyCommand, activeBeliefs, PracticeError, type Practice, type Command } from '../src/beliefs/model.ts';
import { beliefPage } from '../src/beliefs/page.ts';
import { ProgrammePolicies, guaranteedRefund, refundDeadline, maintainBeliefPolicies } from '../src/beliefs/policies.ts';
import { BeliefRepository } from '../src/beliefs/repository.ts';
import { claimBeliefs, settleBeliefs, beliefTool, connectedCallerAt, closeBeliefSession } from '../src/beliefs/runtime.ts';
import { capture, fullCoverage, verifiedPractice, sessionToken, type Snapshot } from '../src/beliefs/protocol.ts';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Links } from '../src/link/token.ts';
import { csrfFor } from '../src/beliefs/http.ts';
import { beliefRoutes } from '../src/beliefs/routes.ts';
import { dispatchMessage } from '../src/messages/outbox.ts';
import { resolveWithoutRefund, releaseUnusedCheckin } from '../src/beliefs/operator.ts';
import { syncBeliefPurchase, readPurchase } from '../src/beliefs/billing.ts';
import { composeExport } from '../src/legal/export.ts';
import { encrypt, decrypt } from '../src/store/crypto.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const now=new Date('2026-10-15T10:00:00Z');const DAY=86400_000;
let event=0;const run=(p:Practice,c:Command)=>applyCommand(p,c,'policy-'+(++event),now);
function ready(count=1):Practice {
  let p=run(emptyPractice(),{type:'outcome',outcome:'Speak up in meetings'});
  for(let i=0;i<count;i++){
    p=run(p,{type:'queue',belief:'Thought '+i,trigger:'Situation '+i});const b=p.beliefs.at(-1)!;
    p=run(p,{type:'prepare',id:b.id,decision:'My decision '+i,evidence:['My real experience'],balance:'Still some doubt',opportunity:'The next meeting',confirmed:true});
  }
  return run(p,{type:'understood',confirmed:true});
}
function complete(p=ready()):Practice {
  for(const b of activeBeliefs(p))for(const week of [0,1])p=run(p,{type:'review',id:b.id,week,score:1,reflection:'My reflection',confirmed:true});
  return p;
}
test('one or two fully prepared decisions can start without a backlog',()=>{
  for(const count of [1,2]){const p=ready(count);assert.equal(p.state,'active');assert.equal(p.beliefs.length,count);}
  const p=ready();p.understood=false;p.beliefs[0]!.confirmed=false;p.beliefs[0]!.status='preparing';
  assert.throws(()=>run(p,{type:'understood',confirmed:true}),PracticeError);
});
test('related additions preserve the purchased outcome and never bypass preparation',()=>{
  let p=ready();p=run(p,{type:'queue',belief:'Another related doubt',trigger:'The same outcome'});
  assert.equal(p.beliefs[1]!.status,'preparing');assert.equal(activeBeliefs(p).length,1);
  assert.throws(()=>run(p,{type:'outcome',outcome:'A different outcome'}),PracticeError);
  assert.throws(()=>run(complete(),{type:'queue',belief:'A new programme',trigger:'New outcome'}),PracticeError);
});
test('removal stops queued material blocking completion without counting it as retired',()=>{
  let p=ready();p=run(p,{type:'queue',belief:'No longer relevant',trigger:'Old situation'});
  const removed=p.beliefs[1]!.id;p=run(p,{type:'remove',id:removed});p=complete(p);
  assert.equal(p.state,'completed');assert.equal(p.beliefs[1]!.status,'removed');assert.equal(p.beliefs[1]!.reviews.length,0);
  assert.throws(()=>run(ready(),{type:'remove',id:ready().beliefs[0]!.id}),PracticeError);
});
test('queue edits while paused never resume calls or erase earlier practice',()=>{
  let p=run(ready(),{type:'pause'});p=run(p,{type:'queue',belief:'Related thought',trigger:'Situation'});
  p=run(p,{type:'remove',id:p.beliefs[1]!.id});assert.equal(p.state,'paused');assert.equal(p.beliefs[0]!.evidence.length,1);
});
test('completion correction requires confirmation and archives the earlier score sequence',()=>{
  const p=complete();const id=p.beliefs[0]!.id;
  assert.throws(()=>run(p,{type:'correct_completion',id,confirmed:false}),PracticeError);
  const corrected=run(p,{type:'correct_completion',id,confirmed:true});
  assert.equal(corrected.state,'active');assert.equal(corrected.beliefs[0]!.status,'preparing');
  assert.equal(corrected.beliefs[0]!.versions![0]!.reviews.length,2);
});
test('refund guarantee includes its exact fourteen-day boundary and unknown connection stays favourable',()=>{
  assert.equal(guaranteedRefund({first_connected_at:null},now),true);
  const first=new Date(+now-14*DAY);assert.equal(refundDeadline(first)!.toISOString(),now.toISOString());
  assert.equal(guaranteedRefund({first_connected_at:first},now),true);
  assert.equal(guaranteedRefund({first_connected_at:first},new Date(+now+1)),false);
});
test('connection clock requires a signed transcript timestamp, excludes machines and refuses invented dates',()=>{
  const payload={data:{messages:[{role:'user',content:'Hello',started_at:now.toISOString()}]}};
  assert.equal(connectedCallerAt(payload,now,now)!.toISOString(),now.toISOString());
  assert.equal(connectedCallerAt({data:{messages:[{role:'user',content:'Hello'}]}},now),undefined);
  assert.equal(connectedCallerAt({...payload,data:{...payload.data,end_reason:'voicemail'}},now),undefined);
  assert.equal(connectedCallerAt(payload,new Date(+now-1)),undefined);
  assert.equal(connectedCallerAt(payload,now,new Date(+now+1)),undefined);
});
test('included check-in needs caller confirmation and cannot score, restart or discover',()=>{
  const p=complete();const s:Snapshot={revision:p.revision,initial:p,practice:p,receipts:[],coverage:{}};
  const words='My decision still helps. Yes, that is correct.';
  const saved=capture(s,'checkin',null,{event_id:'return',caller_text:words,command:{type:'checkin',reflection:'My decision still helps',confirmed:true}},now);
  assert.equal(fullCoverage(saved,'checkin'),true);assert.equal(verifiedPractice(saved,[words]).state,'completed');
  assert.throws(()=>capture(s,'checkin',null,{event_id:'bad',caller_text:'Yes, pause.',command:{type:'pause',confirmed:true}}),PracticeError);
  assert.throws(()=>verifiedPractice(saved,['The agent spoke these words.']),PracticeError);
});

const opened=await openTestDb('beliefs_policies');const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const phone='+4791000048';const hash=phoneKey(phone);
const deps=():LoopDeps=>({store:db!.store,scheduler:new Scheduler(db!.sql),script:loadScript(),agent:{placeCall:async()=>{throw Error('No real calls');}} as unknown as LoopDeps['agent'],sms:{send:async()=>undefined},mailer:{send:async()=>undefined}});
const policies=()=>new ProgrammePolicies(db!.sql);
const repo=(id?:string)=>new BeliefRepository(db!.sql,id);
async function seed(completed=true){
  await db!.store.upsertProfile(phone,{name:'Synthetic policy tester'});
  await db!.sql`update callers set last_commitment_enc=${encrypt('Weekly context stays private')} where phone_hash=${hash}`;
  await repo().enroll(hash,now);const p=completed?complete():ready();const e=(await repo().load(hash))!.enrollment;
  await db!.sql`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(p))},revision=${p.revision},standing='active',provider='stripe',purchase_id='cs_old',payment_id='pi_old',daily_minute=510,weekly_minute=1050,weekly_weekday=0,
    completed_at=${completed?now:null},history_delete_at=${completed?new Date('2027-10-15T10:00:00Z'):null} where id=${e.id}`;
  return e.id;
}
beforeEach(async()=>{
  if(db)await db.sql`truncate belief_refund_requests,belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries,heartbeats`;
  process.env['DATA_ENCRYPTION_KEY']=Buffer.alloc(32,12).toString('base64');
  Object.assign(process.env,{PUBLIC_URL:'https://8and80.example',OPERATOR_PHONE:'+4791000000',BELIEFS_TOOL_SECRET:'t'.repeat(40),BELIEFS_COVERAGE_START:'00:00',BELIEFS_COVERAGE_END:'24:00',BILLING_PROVIDER:'stripe',BELIEFS_PRODUCT_ID:'price_module',BELIEFS_BASE_PRICE_ID:'price_month',STRIPE_SECRET_KEY:'synthetic'});
});
after(async()=>db?.close());
test('new purchase has durable identity; old history and weekly product survive repeated clicks',options,async()=>{
  const old=await seed();const before=await db!.store.load(phone);
  const ids=await Promise.allSettled([policies().newProgramme(hash,old,'A new explicit outcome',true,now),policies().newProgramme(hash,old,'A new explicit outcome',true,now)]);
  assert.equal(ids.filter(r=>r.status==='fulfilled').length,1);
  const current=(await repo().load(hash))!;assert.notEqual(current.enrollment.id,old);assert.equal(current.enrollment.standing,'awaiting_payment');assert.equal(current.enrollment.purchase_id,null);
  assert.equal((await repo(old).load(hash))!.practice.outcome,'Speak up in meetings');assert.deepEqual(await db!.store.load(phone),before);
  assert.equal(current.enrollment.checkout_reference,'beliefs:'+current.enrollment.id);
});
test('unfinished purchases resume for free and cannot be replaced by a new checkout',options,async()=>{
  const id=await seed(false);await repo(id).command(hash,{type:'pause'},'pause');
  await assert.rejects(()=>policies().newProgramme(hash,id,'Different focus',true,now));
  await repo(id).command(hash,{type:'resume'},'resume');assert.equal((await repo(id).load(hash))!.enrollment.purchase_id,'cs_old');
});
test('correction preserves payment, starts a new score version and cancels deletion',options,async()=>{
  const id=await seed();const p=(await repo(id).load(hash))!.practice;
  await repo(id).command(hash,{type:'correct_completion',id:p.beliefs[0]!.id,confirmed:true},'correct',p.revision,now);
  const saved=(await repo(id).load(hash))!;assert.equal(saved.enrollment.purchase_id,'cs_old');assert.equal(saved.enrollment.history_delete_at,null);assert.equal(saved.enrollment.correction_count,1);
  assert.equal(saved.practice.beliefs[0]!.status,'preparing');
});
test('delayed refund callbacks affect only the old purchase, even after a newer programme exists',options,async()=>{
  const id=await seed();const reference=(await repo(id).load(hash))!.enrollment.checkout_reference;
  const next=await policies().newProgramme(hash,id,'A new outcome',true,now);
  const fetcher:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes('/prices/')?{unit_amount:1000,currency:'nok',recurring:{interval:'month',interval_count:1}}:{id:'cs_old',mode:'payment',amount_subtotal:1000,currency:'nok',client_reference_id:reference,payment_status:'paid',line_items:{data:[{quantity:1,price:{id:'price_module',unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_old',status:'succeeded',latest_charge:{paid:true,refunded:true,amount_refunded:1000}}}));
  await syncBeliefPurchase(deps(),{type:'charge.refunded',data:{object:{object:'charge',payment_intent:'pi_old'}}},{},fetcher);
  assert.equal((await repo(id).load(hash))!.enrollment.standing,'payment_hold');assert.equal((await repo(next).load(hash))!.enrollment.standing,'awaiting_payment');
  const nextReference=(await repo(next).load(hash))!.enrollment.checkout_reference;
  await assert.rejects(()=>syncBeliefPurchase(deps(),{type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_old',client_reference_id:nextReference}}},{},fetcher));
});
test('refund requests are idempotent, allow delivery problems outside the guarantee and never issue money',options,async()=>{
  const id=await seed(false);await db!.sql`update belief_enrollments set first_connected_at=${new Date(+now-20*DAY)} where id=${id}`;
  await policies().requestRefund(hash,id,'delivery',deps(),now);await policies().requestRefund(hash,id,'delivery',deps(),now);
  const rows=await db!.sql`select status,guaranteed from belief_refund_requests`;
  assert.equal(rows.length,1);assert.equal(rows[0]!['status'],'requested');assert.equal(rows[0]!['guaranteed'],false);
  assert.equal((await repo(id).load(hash))!.enrollment.standing,'refund_requested');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='operator'`)[0]!['n'],1);
});
test('included check-in is explicitly booked once and is spent only on signed, confirmed delivery',options,async()=>{
  const id=await seed();const at=new Date(+now+60_000);const f=new URLSearchParams({occurrence:at.toISOString(),confirmed:'yes'});
  await policies().bookCheckin(hash,id,f,now);await assert.rejects(()=>policies().bookCheckin(hash,id,f,now));
  const [s]=await claimBeliefs(deps(),at);assert.equal(s!.kind,'checkin');assert.equal(s!.programme_id,id);
  assert.equal((await claimBeliefs(deps(),at)).length,0);assert.equal((await repo(id).load(hash))!.enrollment.checkin_used_at,null);
  const words='My decision still helps. Yes, correct.';
  await beliefTool(deps(),{session_id:s!.id,session_token:sessionToken(s!.id,'t'.repeat(40)),event_id:'return',caller_text:words,command:{type:'checkin',reflection:'My decision still helps',confirmed:true}},at);
  await db!.sql`update call_attempts set provider_call_id='conv_return' where id=${s!.id}`;
  const payload={type:'conversation.completed',data:{conversation_id:'conv_return',duration_ms:60000,messages:[{role:'user',content:words,started_at:at.toISOString()}]}};
  await settleBeliefs(payload,deps(),undefined,new Date(+at+60_000));await settleBeliefs(payload,deps(),undefined,new Date(+at+60_000));
  const e=(await repo(id).load(hash))!.enrollment;assert.ok(e.checkin_used_at);assert.equal(e.next_daily_at,null);assert.equal(e.next_weekly_at,null);
  await assert.rejects(()=>policies().bookCheckin(hash,id,new URLSearchParams({occurrence:new Date(+at+DAY).toISOString(),confirmed:'yes'}),at));
});
test('an uncertain check-in is never automatically redialled or offered again without review',options,async()=>{
  const id=await seed();const at=new Date(+now+60_000);await policies().bookCheckin(hash,id,new URLSearchParams({occurrence:at.toISOString(),confirmed:'yes'}),now);
  const [s]=await claimBeliefs(deps(),at);await closeBeliefSession(deps(),s!.id,at);
  assert.equal((await claimBeliefs(deps(),new Date(+at+DAY))).length,0);assert.equal((await repo(id).load(hash))!.enrollment.checkin_used_at,null);
  await assert.rejects(()=>policies().bookCheckin(hash,id,new URLSearchParams({occurrence:new Date(+at+DAY).toISOString(),confirmed:'yes'}),at));
});
test('STOP and shared holds override included check-in booking',options,async()=>{
  const id=await seed();const f=new URLSearchParams({occurrence:new Date(+now+DAY).toISOString(),confirmed:'yes'});
  await db!.sql`update callers set all_calls_stopped=true where phone_hash=${hash}`;await assert.rejects(()=>policies().bookCheckin(hash,id,f,now));
});
test('retention reminders contain no practice words; failed notices cannot silently erase history',options,async()=>{
  const id=await seed();await db!.sql`update belief_enrollments set history_delete_at=${new Date(+now+30*DAY)} where id=${id}`;
  await maintainBeliefPolicies(deps(),now);await maintainBeliefPolicies(deps(),now);
  const [message]=await db!.sql`select payload_enc from message_outbox where reference=${id}`;assert.ok(message);assert.ok(!decrypt(message['payload_enc']).includes('Speak up'));
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where reference=${id}`)[0]!['n'],1);
  await db!.sql`update message_outbox set status='failed'`;await maintainBeliefPolicies(deps(),new Date(+now+31*DAY));
  assert.equal((await repo(id).load(hash))!.enrollment.history_deleted_at,null);
});
test('a chosen extension resets notice evidence; invalid and shorter dates reject',options,async()=>{
  const id=await seed();await policies().extendHistory(hash,id,'2028-02-29',now);
  assert.equal((await repo(id).load(hash))!.enrollment.history_delete_at!.toISOString(),'2028-02-29T23:59:59.000Z');
  for(const value of ['2028-02-30','2027-01-01','bad'])await assert.rejects(()=>policies().extendHistory(hash,id,value,now));
});
test('scoped cleanup preserves a newer paid purchase, weekly memory and the unused return entitlement',options,async()=>{
  const old=await seed();const next=await policies().newProgramme(hash,old,'A different outcome',true,now);const before=await db!.store.load(phone);
  await db!.sql`update belief_enrollments set history_delete_at=${now},retention_delivered_at=${new Date(+now-30*DAY)} where id=${old}`;
  await maintainBeliefPolicies(deps(),now);await maintainBeliefPolicies(deps(),now);
  const erased=(await repo(old).load(hash))!;assert.ok(erased.enrollment.history_deleted_at);assert.equal(erased.practice.beliefs.length,0);assert.equal(erased.enrollment.checkin_used_at,null);
  assert.equal((await repo(next).load(hash))!.practice.outcome,'A different outcome');assert.deepEqual(await db!.store.load(phone),before);
  const exported=await composeExport(db!.store,phone,loadScript(),{includeBeliefs:true});assert.ok(exported!.body.includes(next));assert.ok(exported!.body.includes(old));assert.ok(!exported!.body.includes('Speak up in meetings'));
  await policies().bookCheckin(hash,old,new URLSearchParams({occurrence:new Date(+now+DAY).toISOString(),confirmed:'yes'}),now);
});
test('explicit programme-history deletion leaves unfinished paid progress and whole-account deletion separate',options,async()=>{
  const old=await seed();const next=await policies().newProgramme(hash,old,'Unfinished progress',true,now);
  await assert.rejects(()=>policies().deleteHistory(hash,next,'DELETE HISTORY',now));await assert.rejects(()=>policies().deleteHistory(hash,old,'DELETE',now));
  await policies().deleteHistory(hash,old,'DELETE HISTORY',now);assert.equal((await repo(next).load(hash))!.practice.outcome,'Unfinished progress');
  await db!.store.forget(phone);assert.equal((await db!.sql`select * from belief_enrollments`).length,0);assert.equal((await db!.sql`select * from belief_refund_requests`).length,0);
});

async function route(token:string,path:string,form?:URLSearchParams,origin?:string){
  const request=new IncomingMessage(new Socket());request.method=form?'POST':'GET';
  request.headers={cookie:'beliefs='+token,...(origin?{origin}:{})};
  request.push(form?.toString()??'');request.push(null);
  return beliefRoutes(request,new URL(path,'https://8and80.example'),deps(),'synthetic-client',now);
}
test('private policy routes require owned programmes, fresh private authority, CSRF and explicit identity',options,async()=>{
  const old=await seed();const token=await new Links(db!.sql).mint(hash,now,'beliefs');
  const next=await policies().newProgramme(hash,old,'A distinct new focus',true,now);
  const missing=await route(token,'/beliefs/action',new URLSearchParams({action:'refund',reason:'delivery',csrf:csrfFor(token)}));
  assert.equal(missing!.status,409);assert.equal((await repo(next).load(hash))!.enrollment.standing,'awaiting_payment');
  const noCsrf=await route(token,'/beliefs/action',new URLSearchParams({action:'refund',programme:old,reason:'delivery'}));assert.equal(noCsrf!.status,403);
  const cross=await route(token,'/beliefs/action',new URLSearchParams({action:'refund',programme:old,csrf:csrfFor(token),reason:'delivery'}),'https://elsewhere.example');assert.equal(cross!.status,403);
  await db!.store.upsertProfile('+4791000049',{name:'Other synthetic customer'});
  const other=phoneKey('+4791000049');await repo().enroll(other,now);const foreign=(await repo().load(other))!.enrollment.id;
  const unavailable=await route(token,'/beliefs/account?programme='+foreign);assert.ok(!unavailable!.body.includes(foreign));
  const browser=await new Links(db!.sql).mint(hash,now,'browser');assert.equal((await route(browser,'/beliefs/account'))!.status,303);
  const oldForm=await route(token,'/beliefs/action',new URLSearchParams({action:'refund',programme:old,reason:'delivery',csrf:csrfFor(token)}));assert.equal(oldForm!.status,303);
  assert.equal((await repo(old).load(hash))!.enrollment.standing,'refund_requested');assert.equal((await repo(next).load(hash))!.enrollment.standing,'awaiting_payment');
});
test('outdated retention reminders are suppressed after explicit extension',options,async()=>{
  const id=await seed();await db!.sql`update belief_enrollments set history_delete_at=${new Date(+now+30*DAY)} where id=${id}`;
  await maintainBeliefPolicies(deps(),now);const [message]=await db!.sql`select id from message_outbox where reference=${id}`;
  await policies().extendHistory(hash,id,'2028-02-29',now);
  const d=deps();d.sms.send=async()=>{throw Error('Outdated notice must never send');};
  assert.equal(await dispatchMessage(d,message!['id'],now),'suppressed');
  assert.equal((await db!.sql`select reason from message_outbox where id=${message!['id']}`)[0]!['reason'],'history_notice_changed');
});
test('operator resolution restores standing without silently restarting; explicit free resume creates future slots',options,async()=>{
  const id=await seed(false);await policies().requestRefund(hash,id,'delivery',deps(),now);
  const [r]=await db!.sql`select id from belief_refund_requests where programme_id=${id}`;await resolveWithoutRefund(db!.sql,r!['id']);
  const paused=(await repo(id).load(hash))!;assert.equal(paused.practice.state,'paused');assert.equal(paused.enrollment.next_daily_at,null);
  await repo(id).command(hash,{type:'resume'},'customer-resume',paused.practice.revision,now);
  const e=(await repo(id).load(hash))!.enrollment;assert.ok(e.next_daily_at!>now);assert.ok(e.next_weekly_at!>now);assert.equal(e.purchase_id,'cs_old');
  await assert.rejects(()=>resolveWithoutRefund(db!.sql,r!['id']));
  await policies().requestRefund(hash,id,'delivery',deps(),now);assert.equal((await repo(id).load(hash))!.enrollment.standing,'active');
});
test('operator release refuses live check-ins and permits a reviewed closed unused attempt to be explicitly rebooked',options,async()=>{
  const id=await seed();const at=new Date(+now+60_000);await policies().bookCheckin(hash,id,new URLSearchParams({occurrence:at.toISOString(),confirmed:'yes'}),now);
  const [session]=await claimBeliefs(deps(),at);await assert.rejects(()=>releaseUnusedCheckin(db!.sql,id));
  await closeBeliefSession(deps(),session!.id,at);await releaseUnusedCheckin(db!.sql,id);
  const e=(await repo(id).load(hash))!.enrollment;assert.equal(e.checkin_attempt_id,null);assert.equal(e.checkin_at,null);assert.equal(e.checkin_used_at,null);
  await policies().bookCheckin(hash,id,new URLSearchParams({occurrence:new Date(+now+DAY).toISOString(),confirmed:'yes'}),at);
});
test('historical Stripe purchase validates against its stored price after current prices change',async()=>{
  process.env['STRIPE_SECRET_KEY']='synthetic';process.env['BELIEFS_PRODUCT_ID']='new_product';
  const fetcher:typeof fetch=async()=>new Response(JSON.stringify({id:'cs_historical',mode:'payment',amount_subtotal:1000,currency:'nok',payment_status:'paid',line_items:{data:[{quantity:1,price:{id:'old_price',unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_historical',status:'succeeded',latest_charge:{paid:true}}}));
  assert.equal((await readPurchase('stripe','cs_historical',fetcher,{productId:'old_price',amount:1000,currency:'nok'})).paid,true);
  await assert.rejects(()=>readPurchase('stripe','cs_historical',fetcher,{productId:'old_price',amount:1000,currency:'eur'}));
});

test('historical Lemon Squeezy refunds retain original amount and currency when the mutable catalogue changes',async()=>{
  process.env['LEMONSQUEEZY_API_KEY']='synthetic';
  const fetcher:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes('/orders/')?{data:{id:'order_old',attributes:{first_order_item:{variant_id:12,price:1000},store_id:2,subtotal:1000,currency:'NOK',status:'refunded',refunded:true},relationships:{'order-items':{data:[{id:'one'}]}}}}:String(url).includes('/variants/')?{data:{attributes:{price:2000,is_subscription:false}}}:{data:{attributes:{currency:'EUR'}}}));
  const p=await readPurchase('lemonsqueezy','order_old',fetcher,{productId:'12',amount:1000,currency:'nok'});assert.equal(p.refunded,true);assert.equal(p.currency,'nok');
  await assert.rejects(()=>readPurchase('lemonsqueezy','order_old',fetcher,{productId:'12',amount:1000,currency:'eur'}));
});
test('failed reminder delivery cannot starve later programme retention notices',options,async()=>{
  const id=await seed();const content=(await repo(id).load(hash))!.enrollment.practice_enc;
  await db!.sql`update belief_enrollments set is_current=false`;
  for(let i=0;i<55;i++)await db!.sql`insert into belief_enrollments(id,phone_hash,is_current,checkout_reference,practice_enc,consent_version,consent_at,completed_at,history_delete_at,updated_at) values(${'fair-'+i},${hash},false,${'beliefs:fair-'+i},${content},'synthetic',${now},${now},${new Date(+now+DAY)},${new Date(+now+i)})`;
  await maintainBeliefPolicies(deps(),now);await db!.sql`update message_outbox set status='failed'`;
  await maintainBeliefPolicies(deps(),new Date(+now+60_000));
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where event_key like 'beliefs:retention:fair-%'`)[0]!['n'],55);
});

test('programme navigation keeps one selected identity and uncertain return attempts explain the recovery path',()=>{
  const html=beliefPage('account',{practice:complete(),programmeId:'current',paid:true,checkinPending:true,programmes:[{id:'current',is_current:true,history_deleted_at:null},{id:'earlier',is_current:false,history_deleted_at:null}]});
  assert.ok(html.includes('href="/beliefs/account?programme=earlier"'));assert.ok(!html.includes('programme=earlier&amp;programme=current'));
  assert.ok(html.includes('We’re checking the previous attempt'));assert.ok(!html.includes('Book my included check-in</button>'));
});
