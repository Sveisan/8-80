import { test,beforeEach,after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { decrypt } from '../src/store/crypto.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { Links } from '../src/link/token.ts';
import { controlPlane } from '../src/control.ts';
import { dispatchMessage,reconcileMessages } from '../src/messages/outbox.ts';
import { composeExport } from '../src/legal/export.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { available,defaults,localClock,nextAfter,isQuiet,parsePreferences,loadPreferences,savePreferences,type Preferences } from '../src/encouragement/preferences.ts';
import { choose,compose,variants } from '../src/encouragement/content.ts';
import { queueEncouragement,feedback,pruneEncouragement,recent } from '../src/encouragement/runtime.ts';
import { encouragementSection } from '../src/encouragement/page.ts';
import { encouragementReport } from '../src/encouragement/report.ts';

const opened=await openTestDb('encouragement');
const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const phone='+4798200901',other='+4798200902',hash=phoneKey(phone),now=new Date('2026-11-16T09:00:00Z'); // Monday 10:00 Oslo.
let sent:string[]=[];
const deps=():LoopDeps=>({store:db!.store,scheduler:new Scheduler(db!.sql),script:loadScript(),agent:{} as LoopDeps['agent'],
  sms:{send:async(_to,body)=>{sent.push(body);return{id:'synthetic-encouragement'};}},mailer:{send:async()=>{throw Error('No email expected');}}});
const form=(extra:Record<string,string>={})=>new URLSearchParams({enabled:'yes',frequency:'daily',tone:'gentle',content:'encouragement',quiet_start:'21:00',quiet_end:'09:00',timezone:'Europe/Oslo',...extra});
const save=async(p:Preferences={...defaults(),enabled:true,frequency:'daily'})=>db!.sql.begin(tx=>savePreferences(tx,hash,p,new Date(+now-86400_000)));
const due=async()=>{await save();await db!.sql`update encouragement_preferences set next_at=${now} where phone_hash=${hash}`;await queueEncouragement(deps(),now);return (await db!.sql`select id from message_outbox where kind='encouragement'`)[0]!['id'] as string;};
beforeEach(async()=>{
  Object.assign(process.env,{DATA_ENCRYPTION_KEY:Buffer.alloc(32,35).toString('base64'),PUBLIC_URL:'https://8and80.example',SMS_FROM_NUMBER:'+4798880088',SPEECHIFY_CALLER_ID_NUMBER:'+4798880088',ENCOURAGEMENT_READY:'0',ENCOURAGEMENT_PHONE_TEST_PASSED:'0',ENCOURAGEMENT_PILOT_HASHES:hash,BELIEFS_ENABLED:'0',UNBLOCK_ENABLED:'0'});
  sent=[];
  if(db){await db.sql`truncate jev_quality_reviews,product_feedback,encouragement_preferences,encouragement_deliveries,message_attempts,message_outbox,callers,call_attempts,links cascade`;
    await db.store.upsertProfile(phone,{name:'Synthetic',email:'synthetic@example.com'});
    await db.sql`update callers set billing_status='comped',call_number=2,onboarding='complete',timezone='Europe/Oslo',paused=false where phone_hash=${hash}`;}
});
after(async()=>{await db?.close();});

test('off by default; both global gates required; allowlist and sender are enforced',()=>{
  assert.equal(defaults().enabled,false);assert.equal(defaults().swearing,false);
  assert.equal(available(hash),true);assert.equal(available(phoneKey(other)),false);
  process.env['ENCOURAGEMENT_READY']='1';assert.equal(available(phoneKey(other)),false);
  process.env['ENCOURAGEMENT_PHONE_TEST_PASSED']='1';assert.equal(available(phoneKey(other)),true);
  process.env['SMS_FROM_NUMBER']='+4791111111';assert.equal(available(hash),false);
});
test('preferences validate frequency, tone, timezone, content, focus and quiet hours',()=>{
  assert.equal(parsePreferences(form()).enabled,true);
  const invalids:Record<string,string>[]=[{frequency:'hourly'},{tone:'aggressive'},{timezone:'bad/zone'},{content:'invented'},{content:'action',focus:''},{focus:'x'.repeat(161)},{focus:'one\ntwo'},{quiet_start:'09:00',quiet_end:'09:00'},{quiet_start:'09:00',quiet_end:'00:00'}];
  for(const invalid of invalids)assert.throws(()=>parsePreferences(form(invalid)));
  assert.throws(()=>parsePreferences(new URLSearchParams()));
});
test('local calendar schedules survive spring/fall DST, non-hour offsets and quiet hours',()=>{
  for(const [start,expected] of [['2026-03-28T12:00:00Z','2026-03-29T08:00:00.000Z'],['2026-10-24T12:00:00Z','2026-10-25T09:00:00.000Z']]){
    const p={...defaults(),frequency:'daily' as const};assert.equal(nextAfter(new Date(start!),p).toISOString(),expected);
  }
  const p={...defaults('Asia/Kathmandu'),frequency:'daily' as const,quietStart:9*60,quietEnd:11*60};
  assert.equal(localClock(nextAfter(now,p),p.timezone).minute,660);
  assert.equal(isQuiet(21*60,defaults()),true);assert.equal(isQuiet(9*60,defaults()),false);
  for(const frequency of ['weekly','three'] as const){const at=nextAfter(now,{...defaults(),frequency});assert.equal(localClock(at,'Europe/Oslo').weekday,frequency==='weekly'?2:3);}
});
test('reviewed variants are grounded, selected in sequences, adapt to feedback and require swearing opt-in',()=>{
  assert.equal(variants.length,24);assert.ok(variants.every(v=>v.score>7));
  const p={...defaults(),tone:'direct' as const,content:['recognition','action'] as ('recognition'|'action')[]};
  assert.equal(choose(p,'synthetic',false,[]),undefined);
  p.focus='Take a five-minute walk';const v=choose(p,'synthetic',false,[])!;assert.equal(v.topic,'action');
  assert.ok(!compose(v,p).includes('fucking'));assert.ok(compose(v,{...p,swearing:true}).includes('fucking'));
  const next=choose(p,'synthetic',false,[{variant:v.id,feedback:'less'}])!;assert.notEqual(next.id,v.id);
  assert.ok(Array.from({length:30},(_,i)=>choose(p,String(i),false,[{variant:v.id,feedback:'more'}])?.id).includes(v.id));
  assert.notEqual(choose({...defaults()},'same',false,[{variant:variants[0]!.id,feedback:null}])?.id,variants[0]!.id);
  const html=encouragementSection({preferences:{...p,focus:'"><script>alert(1)</script>'},history:[]});assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('&lt;script&gt;'));
});
test('no preference row creates no message; consent is recorded, focus encrypted and first send is future',options,async()=>{
  assert.equal(await queueEncouragement(deps(),now),0);assert.equal((await loadPreferences(db!.sql,hash)).enabled,false);
  await save({...defaults(),enabled:true,frequency:'daily',focus:'A private focus'});
  const [r]=await db!.sql`select * from encouragement_preferences`;assert.ok(r!['consented_at']);assert.ok(r!['next_at']>=now);
  assert.equal(decrypt(r!['focus_enc']),'A private focus');assert.notEqual(r!['focus_enc'],'A private focus');
});
test('parallel producers/dispatchers send once with retained encrypted history and truthful receipt status',options,async()=>{
  await save();await db!.sql`update encouragement_preferences set next_at=${now}`;
  assert.equal((await Promise.all([queueEncouragement(deps(),now),queueEncouragement(deps(),now)])).reduce((a,b)=>a+b),1);
  const [r]=await db!.sql`select id from message_outbox`;await Promise.all([dispatchMessage(deps(),r!['id'],now),dispatchMessage(deps(),r!['id'],now)]);
  assert.equal(sent.length,1);assert.equal((await recent(db!.sql,hash))[0]!.status,'accepted');
  const d=deps();d.sms.deliveryStatus=async()=> 'delivered';await reconcileMessages(d,new Date(+now+11*60_000));assert.equal((await recent(db!.sql,hash))[0]!.status,'delivered');
  assert.equal((await db!.sql`select pilot,adaptive from encouragement_deliveries`)[0]!['pilot'],true);
});
for(const control of ['paused','all_calls_stopped','held_for_review','sms_opt_out'])test(`final send rechecks ${control}`,options,async()=>{
  const id=await due();await db!.sql.unsafe(`update callers set ${control}=true where phone_hash=$1`,[hash]);
  assert.equal(await dispatchMessage(deps(),id,now),'suppressed');assert.equal(sent.length,0);
});
for(const control of ['billing','onboarding','pilot','quiet','progress'])test(`final send rechecks ${control} changes`,options,async()=>{
  if(control==='progress'){await db!.sql`update callers set weeks_done=1`;await save({...defaults(),enabled:true,content:['recognition']});await db!.sql`update encouragement_preferences set next_at=${now}`;await queueEncouragement(deps(),now);}
  const id=control==='progress'?(await db!.sql`select id from message_outbox`)[0]!['id']:await due();
  if(control==='billing')await db!.sql`update callers set billing_status='ended'`;
  if(control==='onboarding')await db!.sql`update callers set onboarding='pending'`;
  if(control==='pilot')process.env['ENCOURAGEMENT_PILOT_HASHES']='';
  if(control==='quiet')await db!.sql`update encouragement_preferences set quiet_start=540,quiet_end=660`;
  if(control==='progress')await db!.sql`update callers set weeks_done=0`;
  assert.equal(await dispatchMessage(deps(),id,now),'suppressed');assert.equal(sent.length,0);
});
test('pause, stop and edit invalidate queued wording; re-enable cannot resurrect it',options,async()=>{
  for(const mode of ['pause','stop','edit']){
    const id=await due(),p=await loadPreferences(db!.sql,hash);p.paused=mode==='pause';p.enabled=mode!=='stop';p.tone='playful';
    await db!.sql.begin(tx=>savePreferences(tx,hash,p,now));
    assert.equal(await dispatchMessage(deps(),id,now),'suppressed');
    await db!.sql`delete from message_outbox`;await db!.sql`delete from encouragement_deliveries`;
  }
  assert.equal(sent.length,0);
});
test('overdue messages are skipped, quiet hours have no catch-up burst, max one per local day',options,async()=>{
  await save();await db!.sql`update encouragement_preferences set next_at=${new Date(+now-121*60_000)}`;
  assert.equal(await queueEncouragement(deps(),now),0);
  await db!.sql`update encouragement_preferences set next_at=${now}`;assert.equal(await queueEncouragement(deps(),now),1);
  await db!.sql`update encouragement_preferences set next_at=${now}`;assert.equal(await queueEncouragement(deps(),now),0);
});
test('a late-night outage cannot spill a previous-day message into the next morning',options,async()=>{
  await save({...defaults(),enabled:true,frequency:'daily',quietStart:720,quietEnd:780});
  const afterMidnight=new Date('2026-11-16T23:30:00Z');
  await db!.sql`update encouragement_preferences set next_at=${new Date(+afterMidnight-60*60_000)}`;
  assert.equal(await queueEncouragement(deps(),afterMidnight),0);assert.equal((await db!.sql`select * from message_outbox`).length,0);
});
test('no invented recognition and only explicitly supplied focus can enter an action message',options,async()=>{
  await save({...defaults(),enabled:true,content:['recognition']});await db!.sql`update encouragement_preferences set next_at=${now}`;
  assert.equal(await queueEncouragement(deps(),now),0);
  await save({...defaults(),enabled:true,content:['action'],focus:'Practise guitar for five minutes'});await db!.sql`update encouragement_preferences set next_at=${now}`;
  assert.equal(await queueEncouragement(deps(),now),1);const [r]=await db!.sql`select body_enc from encouragement_deliveries`;
  assert.match(decrypt(r!['body_enc']),/Practise guitar for five minutes/);assert.doesNotMatch(decrypt(r!['body_enc']),/you (did|completed)/i);
});
test('feedback requires ownership and provider acceptance, persists once and can be cleared',options,async()=>{
  const id=await due();assert.equal(await db!.sql.begin(tx=>feedback(tx,hash,id,'more',now)),false);
  await dispatchMessage(deps(),id,now);process.env['ENCOURAGEMENT_PILOT_HASHES']=`${hash},${phoneKey(other)}`;
  assert.equal(await db!.sql.begin(tx=>feedback(tx,phoneKey(other),id,'more',now)),false);
  for(const response of ['more','less','less','clear'])assert.equal(await db!.sql.begin(tx=>feedback(tx,hash,id,response,now)),true);
  assert.equal((await db!.sql`select feedback from encouragement_deliveries`)[0]!['feedback'],null);
  const report=await encouragementReport(db!.sql);assert.equal(report.winner,null);assert.equal(report.arms[0]!['pilot'],true);
});
test('during-call spacing delays delivery, pending bodies expire without next-day catch-up, revision changes reject in-flight claims',options,async()=>{
  const id=await due();await db!.sql`insert into call_attempts(id,phone_hash,scheduled_for,claimed_at,status) values ('synthetic-active',${hash},${now},${now},'active')`;
  assert.equal(await dispatchMessage(deps(),id,now),'pending');assert.equal(sent.length,0);
  await db!.sql`update call_attempts set status='completed'`;
  await db!.sql`update encouragement_preferences set revision=revision+1`;
  assert.equal(await dispatchMessage(deps(),id,new Date(+now+60_000)),'suppressed');
  await db!.sql`delete from message_outbox`;await db!.sql`delete from encouragement_deliveries`;
  const old=await due();assert.equal(await dispatchMessage(deps(),old,new Date(+now+121*60_000)),'suppressed');assert.equal(sent.length,0);
});
test('delivery history, preferences and feedback export and delete with the account; history expires after 30 days',options,async()=>{
  const id=await due();await dispatchMessage(deps(),id,now);await db!.sql.begin(tx=>feedback(tx,hash,id,'less',now));
  const exported=await composeExport(db!.store,phone,loadScript());assert.match(exported!.body,/encouragementPreferences/);assert.match(exported!.body,/encouragementDeliveries/);
  await pruneEncouragement(db!.sql,new Date(+now+31*86400_000));assert.equal((await db!.sql`select * from encouragement_deliveries`).length,0);
  await db!.store.forget(phone);assert.equal((await db!.sql`select * from encouragement_preferences`).length,0);
});
test('authenticated My page supports opt-in, editing, pause/resume/stop, rejects stale forms and cross-site POST',options,async()=>{
  const d=deps();await d.scheduler.setSlot(phone,{weekday:2,minute:480,timezone:'Europe/Oslo'},now);
  const code=await new Links(db!.sql).mint(hash),server=controlPlane(d,'synthetic');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,url=`${base}/r/${code}`;
  try{
    assert.match(await(await fetch(url)).text(),/Encouragement is off/);
    const post=(body:URLSearchParams,headers:Record<string,string>={})=>fetch(url,{method:'POST',body,headers});
    const input=form({action:'encouragement-save',enc_revision:'0'});assert.equal((await post(input,{'sec-fetch-site':'cross-site'})).status,403);
    assert.match(await(await post(input)).text(),/Preferences saved/);assert.equal((await loadPreferences(db!.sql,hash)).enabled,true);
    assert.match(await(await post(input)).text(),/changed elsewhere/);
    for(const mode of ['pause','resume','stop']){
      const p=await loadPreferences(db!.sql,hash);const response=await post(new URLSearchParams({action:`encouragement-${mode}`,enc_revision:String(p.revision)}));
      assert.equal(response.status,200);const next=await loadPreferences(db!.sql,hash);assert.equal(next.paused,mode==='pause');assert.equal(next.enabled,mode!=='stop');
    }
    process.env['ENCOURAGEMENT_PILOT_HASHES']='';assert.doesNotMatch(await(await fetch(url)).text(),/Encouragement by SMS/);
    assert.equal((await post(input)).status,403);assert.equal(sent.length,0);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
