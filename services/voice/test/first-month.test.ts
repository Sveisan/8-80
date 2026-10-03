import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { tick } from '../src/loop/tick.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { expireTrials } from '../src/billing/trials.ts';
import { milestone, journeyReport, countRequest, pruneJourney } from '../src/journey/measure.ts';
import { dispatchMessages } from '../src/messages/outbox.ts';
import { composeExport } from '../src/legal/export.ts';
import { enqueue } from '../src/messages/outbox.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import type { PlaceCallRequest } from '../src/agent/speechify.ts';

const opened = await openTestDb('first_month');
const db = typeof opened === 'string' ? undefined : opened;
const options = {skip:typeof opened === 'string' ? opened : false};
after(async () => { await db?.close(); });

test('a whole free month preserves context, delivers each recap once and stops precisely at expiry', options, async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32,5).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  const phone = '+4796000001', hash = phoneKey(phone);
  const start = new Date('2026-09-08T05:00:00Z');
  const end = new Date(+start + 30*86400_000);
  const script = loadScript(), scheduler = new Scheduler(db!.sql);
  const placed: PlaceCallRequest[] = [], mail: string[] = [];
  const deps: LoopDeps = {store:db!.store,scheduler,script,
    agent:{placeCall:async (request:PlaceCallRequest) => {placed.push(request); return {conversationId:`month-${placed.length}`,status:'pending'};}} as LoopDeps['agent'],
    sms:{send:async () => ({id:'sms'})},mailer:{retryWindowMs:86400_000,send:async (_to,recap) => {mail.push(recap.body); return {id:`mail-${mail.length}`};},deliveryStatus:async () => 'delivered'},
  };
  await db!.store.upsertProfile(phone,{email:'month@example.com'});
  await db!.store.startTrial(phone,end);
  await scheduler.setSlot(phone,{weekday:2,minute:480,timezone:'Europe/Oslo'},start);
  await milestone(db!.sql,hash,'phone_verified',hash,start);
  await countRequest(db!.sql,'booking_view',start);
  await countRequest(db!.sql,'booking_submitted',start);
  const map = script.get('read.first.keep')!.replace('{{eight}}','friends').replace('{{eighty}}','family').replace('{{goals}}','sailing');
  const action = script.get('next.confirm')!.replace('{{commitment}}','book a lesson').replace('{{day}}','Friday');
  for (let week=0;week<5;week++) {
    const at = new Date(+start+3600_000+week*7*86400_000);
    assert.equal((await tick(deps,at)).placed,1);
    assert.equal(placed[week]!.firstCall,week===0);
    if(week) assert.equal(placed[week]!.variables?.['last_commitment'],'book a lesson');
    const turns = week===0 ? [{role:'assistant',content:map},{role:'user',content:'Yes, that is right.'},{role:'assistant',content:script.get('onboarding.confirmed')!}] : [{role:'user',content:'I did it. This week I will book a lesson.'}];
    turns.push({role:'assistant',content:action});
    const payload={event:'conversation.completed',conversation_id:`month-${week+1}`,status:'completed',duration_ms:600_000,messages:turns};
    assert.equal((await settleConversation(payload,deps,undefined,new Date(+at+600_000))).handled,true);
    assert.equal((await settleConversation(payload,deps,undefined,new Date(+at+601_000))).handled,false);
    await dispatchMessages(deps,new Date(+at+21*60_000));
  }
  assert.equal(mail.length,5); assert.equal((await db!.store.load(phone)).callNumber,6);
  assert.equal((await db!.store.load(phone)).onboarding,'complete');
  assert.equal(await expireTrials(deps,end),1);
  assert.equal(await expireTrials(deps,end),0);
  assert.equal(mail.length,6,'one trial-end letter');
  assert.equal((await tick(deps,new Date(+end+7*86400_000))).placed,0);
  assert.equal(await scheduler.nextEligibleCallFor(phone,end),undefined);
  const report=await journeyReport(db!.sql,end);
  assert.equal(report.cohort!['verified_accounts'],1);
  assert.equal(report.cohort!['accounts_with_action_read_back'],1);
  assert.equal(report.cohort!['accounts_with_repeat_action_read_back'],1);
  assert.equal(report.milestones.find(r=>r['event']==='action_read_back')!['events'],5);
  assert.ok(!JSON.stringify(report).includes(hash)); assert.ok(!JSON.stringify(report).includes('book a lesson'));
  await enqueue(db!.sql,{eventKey:'secret-code',phoneHash:hash,channel:'sms',kind:'access',to:phone,body:'The code is 938475'},end);
  await enqueue(db!.sql,{eventKey:'private-link',phoneHash:hash,channel:'sms',kind:'reply',to:phone,body:'Open https://8and80.example/r/abcdefghij'},end);
  const exported=(await composeExport(db!.store,phone,script))!.body;
  assert.match(exported,/action_read_back/); assert.doesNotMatch(exported,/938475|abcdefghij/);
  await db!.store.forget(phone);
  assert.equal((await db!.sql`select * from journey_events`).length,0);
  assert.equal((await db!.sql`select * from message_outbox`).length,0);
  await pruneJourney(db!.sql,new Date(+end+61*86400_000));
  assert.equal((await db!.sql`select * from journey_counts`).length,0);
});
