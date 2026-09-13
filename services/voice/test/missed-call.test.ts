import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { loadScript } from '../src/script.ts';
import { PostgresStore } from '../src/store/postgres.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import type { Slot } from '../src/schedule/time.ts';
import { handleReply, textAfterMissedCall } from '../src/sms/missed.ts';
import type { Sms } from '../src/sms/types.ts';


const KEY = Buffer.alloc(32, 7).toString('base64');
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };
const script = loadScript();

const opened = await openTestDb('missed-call');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;
const sched = sql ? new Scheduler(sql) : undefined;

/** Records what went out, so a test can assert on what somebody would read. */
class Outbox implements Sms {
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
});

const NOW = new Date('2026-09-08T06:00:00Z');

async function missedCall(phone: string): Promise<string> {
  await (store as PostgresStore).upsertProfile(phone, { name: 'Test' });
  await (sched as Scheduler).setSlot(phone, OSLO, new Date('2026-09-07T10:00:00Z'));
  const [claim] = await (sched as Scheduler).claimDue(NOW);
  await (sched as Scheduler).finish((claim as { attemptId: string }).attemptId, 'failed', { note: 'no answer' });
  return (claim as { attemptId: string }).attemptId;
}

test('a missed call produces exactly one text, whatever tries to send it', { skip: skip() }, async () => {
  const id = await missedCall('+4790000030');
  const sms = new Outbox();
  const deps = { sms, scheduler: sched as Scheduler, script };

  const [a, b] = await Promise.all([
    textAfterMissedCall(id, '+4790000030', deps),
    textAfterMissedCall(id, '+4790000030', deps),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1, 'two workers, one text');
  assert.equal(sms.sent.length, 1);

  // And a later retry, after everything settled, still sends nothing.
  assert.equal(await textAfterMissedCall(id, '+4790000030', deps), false);
  assert.equal(sms.sent.length, 1);
});

test('the text says when, never what', { skip: skip() }, async () => {
  const id = await missedCall('+4790000031');
  const sms = new Outbox();
  await textAfterMissedCall(id, '+4790000031', { sms, scheduler: sched as Scheduler, script });
  const body = sms.sent[0]?.body ?? '';
  // A lock screen is visible to whoever is sitting next to them.
  assert.ok(!/commit|last week|you said/i.test(body), body);
  assert.ok(!body.includes('!'));
  assert.ok(body.includes('SKIP'), 'the escape hatch has to be in the message');
  assert.ok(!/\bSTOP\b/.test(body), 'STOP is the carrier keyword and would unsubscribe them');
});

test('a day and a time moves this week only, and says so', { skip: skip() }, async () => {
  await missedCall('+4790000032');
  const sms = new Outbox();
  const out = await handleReply('+4790000032', 'wednesday at 9', OSLO, { sms, scheduler: sched as Scheduler, script }, NOW);
  assert.equal(out.action, 'moved');

  const rows = await (sql as postgres.Sql)`select next_call_at, slot_weekday, slot_minute from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), '2026-09-09T07:00:00.000Z');
  assert.equal(rows[0]?.['slot_weekday'], 2, 'the standing arrangement is untouched');
  assert.ok(out.said.includes('ALWAYS'), 'the way to make it permanent is offered in the same breath');
});

test('saying always moves the standing slot', { skip: skip() }, async () => {
  await missedCall('+4790000033');
  const sms = new Outbox();
  const out = await handleReply('+4790000033', 'wednesdays at 9 from now on', OSLO, { sms, scheduler: sched as Scheduler, script }, NOW);
  assert.equal(out.action, 'moved_always');

  const rows = await (sql as postgres.Sql)`select slot_weekday, slot_minute from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 3);
  assert.equal(rows[0]?.['slot_minute'], 540);
});

test('skipping a week is not leaving', { skip: skip() }, async () => {
  await missedCall('+4790000034');
  const sms = new Outbox();
  const out = await handleReply('+4790000034', 'skip', OSLO, { sms, scheduler: sched as Scheduler, script }, NOW);
  assert.equal(out.action, 'skipped');

  const rows = await (sql as postgres.Sql)`select slot_weekday, paused, next_call_at from callers`;
  assert.equal(rows[0]?.['paused'], false, 'they skipped a week, they did not leave');
  assert.equal(rows[0]?.['slot_weekday'], 2);
  assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), '2026-09-15T06:00:00.000Z');
});

test('later means today, and does not move the arrangement', { skip: skip() }, async () => {
  await missedCall('+4790000035');
  const sms = new Outbox();
  const out = await handleReply('+4790000035', 'try again tonight', OSLO, { sms, scheduler: sched as Scheduler, script }, NOW);
  assert.equal(out.action, 'later');

  const rows = await (sql as postgres.Sql)`select next_call_at, slot_weekday from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), '2026-09-08T14:00:00.000Z');
  assert.equal(rows[0]?.['slot_weekday'], 2);
});

test('something it cannot read still gets an answer', { skip: skip() }, async () => {
  await missedCall('+4790000036');
  const sms = new Outbox();
  const out = await handleReply('+4790000036', 'maybe sometime', OSLO, { sms, scheduler: sched as Scheduler, script }, NOW);
  assert.equal(out.action, 'unread');
  // Silence teaches somebody that the thing does not listen, which is the
  // opposite of what the call spends fifteen minutes establishing.
  assert.equal(sms.sent.length, 1);
  assert.ok(out.said.length > 0);
});
