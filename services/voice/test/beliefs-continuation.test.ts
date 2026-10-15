import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyCommand, emptyPractice, activeBeliefs, nextPracticeAppointment, PracticeError, type Command, type Practice } from '../src/beliefs/model.ts';
import { capture, verifiedPractice, type Snapshot } from '../src/beliefs/protocol.ts';
import { appointmentInput, scheduleInput } from '../src/beliefs/repository.ts';
import { beliefPage } from '../src/beliefs/page.ts';
import { pageHeaders } from '../src/beliefs/http.ts';
import { localDisplayScript } from '../src/beliefs/display.ts';
import { beliefCheckout } from '../src/beliefs/billing.ts';
import { safetyTier } from '../src/call/safety.ts';

let event=0;
const run=(p:Practice,c:Command)=>applyCommand(p,c,'continuation-'+(++event));
function ready():Practice {
  let p=run(emptyPractice(),{type:'outcome',outcome:'Speak at a group discussion'});
  for(let i=0;i<3;i++)p=run(p,{type:'queue',belief:'Synthetic thought '+i,trigger:'Synthetic situation'});
  for(const b of p.beliefs.slice(0,2))p=run(p,{type:'prepare',id:b.id,decision:'My chosen decision '+b.id,evidence:['A real presentation'],balance:'Some uncertainty',opportunity:'The next discussion',confirmed:true});
  return run(p,{type:'understood',confirmed:true});
}
const snapshot=(p=ready()):Snapshot=>({revision:p.revision,initial:p,practice:p,receipts:[],coverage:{}});

