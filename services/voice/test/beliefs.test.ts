import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPractice, applyCommand, activeBeliefs, PracticeError, type Practice, type Command } from '../src/beliefs/model.ts';
import { capture, verifiedPractice, fullCoverage, sessionToken, verifySessionToken, type Snapshot } from '../src/beliefs/protocol.ts';
import { nextDaily, scheduleInput } from '../src/beliefs/repository.ts';
import { readPurchase } from '../src/beliefs/billing.ts';
import { beliefPage } from '../src/beliefs/page.ts';

let event=0;
const run=(p:Practice,c:Command)=>applyCommand(p,c,'event-'+(++event));
function prepared(cap:2|3=2):Practice {
  let p=run(emptyPractice(cap),{type:'outcome',outcome:'A chosen outcome'});
  for(let i=0;i<cap+1;i++)p=run(p,{type:'queue',belief:'Old thought '+i,trigger:'Situation '+i});
  for(const b of p.beliefs.slice(0,cap))p=run(p,{type:'prepare',id:b.id,decision:'My decision '+b.belief,evidence:['My genuine experience'],balance:'A real remaining difficulty',opportunity:'A chosen next step',confirmed:true});
  return run(p,{type:'understood',confirmed:true});
}
const review=(p:Practice,id:string,week:number,score=1)=>run(p,{type:'review',id,week,score,reflection:'My reflection',confirmed:true});
test('onboarding needs outcome, caller authorship, evidence, balance and a backlog',()=>{
  let p=emptyPractice();
  assert.throws(()=>run(p,{type:'understood',confirmed:true}),PracticeError);
  p=run(p,{type:'queue',belief:'Old thought',trigger:'Situation'});
  assert.throws(()=>run(p,{type:'prepare',id:p.beliefs[0]!.id,decision:'New decision',evidence:[],balance:'Difficulty',opportunity:'Step',confirmed:true}),PracticeError);
  assert.throws(()=>run(p,{type:'prepare',id:p.beliefs[0]!.id,decision:'New decision',evidence:['Experience'],balance:'Difficulty',opportunity:'Step',confirmed:false}),PracticeError);
  assert.equal(prepared().understood,true);
});
test('two consecutive low weekly scores retire once and select an unprepared backlog item',()=>{
  let p=prepared();const id=p.beliefs[0]!.id;p=review(p,id,0);assert.equal(activeBeliefs(p).length,2);
  p=review(p,id,1,0);assert.equal(p.beliefs[0]!.status,'retired');assert.equal(p.beliefs[2]!.status,'preparing');assert.equal(activeBeliefs(p).length,1);
  const replacement=p.beliefs[2]!;
  p=run(p,{type:'prepare',id:replacement.id,decision:'My next decision',evidence:['My next experience'],balance:'Still difficult',opportunity:'My next step',confirmed:true});
  assert.equal(activeBeliefs(p).length,2);
});
test('missing week, high score or a changed decision breaks retirement streak',()=>{
  let p=prepared();const id=p.beliefs[0]!.id;
  p=review(p,id,0);p=review(p,id,2);assert.equal(p.beliefs[0]!.status,'active');
  p=review(p,id,3,4);p=review(p,id,4,0);assert.equal(p.beliefs[0]!.status,'active');
  p=run(p,{type:'prepare',id,decision:'My revised decision',evidence:['Experience'],balance:'Difficulty',opportunity:'Step',confirmed:true});
  assert.equal(p.beliefs[0]!.reviews.length,0);assert.equal(p.beliefs[0]!.version,2);
});
test('same-week reviews and out-of-range/model-selected values do not retire beliefs',()=>{
  let p=prepared();const id=p.beliefs[0]!.id;p=review(p,id,0);
  assert.throws(()=>review(p,id,0),PracticeError);
  assert.throws(()=>review(p,id,1,NaN),PracticeError);
  assert.throws(()=>review(p,id,1,11),PracticeError);
  assert.throws(()=>review(p,id,1,0.5),PracticeError);
});
test('event redelivery is idempotent and a paused practice blocks exercises',()=>{
  const p=prepared();const command:Command={type:'pause'};const paused=applyCommand(p,command,'same-event');
  assert.strictEqual(applyCommand(paused,command,'same-event'),paused);
  assert.throws(()=>run(paused,{type:'practice',id:p.beliefs[0]!.id,evidence:'Experience'}),PracticeError);
  assert.equal(run(paused,{type:'resume'}).state,'active');
});
test('three active slots are capped and no AI-authored replacement is pulled into practice',()=>{
  const p=prepared(3);assert.equal(activeBeliefs(p).length,3);assert.equal(p.beliefs[3]!.status,'queued');
  assert.throws(()=>run(p,{type:'queue',belief:'Another thought',trigger:'Situation'}),PracticeError);
});
test('empty backlog ends the paid programme and prevents indefinite new discovery',()=>{
  let p=prepared();for(let i=0;i<2;i++){const id=p.beliefs[i]!.id;p=review(p,id,0);p=review(p,id,1);}
  const b=p.beliefs[2]!;p=run(p,{type:'prepare',id:b.id,decision:'Final decision',evidence:['Real experience'],balance:'Difficulty',opportunity:'Step',confirmed:true});
  p=review(p,b.id,2);p=review(p,b.id,3);assert.equal(p.state,'completed');
  assert.throws(()=>run(p,{type:'reactivate',id:b.id}),PracticeError);
});
function snapshot():Snapshot {const p=prepared();return {revision:p.revision,initial:p,practice:p,receipts:[],coverage:{}};}
test('daily tool requires spoken decision, evidence and balanced reflection; pass is not completion',()=>{
  const s=snapshot();const b=s.practice.beliefs[0]!;
  const input={event_id:'d1',caller_text:b.decision+' I recall an experience. It is still difficult.',command:{type:'practice',id:b.id,evidence:'I recall an experience',balance:'It is still difficult'}};
  const next=capture(s,'daily',null,input);assert.equal(next.coverage[b.id],'done');assert.equal(fullCoverage(next,'daily'),false);
  assert.deepEqual(verifiedPractice(next,input.caller_text),next.practice);
  assert.throws(()=>verifiedPractice(next,'Different words'),PracticeError);
  assert.throws(()=>capture(s,'daily',null,{...input,command:{...input.command,balance:''}}),PracticeError);
  assert.strictEqual(capture(next,'daily',null,input),next);
  const passed=capture(s,'daily',null,{event_id:'pass',caller_text:'Leave this question today',command:{type:'practice',id:b.id,passed:true}});
  assert.equal(passed.coverage[b.id],'passed');assert.equal(fullCoverage(passed,'daily'),false);
});
test('daily agents cannot discover beliefs or submit weekly scores',()=>{
  const s=snapshot();
  assert.throws(()=>capture(s,'daily',null,{event_id:'x',caller_text:'Yes score one',command:{type:'review',id:s.practice.beliefs[0]!.id,score:1,reflection:'score one',confirmed:true}}),PracticeError);
  assert.throws(()=>capture(s,'daily',null,{event_id:'x',caller_text:'New thought and situation',command:{type:'queue',belief:'New thought',trigger:'situation'}}),PracticeError);
});
test('a retried event cannot substitute different caller words or evidence',()=>{
  const s=snapshot();const b=s.practice.beliefs[0]!;
  const input={event_id:'retry',caller_text:b.decision+' My actual experience. Still uncertain.',command:{type:'practice',id:b.id,evidence:'My actual experience',balance:'Still uncertain'}};
  const next=capture(s,'daily',null,input);
  assert.strictEqual(capture(next,'daily',null,input),next);
  assert.throws(()=>capture(next,'daily',null,{...input,caller_text:b.decision+' An invented experience. Still uncertain.',command:{...input.command,evidence:'An invented experience'}}),PracticeError);
});
test('future call pause needs the caller’s explicit read-back confirmation',()=>{
  const s=snapshot();
  assert.throws(()=>capture(s,'daily',null,{event_id:'pause',caller_text:'Today was okay.',command:{type:'pause'}}),PracticeError);
  const next=capture(s,'daily',null,{event_id:'pause',caller_text:'Yes, pause my belief calls.',command:{type:'pause',confirmed:true}});
  assert.equal(next.practice.state,'paused');
});
test('onboarding selection follows the caller-confirmed order, not discovery order',()=>{
  let p=emptyPractice();for(let i=0;i<3;i++)p=run(p,{type:'queue',belief:'Synthetic belief '+i,trigger:'Synthetic situation'});
  const s:Snapshot={revision:p.revision,initial:p,practice:p,receipts:[],coverage:{}};
  const ids=[p.beliefs[2]!.id,p.beliefs[0]!.id,p.beliefs[1]!.id];
  const input={event_id:'order',caller_text:'Yes, Synthetic belief 2 then Synthetic belief 0 then Synthetic belief 1.',command:{type:'reorder',ids,confirmed:true}};
  const next=capture(s,'onboarding',null,input);
  assert.deepEqual(next.practice.beliefs.slice(0,2).map(b=>b.id),ids.slice(0,2));
  assert.equal(next.practice.beliefs[2]!.status,'queued');
  assert.throws(()=>capture(s,'onboarding',null,{...input,command:{...input.command,ids:[...ids].reverse()}}),PracticeError);
  assert.throws(()=>capture(s,'daily',null,input),PracticeError);
  let preparedBeforeCall=p;
  for(const b of p.beliefs.slice(0,2))preparedBeforeCall=run(preparedBeforeCall,{type:'prepare',id:b.id,decision:'My decision',evidence:['My experience'],balance:'Still uncertain',opportunity:'My step',confirmed:true});
  const changed=run(preparedBeforeCall,{type:'reorder',ids});
  assert.equal(changed.beliefs[0]!.status,'preparing');
  assert.equal(changed.beliefs[1]!.status,'active');
  assert.equal(changed.beliefs[2]!.status,'queued');
});
test('weekly score uses server week and caller confirmation; session tokens are isolated',()=>{
  const s=snapshot();const b=s.practice.beliefs[0]!;
  const next=capture(s,'weekly',4,{event_id:'w1',caller_text:'Yes. One. My reflection.',command:{type:'review',id:b.id,score:1,week:999,reflection:'My reflection',confirmed:true}});
  assert.equal(next.practice.beliefs[0]!.reviews.at(-1)!.week,4);
  const secret='x'.repeat(40),token=sessionToken('one',secret);
  assert.equal(verifySessionToken('one',token,secret),true);assert.equal(verifySessionToken('two',token,secret),false);assert.equal(verifySessionToken('one',token,'short'),false);
});
test('daily slots keep local time across daylight-saving changes',()=>{
  assert.equal(nextDaily(new Date('2026-10-24T07:00:00Z'),480,'Europe/Oslo').toISOString(),'2026-10-25T07:00:00.000Z');
  assert.equal(nextDaily(new Date('2026-03-28T08:00:00Z'),480,'Europe/Oslo').toISOString(),'2026-03-29T06:00:00.000Z');
});
test('invalid calendar/timezone and overlapping daily/weekly times are rejected',()=>{
  const form=new URLSearchParams({timezone:'Europe/Oslo',daily:'08:30',weekly:'17:30',weekday:'0',onboarding_local:'2026-10-15T12:00'});
  const now=new Date('2026-10-10T10:00:00Z');assert.equal(scheduleInput(form,now).timezone,'Europe/Oslo');
  form.set('onboarding_local','2026-10-32T12:00');assert.throws(()=>scheduleInput(form,now),PracticeError);
  form.set('onboarding_local','2026-10-15T12:00');form.set('weekly','08:45');assert.throws(()=>scheduleInput(form,now),PracticeError);
});
test('customer copy describes one purchase, never a monthly Beliefs renewal, and escapes private words',()=>{
  const p=prepared();p.outcome='<script>alert(1)</script>';
  const html=beliefPage('account',{practice:p,paid:true,price:'NOK example',preview:true});
  assert.ok(html.includes('One payment, no renewal'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!html.includes('Cancel Beliefs'));
  const landing=beliefPage('landing',{price:'NOK example'});assert.ok(landing.includes('One payment'));assert.ok(!landing.includes('per month'));
});
function stripeFixture(patch:Record<string,unknown>={}):Record<string,unknown> {
  return {id:'cs_one',mode:'payment',subscription:null,amount_subtotal:1000,currency:'nok',client_reference_id:'beliefs:account',payment_status:'paid',line_items:{data:[{quantity:1,price:{id:'price_beliefs',recurring:null,unit_amount:1000,currency:'nok'}}]},payment_intent:{id:'pi_one',status:'succeeded',latest_charge:{paid:true,refunded:false,disputed:false,amount_refunded:0}},...patch};
}
test('one-time payment matches the base monthly amount and rejects renewals, zero-cost or refunded purchases',async()=>{
  process.env['BELIEFS_PRODUCT_ID']='price_beliefs';process.env['BELIEFS_BASE_PRICE_ID']='price_month';process.env['STRIPE_SECRET_KEY']='fake-test-key';
  const base={unit_amount:1000,currency:'nok',recurring:{interval:'month',interval_count:1}};
  const fetcher=(fixture:Record<string,unknown>):typeof fetch=>async (url)=>new Response(JSON.stringify(String(url).includes('/prices/')?base:fixture));
  assert.equal((await readPurchase('stripe','cs_one',fetcher(stripeFixture()))).paid,true);
  await assert.rejects(()=>readPurchase('stripe','cs_one',fetcher(stripeFixture({mode:'subscription'}))));
  await assert.rejects(()=>readPurchase('stripe','cs_one',fetcher(stripeFixture({amount_subtotal:0}))));
  assert.equal((await readPurchase('stripe','cs_one',fetcher(stripeFixture({payment_intent:{id:'pi_one',status:'succeeded',latest_charge:{paid:true,refunded:true,amount_refunded:1000}}})))).paid,false);
  assert.equal((await readPurchase('stripe','cs_one',fetcher(stripeFixture({payment_status:'unpaid'})))).paid,false);
});
