import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { PostgresStore, phoneKey } from '../src/store/postgres.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler, UnknownCaller } from '../src/schedule/scheduler.ts';
import type { Slot } from '../src/schedule/time.ts';


const KEY = Buffer.alloc(32, 7).toString('base64');
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };

const opened = await openTestDb('scheduler');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;
const sched = sql ? new Scheduler(sql) : undefined;

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
});

/** A caller with a slot, ready to be due. */
async function caller(phone: string, slot = OSLO, now = new Date('2026-09-07T10:00:00Z')): Promise<void> {
  await (store as PostgresStore).upsertProfile(phone, { name: 'Test' });
  await (sched as Scheduler).setSlot(phone, slot, now);
}

test('nobody is due before their slot comes round', { skip: skip() }, async () => {
  await caller('+4790000010');
  const claims = await (sched as Scheduler).claimDue(new Date('2026-09-08T05:59:00Z'));
  assert.deepEqual(claims, []);
});

test('a caller is due at their slot, and the slot moves to next week', { skip: skip() }, async () => {
  await caller('+4790000011');
  const claims = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.phoneHash, phoneKey('+4790000011'));
  assert.equal(claims[0]?.scheduledFor.toISOString(), '2026-09-08T06:00:00.000Z');

  const rows = await (sql as postgres.Sql)`select next_call_at from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), '2026-09-15T06:00:00.000Z');
});

test('a second tick in the same week claims nothing', { skip: skip() }, async () => {
  await caller('+4790000012');
  const first = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  const second = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:05:00Z'));
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, 'the slot already moved — nothing is due until next Tuesday');
});

test('two schedulers racing ring the caller once, not twice', { skip: skip() }, async () => {
  await caller('+4790000013');
  const now = new Date('2026-09-08T06:00:00Z');
  const [a, b] = await Promise.all([
    (sched as Scheduler).claimDue(now),
    new Scheduler(sql as postgres.Sql).claimDue(now),
  ]);
  assert.equal(a.length + b.length, 1, 'exactly one of the two may place this call');
  const attempts = await (sql as postgres.Sql)`select count(*)::int as n from call_attempts`;
  assert.equal(attempts[0]?.['n'], 1);
});

test('a paused caller is never due, and resuming does not re-enter the slot', { skip: skip() }, async () => {
  await caller('+4790000014');
  await (sched as Scheduler).setPaused('+4790000014', true);
  assert.equal((await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'))).length, 0);

  await (sched as Scheduler).setPaused('+4790000014', false);
  const back = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  assert.equal(back.length, 1, 'the slot they chose is still theirs when they come back');
});

test('a caller with no slot is not due, however long they sit there', { skip: skip() }, async () => {
  await (store as PostgresStore).upsertProfile('+4790000015', { name: 'No slot' });
  assert.equal((await (sched as Scheduler).claimDue(new Date('2030-01-01T00:00:00Z'))).length, 0);
});

test('a claim that never became a call shows up as stale', { skip: skip() }, async () => {
  await caller('+4790000016');
  const [claim] = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  assert.ok(claim);
  // Nothing marks it placed — the process died, or the API did.
  await (sql as postgres.Sql)`update call_attempts set claimed_at = now() - interval '1 hour'`;
  const stale = await (sched as Scheduler).stale();
  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.status, 'claimed');

  await (sched as Scheduler).finish(claim.attemptId, 'completed', { durationMs: 900_000 });
  assert.deepEqual(await (sched as Scheduler).stale(), [], 'a finished call is not stale');
});

test('a call nobody could hear is recorded as its own kind of failure', { skip: skip() }, async () => {
  await caller('+4790000017');
  const [claim] = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  assert.ok(claim);
  await (sched as Scheduler).markPlaced(claim.attemptId, 'conv_01m21by5nben2adjh1k10t2rh0');
  await (sched as Scheduler).finish(claim.attemptId, 'silent', { durationMs: 15_000, note: 'no caller turns in transcript' });

  const rows = await (sql as postgres.Sql)`select status, provider_call_id, note from call_attempts`;
  assert.equal(rows[0]?.['status'], 'silent');
  assert.equal(rows[0]?.['provider_call_id'], 'conv_01m21by5nben2adjh1k10t2rh0');
});

test('a slot that went by while the box was off is missed, not called late', { skip: skip() }, async () => {
  await caller('+4790000018');
  // Two Tuesdays passed unattended. Neither is rung six days late.
  const claims = await (sched as Scheduler).claimDue(new Date('2026-09-22T09:00:00Z'));
  assert.deepEqual(claims, [], 'a call three hours late is not the weekly call');

  const rows = await (sql as postgres.Sql)`select status, scheduled_for from call_attempts order by scheduled_for`;
  // The 8th, the 15th, and the 22nd itself — three hours late is still too late.
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r['status']),
    ['missed', 'missed', 'missed'],
    'the weeks someone did not get are written down rather than papered over',
  );

  const caller_ = await (sql as postgres.Sql)`select next_call_at from callers`;
  assert.equal(
    (caller_[0]?.['next_call_at'] as Date).toISOString(),
    '2026-09-29T06:00:00.000Z',
    'the next call is the next real Tuesday, not a backlog',
  );
});

test('a call inside the grace window is still the call', { skip: skip() }, async () => {
  await caller('+4790000019');
  // Half an hour late: the box was slow, not absent.
  const claims = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:30:00Z'));
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.scheduledFor.toISOString(), '2026-09-08T06:00:00.000Z');
});

test('months of downtime do not write an unbounded backlog', { skip: skip() }, async () => {
  await caller('+4790000020');
  await (sched as Scheduler).claimDue(new Date('2027-06-01T09:00:00Z'));
  const rows = await (sql as postgres.Sql)`select count(*)::int as n from call_attempts`;
  assert.ok((rows[0]?.['n'] as number) <= 12, `wrote ${rows[0]?.['n']} rows for a nine-month gap`);
});

test('setting a slot for nobody is an error, not a quiet success', { skip: skip() }, async () => {
  // An UPDATE matching no rows succeeds. This one printed "Slot set" for a
  // caller who did not exist, so nobody was ever due and the only symptom was
  // a phone that did not ring on a morning it was expected to.
  await assert.rejects(
    () => (sched as Scheduler).setSlot('+4790000099', OSLO, new Date('2026-09-07T10:00:00Z')),
    UnknownCaller,
  );
  await assert.rejects(
    () => (sched as Scheduler).callAgainAt('+4790000099', new Date()),
    UnknownCaller,
  );
});

test('enrolling then setting a slot leaves somebody actually due', { skip: skip() }, async () => {
  await (store as NonNullable<typeof store>).upsertProfile('+4790000098', {});
  await (sched as Scheduler).setSlot('+4790000098', OSLO, new Date('2026-09-07T10:00:00Z'));
  const claims = await (sched as Scheduler).claimDue(new Date('2026-09-08T06:00:00Z'));
  assert.equal(claims.length, 1, 'a slot that was set must produce a call');
});