test('revised decisions keep immutable prior evidence and scores privately',()=>{
  let p=ready();const id=p.beliefs[0]!.id;
  p=run(p,{type:'review',id,week:0,score:1,reflection:'Still uncertain',confirmed:true});
  p=run(p,{type:'prepare',id,decision:'A revised decision',evidence:['A different experience'],balance:'New difficulty',opportunity:'Another discussion',confirmed:true});
  const b=p.beliefs[0]!;assert.equal(b.version,2);assert.equal(b.reviews.length,0);
  assert.equal(b.versions![0]!.reviews[0]!.score,1);assert.equal(b.versions![0]!.evidence[0]!.text,'A real presentation');
  p=run(p,{type:'practice',id,evidence:'More experience',balance:'Current balance'});
  assert.equal(p.beliefs[0]!.versions![0]!.balance,'Some uncertainty');
});
test('an active decision revised in a weekly call cannot get a score until a later call',()=>{
  const s=snapshot();const id=s.practice.beliefs[0]!.id;
  const text='A revised decision. A real example. Uncertainty remains. The next meeting. Yes, correct.';
  const next=capture(s,'weekly',4,{event_id:'revision',caller_text:text,command:{type:'prepare',id,decision:'A revised decision',evidence:['A real example'],balance:'Uncertainty remains',opportunity:'The next meeting',confirmed:true}});
  const rating={event_id:'score',caller_text:'One. My reflection. Yes, correct.',command:{type:'review',id,score:1,reflection:'My reflection',confirmed:true}};
  assert.throws(()=>capture(next,'weekly',4,rating),PracticeError);
  assert.equal(capture(snapshot(next.practice),'weekly',5,rating).practice.beliefs[0]!.reviews[0]!.week,5);
});
test('signed caller turns must end a confirmed span with actual agreement',()=>{
  const s=snapshot();const id=s.practice.beliefs[0]!.id;
  const turns=['One. My reflection.','Yes.','No, that is not correct.'];
  const next=capture(s,'weekly',4,{event_id:'ambivalent',caller_text:turns.join(' '),command:{type:'review',id,score:1,reflection:'My reflection',confirmed:true}});
  assert.throws(()=>verifiedPractice(next,turns),PracticeError);
  const positive=['One. My reflection.','Let me finish.','Yes, that is correct.'];
  const accepted=capture(s,'weekly',4,{event_id:'agreed',caller_text:positive.join(' '),command:{type:'review',id,score:1,reflection:'My reflection',confirmed:true}});
  assert.deepEqual(verifiedPractice(accepted,positive),accepted.practice);
  assert.throws(()=>verifiedPractice(accepted,positive.filter((_,i)=>i!==1)),PracticeError);
});
test('Norwegian score variants preserve caller-word verification without forced English recitals',()=>{
  for(const [score,word] of [[1,'ett'],[7,'syv']] as const){
    const s=snapshot();const turns=[`${word}. Min refleksjon.`, 'Ja, riktig.'];
    const next=capture(s,'weekly',4,{event_id:'norsk-'+score,caller_text:turns.join(' '),command:{type:'review',id:s.practice.beliefs[0]!.id,score,reflection:'Min refleksjon',confirmed:true}});
    assert.equal(verifiedPractice(next,turns).beliefs[0]!.reviews[0]!.score,score);
    assert.throws(()=>verifiedPractice(next,['Different words.','Ja, riktig.']),PracticeError);
  }
});
test('an unresolved numeric range cannot become a weekly score or retirement',()=>{
  const s=snapshot();const id=s.practice.beliefs[0]!.id;
  for(const text of ['One or two, I am not sure.','Between zero and one.','1–2.','En eller to.','Åtte til ni.']){
    const score=text.startsWith('Between')?0:text.startsWith('Åtte')?8:1;
    assert.throws(()=>capture(s,'weekly',4,{event_id:'range',caller_text:text+' My reflection. Yes, correct.',command:{type:'review',id,score,reflection:'My reflection',confirmed:true}}),(error:unknown)=>error instanceof PracticeError && error.code==='score_invalid');
  }
  const turns=['One or two, I am not sure. My reflection.','I choose one.','Yes, correct.'];
  const input={event_id:'chosen',caller_text:turns.join(' '),command:{type:'review',id,score:1,reflection:'My reflection',confirmed:true}};
  const accepted=capture(s,'weekly',4,input);
  assert.equal(verifiedPractice(accepted,turns).beliefs[0]!.reviews[0]!.score,1);
  assert.throws(()=>capture(s,'weekly',4,{...input,command:{...input.command,score:2}}),PracticeError);
  assert.throws(()=>capture(s,'weekly',4,{...input,caller_text:'One or two. My reflection. I would not choose one. Yes, correct.'}),PracticeError);
  assert.equal(s.practice.beliefs[0]!.reviews.length,0);
});
test('two prepared decisions without a genuine backlog stay unfinished',()=>{
  const p=ready();const incomplete={...p,understood:false,state:'onboarding' as const,beliefs:p.beliefs.slice(0,2)};
  assert.throws(()=>run(incomplete,{type:'understood',confirmed:true}),PracticeError);
  assert.ok(beliefPage('prepare',{practice:incomplete}).includes('never need to invent another thought'));
});
test('queued material waits for a vacant slot and old preparation is never activated implicitly',()=>{
  let p=ready();const queued=p.beliefs[2]!;
  const preparation:Command={type:'prepare',id:queued.id,decision:'A currently useful decision',evidence:['My own experience'],balance:'Some uncertainty',opportunity:'The next discussion',confirmed:true};
  assert.throws(()=>run(p,preparation),(e:unknown)=>e instanceof PracticeError && e.code==='preparation_not_due');
  assert.ok(!beliefPage('account',{practice:p,paid:true}).includes('Prepare the next decision'));
  assert.ok(!beliefPage('prepare',{practice:p}).includes('Save my decision'));
  // Legacy records may contain preparation saved before a slot opened.
  Object.assign(queued,{decision:'An old decision',evidence:[{text:'An old experience',at:'2026-09-01'}],balance:'Old difficulty',opportunity:'An old opportunity',confirmed:true});
  const retiring=p.beliefs[0]!.id;
  for(let week=0;week<2;week++)p=run(p,{type:'review',id:retiring,week,score:0,reflection:'My reflection',confirmed:true});
  assert.equal(p.beliefs[2]!.status,'preparing');assert.equal(activeBeliefs(p).length,1);
  assert.ok(beliefPage('account',{practice:p,paid:true}).includes('Prepare the next decision'));
  p=run(p,preparation);assert.equal(p.beliefs[2]!.status,'active');assert.equal(p.beliefs[2]!.version,2);
});
test('reactivation stays within the cap and completed programmes cannot restart',()=>{
  let p=ready();const id=p.beliefs[0]!.id;
  for(let week=0;week<2;week++)p=run(p,{type:'review',id,week,score:0,reflection:'My reflection',confirmed:true});
  p=run(p,{type:'reactivate',id});assert.ok(activeBeliefs(p).length<=2);assert.equal(p.beliefs[0]!.version,2);
  const completed={...p,state:'completed' as const};
  for(const type of ['reactivate','resume','pause'] as const)assert.throws(()=>run(completed,type==='reactivate'?{type,id}:{type}),PracticeError);
});
test('identical retries are idempotent and altered browser/model retries are rejected',()=>{
  for(const id of ['stable-request','__proto__']){
    const p=ready();const saved=applyCommand(p,{type:'pause'},id);
    assert.strictEqual(applyCommand(saved,{type:'pause'},id),saved);
    assert.throws(()=>applyCommand(saved,{type:'resume'},id),PracticeError);
    const restored=JSON.parse(JSON.stringify(saved)) as Practice;assert.strictEqual(applyCommand(restored,{type:'pause'},id),restored);
  }
});
test('short natural agreement is accepted while qualified disagreement remains unconfirmed',()=>{
  for(const agreement of ['Yep.','That’s right.','Exactly.','Jepp.','Not exactly.']){
    const s=snapshot();const turns=['One. My reflection.',agreement];
    const next=capture(s,'weekly',4,{event_id:'natural-agreement',caller_text:turns.join(' '),command:{type:'review',id:s.practice.beliefs[0]!.id,score:1,reflection:'My reflection',confirmed:true}});
    if(agreement==='Not exactly.')assert.throws(()=>verifiedPractice(next,turns),PracticeError);
    else assert.deepEqual(verifiedPractice(next,turns),next.practice);
  }
});
test('active schedule edits need no fictitious onboarding date; DST gaps are rejected',()=>{
  const now=new Date('2026-03-27T10:00:00Z');const f=new URLSearchParams({timezone:'Europe/Oslo',daily:'08:30',weekly:'17:30',weekday:'0'});
  assert.equal(scheduleInput(f,now,false).at,null);
  f.set('occurrence_local','2026-03-29T02:30');assert.throws(()=>appointmentInput(f,'Europe/Oslo',now),PracticeError);
  f.set('occurrence_local','2026-03-29T08:30');assert.equal(appointmentInput(f,'Europe/Oslo',now).toISOString(),'2026-03-29T06:30:00.000Z');
});
test('private time display is constrained by CSP and does not modify schedule inputs',()=>{
  const hash=createHash('sha256').update(localDisplayScript).digest('base64');
  assert.ok(pageHeaders['content-security-policy'].includes(`script-src 'sha256-${hash}'`));
  assert.ok(!localDisplayScript.includes('fetch('));assert.ok(!localDisplayScript.includes('input'));
  const html=beliefPage('account',{practice:ready(),paid:true,next:'Synthetic next appointment',nextAt:'2026-10-15T06:30:00Z',nextKind:'daily',timezone:'Europe/Oslo'});
  assert.ok(html.includes('Move only this call'));assert.ok(html.includes('expected_at'));assert.ok(html.includes('Skip this call'));
  assert.ok(!beliefPage('schedule',{practice:ready()}).includes('name="onboarding_local"'));
});
test('partial readiness never exposes a paid checkout',()=>{
  const saved={...process.env};try {
    process.env['BELIEFS_ENABLED']='true';process.env['BELIEFS_SAFETY_APPROVED']='true';process.env['BELIEFS_PRICE_VERIFIED']='true';
    process.env['BELIEFS_SCRIPTS_APPROVED']='false';process.env['BELIEFS_PRODUCT_ID']='synthetic-price';process.env['BELIEFS_BASE_PRICE_ID']='synthetic-base';
    process.env['BELIEFS_PRICE_LABEL']='Synthetic price';process.env['BELIEFS_CHECKOUT_URL']='https://buy.stripe.com/synthetic';
    assert.equal(beliefCheckout('synthetic-account'),'');
  }finally{process.env=saved;}
});
test('an unprepared backlog cannot be presented as a forthcoming daily practice call',()=>{
  const p=ready();p.beliefs[0]!.status='retired';p.beliefs[1]!.status='retired';p.beliefs[2]!.status='preparing';
  const now=new Date('2026-10-10T10:00:00Z');const times={daily:new Date(+now+86400_000),weekly:new Date(+now+7*86400_000)};
  assert.equal(nextPracticeAppointment(p,times,now)!.kind,'weekly');
  assert.equal(nextPracticeAppointment({...p,state:'paused'},times,now),undefined);
  assert.equal(nextPracticeAppointment(p,{daily:times.daily},now),undefined);
});
test('safety signals flag literal mentions even in negation/history/third-party accounts; indirect wording can be missed',()=>{
  const check=(text:string)=>safetyTier([{speaker:'caller',text}],new Map());
  for(const text of ['I am not suicidal.','I used to self-harm years ago.','A friend mentioned suicide.','The transcription says suicide, but I said something else.'])assert.equal(check(text)?.tier,1);
  assert.equal(check('I have arranged everything and will disappear tomorrow.'),undefined);
  assert.equal(check('The audio is unclear.'),undefined);
  // These demonstrate limitations, not a reliable risk assessment or permission to launch.
});
