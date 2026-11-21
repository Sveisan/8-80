import{test,beforeEach,after}from'node:test';import assert from'node:assert/strict';
import{openTestDb}from'./helpers/db.ts';import{phoneKey}from'../src/store/postgres.ts';import{Scheduler}from'../src/schedule/scheduler.ts';import{loadScript}from'../src/script.ts';
import{UnblockRepository,callsAllowed}from'../src/unblock/repository.ts';import{acceptConsumerTerms,requestWithdrawal,maintainUnblockConsumer,confirmUnblockRefund,trackErasedWithdrawal,openUnblockRefundReview,reviewUnblockRefund,type RefundRequest}from'../src/unblock/consumer.ts';
import{consumerDeadline,CONSUMER_TERMS_VERSION}from'../src/unblock/consumer-policy.ts';import{syncUnblockSubscription}from'../src/unblock/billing.ts';import{dispatchMessages}from'../src/messages/outbox.ts';import{composeExport}from'../src/legal/export.ts';import type{LoopDeps}from'../src/loop/deps.ts';
const opened=await openTestDb('unblock_consumer'),db=typeof opened==='string'?undefined:opened,options={skip:typeof opened==='string'?opened:false};
const now=new Date('2026-11-10T10:00:00Z'),phone='+4791000095',hash=phoneKey(phone),product='prod_consumer';
let cancelled=0,failCancel=false,failEvidence=false,refundSucceeded=true,refundAmount=24900;let emails:{to:string;subject:string}[]=[];
const subscription=()=>({provider:'stripe' as const,subscriptionId:'sub_consumer',customerId:'cus_consumer',productIds:[product],standing:'active' as const,status:'active',event:'test',cancelAtPeriodEnd:cancelled>0,endsAt:'2026-12-10T10:00:00Z'});
const deps=():LoopDeps=>({store:db!.store,scheduler:new Scheduler(db!.sql),script:loadScript(),agent:{placeCall:async()=>{throw Error('No calls in this test');}} as unknown as LoopDeps['agent'],sms:{send:async()=>{throw Error('No SMS expected');}},mailer:{send:async(to,body)=>{emails.push({to,subject:body.subject});return{id:'synthetic-email'};}},billing:{subscription:async()=>subscription(),cancel:async()=>{if(failCancel)throw Error('Synthetic provider unavailable');cancelled++;return subscription();},portal:async()=>{throw Error('No portal');}},unblockCommerce:{contract:async()=>{if(failEvidence)throw Error('Synthetic missing proof');return{at:now,paidAt:now,invoiceId:'in_consumer_first',paymentId:'pi_consumer_first',amount:24900,currency:'nok'};},refund:async id=>({id,invoiceId:'in_consumer_first',amount:refundAmount,currency:'nok',succeeded:refundSucceeded})}});
const loaded=async()=> (await new UnblockRepository(db!.sql).load(hash))!;
async function create(early=true){
 await db!.store.upsertProfile(phone,{name:'Synthetic consumer',email:'weekly@example.com'});
 await new UnblockRepository(db!.sql).enroll(hash,new Date(+now-86400_000),undefined,true);
 await db!.sql`update unblock_enrollments set weekly_weekday=2,weekly_minute=900,opening_at=${new Date(+now+86400_000)} where phone_hash=${hash}`;
 await acceptConsumerTerms(db!.sql,hash,'contract@example.com',early,new Date(+now-60000));
}
async function paid(at=now){const e=(await loaded()).enrollment;return syncUnblockSubscription(deps(),{type:'checkout.session.completed',data:{object:{object:'checkout.session',client_reference_id:e.checkout_reference,subscription:'sub_consumer',customer:'cus_consumer',payment_status:'paid'}}},{},at);}
async function deliver(at=now){await dispatchMessages(deps(),at);await db!.sql`update message_outbox set status='delivered',delivered_at=${at} where kind='unblock-legal' and event_key like 'unblock:contract:%'`;await maintainUnblockConsumer(deps(),at);}
beforeEach(async()=>{
 if(db){const tables=await db.sql<{tablename:string}[]>`select tablename from pg_tables where schemaname=current_schema() and tablename<>'__drizzle_migrations'`;const names=tables.map(x=>x.tablename).filter(n=>/^[a-z_]+$/.test(n));await db.sql.unsafe(`truncate ${names.map(n=>'"'+n+'"').join(',')} cascade`);}
 Object.assign(process.env,{DATA_ENCRYPTION_KEY:Buffer.alloc(32,31).toString('base64'),UNBLOCK_PRODUCT_ID:product,PUBLIC_URL:'https://unblock.example',UNBLOCK_CONSUMER_NOTICES_APPROVED:CONSUMER_TERMS_VERSION,BILLING_PROVIDER:'stripe',COMPANY_NAME:'Synthetic Company',COMPANY_ORGNR:'000000000',COMPANY_ADDRESS:'Synthetic address',SUPPORT_EMAIL:'support@example.com'});
 cancelled=0;failCancel=failEvidence=false;refundSucceeded=true;refundAmount=24900;emails=[];
});after(async()=>db?.close());
test('payment records provider contract/payment evidence once, independent of delayed/duplicate callbacks',options,async()=>{
 await create();const later=new Date(+now+2*86400_000);await paid(later);await paid(later);
 const e=(await loaded()).enrollment;assert.equal(e.contract_at?.toISOString(),now.toISOString());assert.equal(e.paid_at?.toISOString(),now.toISOString());assert.equal(e.amount_minor,24900);assert.equal(e.purchase_id,'in_consumer_first');assert.equal(callsAllowed(e,later),false);
 assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='unblock-legal'`)[0]!['n'],1);
});
test('failed canonical evidence preserves paid standing but blocks calls, then retries without fabricating dates',options,async()=>{
 await create();failEvidence=true;await paid();let e=(await loaded()).enrollment;assert.equal(e.standing,'active');assert.equal(e.contract_at,null);assert.equal(callsAllowed(e,now),false);
 failEvidence=false;await maintainUnblockConsumer(deps(),new Date(+now+60000));e=(await loaded()).enrollment;assert.equal(e.contract_at?.toISOString(),now.toISOString());assert.equal(callsAllowed(e,now),false);
});
test('consumer template approval blocks all transport attempts until that exact version is approved',options,async()=>{
 await create();await paid();process.env['UNBLOCK_CONSUMER_NOTICES_APPROVED']='false';await dispatchMessages(deps(),now);assert.equal(emails.length,0);assert.equal((await db!.sql`select attempts from message_outbox where kind='unblock-legal'`)[0]!['attempts'],0);
 process.env['UNBLOCK_CONSUMER_NOTICES_APPROVED']=CONSUMER_TERMS_VERSION;await dispatchMessages(deps(),now);assert.equal(emails.length,1);assert.equal(emails[0]?.to,'contract@example.com');
});
test('provider acceptance is not delivery; early calls start only after durable delivery',options,async()=>{
 await create();await paid();await dispatchMessages(deps(),now);await maintainUnblockConsumer(deps(),now);assert.equal(callsAllowed((await loaded()).enrollment,now),false);
 await deliver();assert.equal(callsAllowed((await loaded()).enrollment,now),true);assert.equal(emails.length,1);
});
test('without an early request the opening moves past the actual withdrawal deadline',options,async()=>{
 await create(false);await paid();await deliver();const e=(await loaded()).enrollment;const deadline=consumerDeadline(e)!;assert.equal(callsAllowed(e,now),false);assert.ok(e.opening_at&&e.opening_at>deadline);assert.equal(callsAllowed(e,new Date(+deadline+1)),true);
});
test('saved pre-payment review is immutable and cannot silently change email or early-start choice',options,async()=>{
 await create(false);await assert.rejects(()=>acceptConsumerTerms(db!.sql,hash,'other@example.com',true,now));assert.equal((await loaded()).enrollment.early_start_at,null);
});
test('withdrawal under STOP/review is immediate, idempotent and cannot change the repayment deadline',options,async()=>{
 await create();await paid();await deliver();await db!.sql`update callers set all_calls_stopped=true,held_for_review=true where phone_hash=${hash}`;
 const [one,two]=await Promise.all([requestWithdrawal(deps(),hash,now),requestWithdrawal(deps(),hash,new Date(+now+60000))]);assert.equal(one.id,two.id);assert.equal(+one.repay_by,+two.repay_by);assert.equal(one.guaranteed,true);
 const e=(await loaded()).enrollment;assert.equal(callsAllowed(e,new Date(+now+365*86400_000)),false);assert.deepEqual([e.opening_at,e.next_weekly_at,e.next_light_at],[null,null,null]);assert.equal((await db!.sql`select count(*)::int as n from unblock_refund_requests`)[0]!['n'],1);
});
test('cancellation failure leaves a stopped, unresolved withdrawal and retries independently of repayment',options,async()=>{
 await create();await paid();await deliver();const r=await requestWithdrawal(deps(),hash,now);failCancel=true;await maintainUnblockConsumer(deps(),now);
 let row=(await db!.sql<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id}`)[0]!;assert.equal(row.status,'requested');assert.equal(row.cancel_confirmed_at,null);assert.equal(callsAllowed((await loaded()).enrollment,now),false);
 failCancel=false;await maintainUnblockConsumer(deps(),new Date(+now+6*60000));row=(await db!.sql<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id}`)[0]!;assert.ok(row.cancel_confirmed_at);assert.equal(row.status,'requested');assert.equal(cancelled,1);
});
test('a pending or partial provider refund is never recorded as full repayment; confirmation is idempotent',options,async()=>{
 await create();await paid();await deliver();const r=await requestWithdrawal(deps(),hash,now);await maintainUnblockConsumer(deps(),now);
 refundSucceeded=false;await assert.rejects(()=>confirmUnblockRefund(deps(),r.id,'re_test',now));refundSucceeded=true;refundAmount=100;await assert.rejects(()=>confirmUnblockRefund(deps(),r.id,'re_test',now));refundAmount=24900;
 await confirmUnblockRefund(deps(),r.id,'re_test',now);await confirmUnblockRefund(deps(),r.id,'re_test',now);const [row]=await db!.sql<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id}`;assert.equal(row?.status,'refunded');assert.equal(row?.refund_id,'re_test');assert.equal(callsAllowed((await loaded()).enrollment,now),false);
});
test('human review cannot reduce a guaranteed initial refund; separate service-failure reviews accept a proportional amount',options,async()=>{
 await create();await paid();await deliver();const r=await requestWithdrawal(deps(),hash,now);await assert.rejects(()=>reviewUnblockRefund(db!.sql,r.id,'in_other',100));
 const e=(await loaded()).enrollment;await openUnblockRefundReview(db!.sql,e.id,'service_failure',now);const [review]=await db!.sql<RefundRequest[]>`select * from unblock_refund_requests where reason='service_failure'`;await reviewUnblockRefund(db!.sql,review!.id,'in_consumer_first',12450,now);assert.equal((await db!.sql`select amount_minor from unblock_refund_requests where id=${review!.id}`)[0]!['amount_minor'],12450);
});
test('account erasure unlinks repayment metadata, and a signed late checkout cannot recreate the account',options,async()=>{
 await create();const e=(await loaded()).enrollment;const r=await requestWithdrawal(deps(),hash,now);await db!.sql`delete from callers where phone_hash=${hash}`;
 const [unlinked]=await db!.sql<RefundRequest[]>`select * from unblock_refund_requests where id=${r.id}`;assert.equal(unlinked?.enrollment_id,null);
 assert.equal(await trackErasedWithdrawal(deps(),e.checkout_reference,'sub_consumer','stripe',now),true);await maintainUnblockConsumer(deps(),now);assert.equal((await db!.sql`select count(*)::int as n from callers`)[0]!['n'],0);assert.equal((await db!.sql`select count(*)::int as n from unblock_enrollments`)[0]!['n'],0);assert.equal(cancelled,1);
});
test('withdrawal/refund data is exported only through Unblock-verified access',options,async()=>{
 await create();await paid();const r=await requestWithdrawal(deps(),hash,now);
 const weekly=await composeExport(db!.store,phone,loadScript());assert.ok(!weekly!.body.includes(r.id));const full=await composeExport(db!.store,phone,loadScript(),{includeUnblock:true});assert.ok(full!.body.includes(r.id));
});

