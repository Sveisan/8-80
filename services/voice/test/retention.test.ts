import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { milestone, retentionReport, pruneJourney } from '../src/journey/measure.ts';
import { phoneKey } from '../src/store/postgres.ts';

const opened = await openTestDb('retention');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const DAY = 86400_000;
const start = new Date('2026-09-01T12:00:00Z');
const at = (days: number, base = start): Date => new Date(+base + days * DAY);
let sequence = 0;

beforeEach(async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  if (db) {
    await db.sql`truncate journey_events, journey_counts, callers`;
    await db.sql`update journey_tracking set started_at = ${start} where event = 'conversation_completed'`;
  }
  sequence = 0;
});
after(async () => { await db?.close(); });

async function account(suffix: number, verified = start): Promise<{ phone: string; hash: string }> {
  const phone = `+47970000${String(suffix).padStart(2, '0')}`, hash = phoneKey(phone);
  await db!.store.upsertProfile(phone, { email: 'retention@example.com' });
  await milestone(db!.sql, hash, 'phone_verified', hash, verified);
  return { phone, hash };
}
async function conversation(hash: string, days: number, cycle: string, base = start): Promise<void> {
  await milestone(db!.sql, hash, 'conversation_completed', `attempt-${++sequence}`, at(days, base), cycle);
}

test('mature cohorts count distinct cycles, include stopped customers, and separate missing tracking from immaturity', options, async () => {
  const retained = await account(1);
  for (const day of [1, 8, 22]) await conversation(retained.hash, day, `retained-${day}`);
  // No action markers are required. Retention does not force a commitment.
  const early = await account(2);
  await conversation(early.hash, 1, 'early-1');
  await conversation(early.hash, 8, 'early-2');
  // A late callback to a previously completed cycle must not invent a late weekly return.
  await conversation(early.hash, 28, 'early-2');
  const callback = await account(3);
  await conversation(callback.hash, 1, 'callback-cycle');
  await conversation(callback.hash, 29, 'callback-cycle');
  const stopped = await account(4);
  await db!.sql`update callers set paused = true where phone_hash = ${stopped.hash}`;
  await account(5, at(39)); // still inside its first month
  await account(6, at(-5)); // verified before instrumentation began
  const report = await retentionReport(db!.sql, at(49));
  assert.equal(report.verified_accounts, 4);
  assert.equal(report.accounts_with_repeat_conversations, 2);
  assert.equal(report.accounts_with_three_cycles, 1);
  assert.equal(report.accounts_with_late_month_return, 1);
  assert.equal(report.late_month_return_rate, 0.25);
  assert.equal(report.immature_accounts, 1);
  assert.equal(report.mature_accounts_without_full_tracking, 1);
  for (const privateValue of [retained.hash, retained.phone, 'retention@example.com', 'callback-cycle']) {
    assert.ok(!JSON.stringify(report).includes(privateValue));
  }
});

test('the observation window uses elapsed hours across daylight saving and excludes the 30-day boundary', options, async () => {
  const verified = new Date('2026-09-30T12:00:00Z');
  const caller = await account(7, verified);
  await conversation(caller.hash, 1, 'first', verified);
  await conversation(caller.hash, 30, 'outside-trial', verified);
  await db!.sql`set time zone 'Europe/Oslo'`;
  try {
    const report = await retentionReport(db!.sql, at(31, verified));
    assert.equal(report.verified_accounts, 1);
    assert.equal(report.accounts_with_repeat_conversations, 0);
    assert.equal(report.accounts_with_late_month_return, 0);
  } finally { await db!.sql`set time zone 'UTC'`; }
});

test('the exact maturity and late-return boundaries count; deletion and retention limits remain explicit', options, async () => {
  const caller = await account(8);
  await conversation(caller.hash, 1, 'first');
  await conversation(caller.hash, 21, 'late');
  const report = await retentionReport(db!.sql, at(30));
  assert.equal(report.verified_accounts, 1);
  assert.equal(report.accounts_with_late_month_return, 1);
  assert.equal(report.immature_accounts, 0);
  await db!.store.forget(caller.phone);
  const deleted = await retentionReport(db!.sql, at(30));
  assert.equal(deleted.verified_accounts, 0);
  assert.equal(deleted.late_month_return_rate, null);
  assert.match(deleted.limitations, /Deleted accounts/);
  await pruneJourney(db!.sql, at(90));
  assert.equal((await db!.sql`select * from journey_events`).length, 0);
  assert.equal((await db!.sql`select * from journey_tracking`).length, 1, 'global tracking date has no customer data');
});
