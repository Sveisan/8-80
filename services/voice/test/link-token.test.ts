import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { Links } from '../src/link/token.ts';

const HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-08T06:00:00Z');

const opened = await openTestDb('links');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const links = db ? new Links(db.sql) : undefined;

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (db) await db.sql`truncate table links`;
});

test('a code is short enough to sit in a text message', { skip: skip() }, async () => {
  const code = await (links as Links).mint(HASH, NOW);
  assert.equal(code.length, 10);
  // Eighty characters of base64 in an SMS looks like the kind of link nobody
  // should tap, which is a problem for a product that needs to be trusted.
  assert.match(code, /^[a-z2-9]{10}$/);
  // No 0/O and no 1/l: somebody may read this off one screen onto another.
  assert.ok(!/[01lo]/.test(code));
});

test('the number is never in the code, and neither is anything derived from it', { skip: skip() }, async () => {
  const a = await (links as Links).mint(HASH, NOW);
  const b = await (links as Links).mint(HASH, NOW);
  // Two codes for the same caller must not resemble each other, or anybody
  // holding one could work out the others.
  assert.notEqual(a, b);
  assert.ok(!a.includes('47'));
});

test('a code opens for the caller it was minted for', { skip: skip() }, async () => {
  const code = await (links as Links).mint(HASH, NOW);
  const out = await (links as Links).open(code, NOW);
  assert.equal(out.ok, true);
  assert.equal((out as { claims: { phoneHash: string } }).claims.phoneHash, HASH);
});

test('a code found in an old thread has expired', { skip: skip() }, async () => {
  const code = await (links as Links).mint(HASH, NOW);
  const out = await (links as Links).open(code, new Date(NOW.getTime() + 8 * 24 * 3600_000));
  assert.equal(out.ok, false);
});

test('a guessed or malformed code opens nothing', { skip: skip() }, async () => {
  for (const c of ['', 'x', 'abcdefghij', '../../etc/passwd', "'; drop table links; --", 'ABCDEFGHIJ']) {
    assert.equal((await (links as Links).open(c, NOW)).ok, false, c);
  }
});

test('a code can be withdrawn, which a signed token cannot', { skip: skip() }, async () => {
  const code = await (links as Links).mint(HASH, NOW);
  await (db as NonNullable<typeof db>).sql`delete from links where code = ${code}`;
  assert.equal((await (links as Links).open(code, NOW)).ok, false);
});

test('pruning clears what has expired and leaves what has not', { skip: skip() }, async () => {
  const live = await (links as Links).mint(HASH, NOW);
  const dead = await (links as Links).mint(HASH, new Date(NOW.getTime() - 9 * 24 * 3600_000));
  assert.equal(await (links as Links).prune(NOW), 1);
  assert.equal((await (links as Links).open(live, NOW)).ok, true);
  assert.equal((await (links as Links).open(dead, NOW)).ok, false);
});
