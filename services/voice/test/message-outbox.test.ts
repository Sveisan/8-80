import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { decrypt } from '../src/store/crypto.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { enqueue, dispatchMessage, dispatchMessages, recoverMessages, reconcileMessages } from '../src/messages/outbox.ts';
import { resolveMessage, messageReport } from '../src/messages/operations.ts';
import { SendFailure } from '../src/messages/types.ts';
import { OptedOut } from '../src/sms/types.ts';
import { settleConversation } from '../src/loop/settle.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const opened = await openTestDb('message_outbox');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const now = new Date('2026-10-03T08:00:00Z');
const phone = '+4794000901';
const hash = phoneKey(phone);
const script = loadScript();
let sent: Array<{body: unknown; key: string | undefined}> = [];
const deps = (): LoopDeps => ({ store: db!.store, scheduler: new Scheduler(db!.sql), script, agent: {} as LoopDeps['agent'],
  sms: { send: async (_to, body, opts) => { sent.push({body, key: opts?.idempotencyKey}); return {id:'SMreceipt'}; } },
  mailer: { retryWindowMs: 24 * 3600_000, send: async (_to, body, opts) => { sent.push({body, key: opts?.idempotencyKey}); return {id:'email-receipt'}; } },
});
const add = (channel: 'email' | 'sms' = 'sms', eventKey = 'event') => enqueue(db!.sql, { eventKey, phoneHash: hash, channel, kind: channel === 'sms' ? 'call' : 'recap', to: channel === 'sms' ? phone : 'test@example.com', body: channel === 'sms' ? 'Synthetic notice' : {subject:'Test', body:'Private action', parts:[]} }, now);
beforeEach(async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  if (db) { await db.sql`truncate belief_sessions, belief_enrollments, journey_events, journey_counts, message_attempts, message_outbox, callers, call_attempts, links, feedback, signups, access_codes`; await db.store.upsertProfile(phone, {email:'test@example.com'}); }
  sent = [];
});
after(async () => { await db?.close(); });

test('a crashed transaction rolls back personal memory, onboarding and its notice together', options, async () => {
  await assert.rejects(db!.sql.begin(async tx => {
    await db!.store.in(tx).record(phone, { at:now.toISOString(), durationMs:600_000, commitment:'A private action', onboardingComplete:true });
    await enqueue(tx, {eventKey:'atomic', phoneHash:hash, channel:'sms', kind:'call', to:phone, body:'private'}, now);
    throw new Error('crash');
  }), /crash/);
  assert.equal((await db!.store.load(phone)).callNumber, 1);
  assert.equal((await db!.store.load(phone)).lastCommitment, undefined);
  assert.equal((await db!.sql`select * from message_outbox`).length, 0);
});

test('parallel workers and duplicate producer events issue one provider request', options, async () => {
  const ids = await Promise.all([add(), add(), add()]);
  assert.equal(new Set(ids).size, 1);
  await Promise.all(ids.map(id => dispatchMessage(deps(), id, now)));
  assert.equal(sent.length, 1);
  const [row] = await db!.sql`select * from message_outbox`;
  assert.equal(row!['status'], 'accepted');
  assert.equal(row!['payload_enc'], null);
  assert.equal(row!['recipient_enc'], null);
  assert.equal(row!['delivered_at'], null);
});

test('lost email acceptance retries identical content and key, and later reconciles delivery', options, async () => {
  const d = deps(); let attempts = 0;
  d.mailer.send = async (_to, body, opts) => { sent.push({body, key:opts?.idempotencyKey}); if (++attempts === 1) throw new Error('connection closed after acceptance'); return {id:'email-receipt'}; };
  d.mailer.deliveryStatus = async () => 'delivered';
  const id = await add('email');
  assert.equal(await dispatchMessage(d, id, now), 'pending');
  assert.equal(await dispatchMessage(d, id, new Date(+now + 60_000)), 'accepted');
  assert.deepEqual(sent[0], sent[1]);
  await reconcileMessages(d, new Date(+now + 11 * 60_000));
  assert.equal((await db!.sql`select status from message_outbox`)[0]!['status'], 'delivered');
});

test('ambiguous SMS acceptance is held for review; ordinary ticks cannot duplicate it', options, async () => {
  const d = deps(); d.sms.send = async () => { sent.push({body:'accepted then disconnected', key:undefined}); throw new Error('timeout'); };
  const id = await add();
  assert.equal(await dispatchMessage(d, id, now), 'uncertain');
  await dispatchMessages(d, new Date(+now + 5 * 60_000));
  assert.equal(sent.length, 1);
  assert.equal((await messageReport(db!.sql, now)).attention.length, 1);
  assert.equal(await resolveMessage(db!.sql, id, 'close-without-resend', now), true);
  assert.equal((await db!.sql`select payload_enc from message_outbox`)[0]!['payload_enc'], null);
});

test('only a definitive provider refusal is automatically retryable for SMS', options, async () => {
  const d = deps(); d.sms.send = async () => { throw new SendFailure('retry', '429'); };
  const id = await add();
  assert.equal(await dispatchMessage(d, id, now), 'pending');
  assert.equal(await dispatchMessage(deps(), id, new Date(+now + 60_000)), 'accepted');
  const permanent = await add('sms', 'bad-number');
  d.sms.send = async () => { throw new SendFailure('permanent', 'bad address'); };
  assert.equal(await dispatchMessage(d, permanent, now), 'failed');
  assert.equal(await resolveMessage(db!.sql, permanent, 'retry-confirmed-not-accepted', new Date(+now + 7*3600_000)), false);
});

