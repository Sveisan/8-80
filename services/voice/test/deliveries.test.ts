import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type postgres from 'postgres';
import { Deliveries } from '../src/webhook/deliveries.ts';
import { openTestDb } from './helpers/db.ts';

const KEY = Buffer.alloc(32, 11).toString('base64');

const opened = await openTestDb('deliveries');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table webhook_deliveries`;
});

async function withKey<T>(fn: () => T | Promise<T>): Promise<T> {
  const before = process.env['DATA_ENCRYPTION_KEY'];
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env['DATA_ENCRYPTION_KEY'];
    else process.env['DATA_ENCRYPTION_KEY'] = before;
  }
}

const body = (extra: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      id: 'evt_1',
      type: 'conversation.completed',
      data: { object: { id: 'conv_abc', duration_ms: 1000 }, messages: [] },
      ...extra,
    }),
  );

test('a delivery comes back byte for byte', { skip: skip() }, async () => {
  await withKey(async () => {
    const d = new Deliveries(sql!);
    const raw = body();
    await d.record(raw, { deliveryId: 'del_1', event: 'conversation.completed' });
    const found = await d.body('del_1');
    // Verbatim, not re-serialised: a signature is over exact bytes, and a bug
    // may live in the difference between their JSON and ours.
    assert.equal(found?.body, raw.toString('utf8'));
    assert.equal(found?.event, 'conversation.completed');
  });
});

test('it is findable by the conversation, which is what you actually have', { skip: skip() }, async () => {
  await withKey(async () => {
    const d = new Deliveries(sql!);
    await d.record(body(), { deliveryId: 'del_2' });
    assert.equal((await d.body('conv_abc'))?.id, 'del_2');
  });
});

test('a payload we cannot read is stored anyway', { skip: skip() }, async () => {
  // The entire point of the table. These are the ones worth keeping.
  await withKey(async () => {
    const d = new Deliveries(sql!);
    const junk = Buffer.from('{"not":"anything we understand"}');
    await d.record(junk, { deliveryId: 'del_3', event: 'conversation.completed' });
    const found = await d.body('del_3');
    assert.equal(found?.body, junk.toString('utf8'));
    assert.equal((await d.list())[0]?.conversationId, null, 'no id to find it by, and that is fine');
  });
});

test('what arrives is not stored in the clear', { skip: skip() }, async () => {
  await withKey(async () => {
    const d = new Deliveries(sql!);
    await d.record(Buffer.from('{"said":"I have not slept in a week"}'), { deliveryId: 'del_4' });
    const [row] = await sql!<{ body_enc: string }[]>`select body_enc from webhook_deliveries where id = 'del_4'`;
    assert.ok(!row?.body_enc.includes('slept'), 'a transcript reached the column in plaintext');
  });
});

test('a retry updates the row it already has rather than piling up', { skip: skip() }, async () => {
  await withKey(async () => {
    const d = new Deliveries(sql!);
    await d.record(body(), { deliveryId: 'del_5' });
    await d.record(body(), { deliveryId: 'del_5' });
    assert.equal((await d.list()).length, 1);
  });
});

test('nothing older than the window survives a prune', { skip: skip() }, async () => {
  await withKey(async () => {
    const d = new Deliveries(sql!);
    await d.record(body(), { deliveryId: 'del_old' });
    await sql!`update webhook_deliveries set received_at = now() - interval '30 days' where id = 'del_old'`;
    await d.record(body(), { deliveryId: 'del_new' });

    assert.equal(await d.prune(new Date(), 14 * 24 * 3600_000), 1);
    const left = await d.list();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.id, 'del_new');
  });
});

test('storing a delivery never costs us the webhook', async () => {
  // A debugging aid that can 500 a real delivery would lose the very call it
  // was added to help us understand. Needs no database: the point is the throw.
  await withKey(async () => {
    const onFire = (() => {
      throw new Error('database is on fire');
    }) as unknown as postgres.Sql;
    const broken = new Deliveries(onFire);
    assert.equal(await broken.record(body(), { deliveryId: 'del_6' }), undefined);
    await broken.verdict('del_6', 'settled');
  });
});

test('with no encryption key nothing is written at all', { skip: skip() }, async () => {
  const before = process.env['DATA_ENCRYPTION_KEY'];
  delete process.env['DATA_ENCRYPTION_KEY'];
  try {
    const d = new Deliveries(sql!);
    assert.equal(await d.record(body(), { deliveryId: 'del_7' }), undefined);
    assert.equal((await d.list()).length, 0, 'a transcript went to disk with no key to protect it');
  } finally {
    if (before !== undefined) process.env['DATA_ENCRYPTION_KEY'] = before;
  }
});