test('restarting an ended subscription requires a fresh immutable review and clears earlier call evidence',options,async()=>{
 await create();await paid();await deliver();const before=await loaded();await db!.sql`update unblock_enrollments set standing='ended' where phone_hash=${hash}`;
 const later=new Date(+now+40*86400_000);await acceptConsumerTerms(db!.sql,hash,'new-contract@example.com',false,later);const after=await loaded();
 assert.equal(after.enrollment.contract_at,null);assert.equal(after.enrollment.contract_subscription_id,null);assert.equal(after.enrollment.information_delivered_at,null);assert.equal(after.enrollment.early_start_at,null);assert.equal(+after.enrollment.terms_accepted_at!,+later);assert.deepEqual(after.programme,before.programme);
 await assert.rejects(()=>acceptConsumerTerms(db!.sql,hash,'another@example.com',true,new Date(+later+1000)));
});

test('an earlier received email notice can shorten a pending repayment deadline, while later retries never extend it',options,async()=>{
 await create();await paid();await deliver();const first=await requestWithdrawal(deps(),hash,new Date(+now+86400_000));const earlier=await requestWithdrawal(deps(),hash,now);
 assert.equal(earlier.id,first.id);assert.equal(+earlier.requested_at,+now);assert.equal(+earlier.repay_by,+now+14*86400_000);
 const retry=await requestWithdrawal(deps(),hash,new Date(+now+3*86400_000));assert.equal(+retry.repay_by,+earlier.repay_by);
});