test('interrupted workers retry bounded idempotent email but quarantine SMS and old email', options, async () => {
  const sms = await add(); const email = await add('email','mail'); const old = await add('email','old');
  await db!.sql`update message_outbox set status = 'sending', started_at = ${new Date(+now-120_000)}, first_attempt_at = ${new Date(+now-120_000)}`;
  await db!.sql`update message_outbox set first_attempt_at = ${new Date(+now-24*3600_000)} where id = ${old}`;
  await recoverMessages(deps(), now);
  const rows = await db!.sql`select id, status from message_outbox`;
  const status = (id:string) => rows.find(r => r['id'] === id)!['status'];
  assert.equal(status(sms),'uncertain'); assert.equal(status(email),'pending'); assert.equal(status(old),'uncertain');
});

test('pause, schedule changes, carrier opt-out, feedback preference and deletion suppress pending contact', options, async () => {
  let id = await add(); await db!.sql`update callers set paused = true`;
  assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  await db!.sql`update callers set paused = false`;
  id = await add('sms','moved'); await db!.sql`update callers set next_call_at = ${new Date(+now + 86400_000)}`;
  assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  id = await add('sms','carrier'); await db!.sql`update callers set sms_opt_out = true`;
  assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  await db!.sql`update callers set sms_opt_out = false, feedback_opt_out = true`;
  id = await enqueue(db!.sql, {eventKey:'feedback',phoneHash:hash,channel:'sms',kind:'feedback',to:phone,body:'Optional'}, now);
  assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  await add('email'); await db!.store.forget(phone);
  assert.equal((await db!.sql`select * from message_outbox`).length,0);
  assert.equal((await db!.sql`select * from message_attempts`).length,0);
  assert.equal(sent.length,0);
});

test('a carrier opt-out response records the preference and pauses future calls', options, async () => {
  const d = deps(); d.sms.send = async () => { throw new OptedOut(21610); };
  assert.equal(await dispatchMessage(d, await add(), now), 'suppressed');
  const [row] = await db!.sql`select paused, sms_opt_out from callers`;
  assert.equal(row!['paused'],true); assert.equal(row!['sms_opt_out'],true);
});

test('an expired or replaced code cannot be retried, and failed payloads are erased at expiry', options, async () => {
  const id = await enqueue(db!.sql, {eventKey:'code',phoneHash:hash,channel:'sms',kind:'access',reference:'obsolete',to:phone,body:'123456'}, now);
  assert.equal(await dispatchMessage(deps(),id,now),'suppressed');
  const pending = await add('sms','expire');
  const before = (await db!.sql`select payload_enc from message_outbox where id = ${pending}`)[0]!['payload_enc'];
  assert.ok(!before.includes('Synthetic')); assert.match(decrypt(before),/Synthetic notice/);
  await dispatchMessages(deps(),new Date(+now+7*3600_000));
  assert.equal(sent.length,0);
  assert.equal((await db!.sql`select payload_enc from message_outbox where id = ${pending}`)[0]!['payload_enc'],null);
});

test('feedback spacing includes all SMS and a safe retry still produces one accepted request', options, async () => {
  await dispatchMessage(deps(),await add(),now);
  await db!.sql`insert into feedback (phone_hash,state) values (${hash},'queued')`;
  const id = await enqueue(db!.sql,{eventKey:'feedback',phoneHash:hash,channel:'sms',kind:'feedback',to:phone,body:'Optional'},now);
  assert.equal(await dispatchMessage(deps(),id,now),'pending');
  assert.equal(sent.length,1);
  const later = new Date(+now+31*60_000);
  assert.equal(await dispatchMessage(deps(),id,later),'accepted');
  assert.equal(await dispatchMessage(deps(),id,later),'accepted');
  assert.equal(sent.length,2);
  assert.equal((await db!.sql`select state from feedback`)[0]!['state'],'sent');
});

test('file previews never become accepted delivery records',options,async () => {
  const d = deps(); d.sms.previewOnly = true;
  assert.equal(await dispatchMessage(d,await add(),now),'failed'); assert.equal(sent.length,0);
});

test('failure while queuing a settled call leaves the call retryable and its counter unchanged',options,async () => {
  const d = deps();
  await d.scheduler.setSlot(phone,{weekday:6,minute:600,timezone:'Europe/Oslo'},new Date(+now-86400_000));
  const [claim] = await d.scheduler.claimDue(now); assert.ok(claim);
  await d.scheduler.markPlaced(claim.attemptId,'atomic-call');
  // A real database failure after memory writes, before commit.
  await db!.sql`alter table message_outbox add constraint test_reject check (kind <> 'recap')`;
  const action = script.get('next.confirm')!.replace('{{commitment}}','book a lesson').replace('{{day}}','Friday');
  const payload = {event:'conversation.completed',conversation_id:'atomic-call',status:'completed',duration_ms:600_000,messages:[{role:'user',content:'Book a lesson'},{role:'assistant',content:action}]};
  try { await assert.rejects(settleConversation(payload,d,undefined,now)); }
  finally { await db!.sql`alter table message_outbox drop constraint test_reject`; }
  assert.equal((await db!.store.load(phone)).callNumber,1);
  assert.equal((await db!.sql`select status from call_attempts`)[0]!['status'],'placed');
  await settleConversation(payload,d,undefined,now);
  assert.equal((await db!.store.load(phone)).callNumber,2); assert.equal(sent.length,1);
});
