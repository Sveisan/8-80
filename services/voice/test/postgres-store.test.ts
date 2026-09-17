import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { PostgresStore, phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { openTestDb } from './helpers/db.ts';


const KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * A real database or no test at all — a mocked Postgres proves the mock works.
 * When one is not reachable the tests skip loudly rather than passing quietly,
 * because a green suite that silently stopped covering the store is worse than
 * a red one.
 *
 * The probe runs at module load, not in a `before` hook: node:test evaluates
 * the `skip` option when the test is defined, which happens before any hook
 * runs. Hooking it skipped all seven and reported success.
 */
const opened = await openTestDb('postgres-store');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers`;
});

async function withKey<T>(fn: () => T | Promise<T>): Promise<T> {
  const before_ = process.env['DATA_ENCRYPTION_KEY'];
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  try {
    return await fn();
  } finally {
    if (before_ === undefined) delete process.env['DATA_ENCRYPTION_KEY'];
    else process.env['DATA_ENCRYPTION_KEY'] = before_;
  }
}

test('the first call has no history, and the second one does', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    const first = await s.load('+4790000000');
    assert.equal(first.callNumber, 1);
    assert.equal(first.lastCommitment, undefined);

    await s.record('+4790000000', { at: new Date().toISOString(), durationMs: 1000, commitment: 'run three times', day: 'wednesday' });
    const second = await s.load('+4790000000');
    assert.equal(second.callNumber, 2);
    assert.equal(second.lastCommitment, 'run three times');
    assert.equal(second.lastCommitmentDay, 'wednesday');
  });
});

test('a call that reached no commitment leaves last week standing', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.record('+4790000001', { at: new Date().toISOString(), durationMs: 1000, commitment: 'run three times', day: 'wednesday' });
    await s.record('+4790000001', { at: new Date().toISOString(), durationMs: 1000 });
    const after_ = await s.load('+4790000001');
    assert.equal(after_.lastCommitment, 'run three times');
    assert.equal(after_.lastCommitmentDay, 'wednesday');
    assert.equal(after_.callNumber, 3);
  });
});

test('two calls landing at once do not lose a week between them', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    const at = new Date().toISOString();
    // The file store reads, adds one, and writes back. Run that twice
    // concurrently and both read the same number and both write the same
    // successor. The increment here happens inside the statement.
    await Promise.all([
      s.record('+4790000003', { at, durationMs: 1000, commitment: 'first' }),
      s.record('+4790000003', { at, durationMs: 1000, commitment: 'second' }),
    ]);
    const after_ = await s.load('+4790000003');
    assert.equal(after_.callNumber, 3, 'two records must advance the count twice');
  });
});

test('nothing is written in the clear when there is no key', { skip: skip() }, async () => {
  const before_ = process.env['DATA_ENCRYPTION_KEY'];
  delete process.env['DATA_ENCRYPTION_KEY'];
  try {
    const s = store as PostgresStore;
    await s.record('+4790000002', { at: new Date().toISOString(), durationMs: 1000, commitment: 'something private' });
    const rows = await (sql as postgres.Sql)`select count(*)::int as n from callers`;
    assert.equal(rows[0]?.['n'], 0, 'no key means no row, not a plaintext row');
  } finally {
    if (before_ !== undefined) process.env['DATA_ENCRYPTION_KEY'] = before_;
  }
});

test('the table is not a phone book, and the words are not in it', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.record('+4790033575', { at: new Date().toISOString(), durationMs: 1000, commitment: 'phone my brother' });
    const rows = await (sql as postgres.Sql)`select * from callers`;
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes('4790033575'), 'select * must not return a phone number');
    assert.ok(!dump.includes('phone my brother'), 'select * must not return what they said');
    // And the hash is what we look up by, so it has to be there.
    assert.ok(dump.includes(phoneKey('+4790033575')));
  });
});

test('a number can be recovered to ring it, and only that way', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.record('+4790033575', { at: new Date().toISOString(), durationMs: 1000, commitment: 'x' });
    assert.equal(await s.phoneFor(phoneKey('+4790033575')), '+4790033575');
    assert.equal(await s.phoneFor(phoneKey('+4790000009')), undefined);
  });
});

test('a profile can be set without a call having happened', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.upsertProfile('+4790000004', { name: 'Eirik', language: 'no', voice: 'male', email: 'e@example.com' });
    const rec = await s.load('+4790000004');
    assert.equal(rec.name, 'Eirik');
    assert.equal(rec.voice, 'male');
    assert.equal(rec.email, 'e@example.com');
    assert.equal(rec.callNumber, 1, 'a profile is not a call');
  });
});

test('the address the recap goes to is not readable in the table either', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.upsertProfile('+4790000005', { email: 'eirik@example.com' });
    const rows = await (sql as postgres.Sql)`select * from callers`;
    // An address identifies a person as squarely as a number does.
    assert.ok(!JSON.stringify(rows).includes('eirik@example.com'));
    assert.equal((await s.load('+4790000005')).email, 'eirik@example.com');
  });
});

test('a scheduler built from store.raw can write a timestamp', { skip: skip() }, async () => {
  await withKey(async () => {
    const s = store as PostgresStore;
    await s.upsertProfile('+4790000006', { name: 'Raw' });
    // The production wiring, which the other tests do not use: they build a
    // scheduler from their own client, and drizzle had quietly replaced the
    // serialisers on the one the store hands out. Every test passed while the
    // deployed process could not set a slot.
    await new Scheduler(s.raw).setSlot(
      '+4790000006',
      { weekday: 2, minute: 480, timezone: 'Europe/Oslo' },
      new Date('2026-09-07T10:00:00Z'),
    );
    const rows = await (sql as postgres.Sql)`select next_call_at from callers where phone_hash = ${phoneKey('+4790000006')}`;
    assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), '2026-09-08T06:00:00.000Z');
  });
});
