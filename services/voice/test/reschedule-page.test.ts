import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { mintLink } from '../src/link/token.ts';
import { controlPlane } from '../src/control.ts';
import type { Slot } from '../src/schedule/time.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
const LINK_SECRET = 'link_secret';
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };
const script = loadScript();

const opened = await openTestDb('reschedule_page');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;
const sched = sql ? new Scheduler(sql) : undefined;

const deps = (): LoopDeps => ({
  store: store as NonNullable<typeof store>,
  scheduler: sched as Scheduler,
  agent: { placeCall: async () => ({ conversationId: 'x', status: 'pending' }), conversation: async () => ({}) } as unknown as LoopDeps['agent'],
  mailer: { send: async () => undefined },
  sms: { send: async () => undefined },
  script,
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  process.env['LINK_SECRET'] = LINK_SECRET;
});

async function serve(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = controlPlane(deps(), 'whsec_x');
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function enrolled(phone: string): Promise<string> {
  await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'Eirik' });
  await (sched as Scheduler).setSlot(phone, OSLO, new Date('2026-09-07T10:00:00Z'));
  return mintLink(phoneKey(phone), LINK_SECRET);
}

const post = (base: string, token: string, form: Record<string, string>) =>
  fetch(`${base}/r/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    redirect: 'manual',
  });

test('the page opens and shows the slot and nothing else', { skip: skip() }, async () => {
  const token = await enrolled('+4790000060');
  await (store as NonNullable<typeof store>).record('+4790000060', {
    at: new Date().toISOString(),
    durationMs: 1,
    commitment: 'phone my brother',
    day: 'wednesday',
  });

  const { base, stop } = await serve();
  const res = await fetch(`${base}/r/${token}`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /Tuesday/);
  assert.match(body, /08:00/);
  // Whoever is holding the phone should find this page boring.
  assert.ok(!body.includes('phone my brother'), 'the commitment must never be on a page reachable by link');
  assert.ok(!body.includes('4790000060'), 'nor the number');
  assert.ok(!body.includes('Eirik'), 'nor their name');
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  await stop();
});

test('a tap moves this week and leaves the arrangement alone', { skip: skip() }, async () => {
  const token = await enrolled('+4790000061');
  const { base, stop } = await serve();

  const res = await post(base, token, { action: 'move', weekday: '3', time: '09:00' });
  assert.equal(res.status, 200);

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, next_call_at from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 2, 'the standing slot is untouched');
  const next = rows[0]?.['next_call_at'] as Date;
  assert.equal(next.getUTCDay(), 3);
  await stop();
});

test('ticking "every week" moves the standing slot', { skip: skip() }, async () => {
  const token = await enrolled('+4790000062');
  const { base, stop } = await serve();
  await post(base, token, { action: 'move', weekday: '4', time: '07:30', always: '1' });

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, slot_minute from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 4);
  assert.equal(rows[0]?.['slot_minute'], 450);
  await stop();
});

test('leaving the week does not pause them', { skip: skip() }, async () => {
  const token = await enrolled('+4790000063');
  const { base, stop } = await serve();
  await post(base, token, { action: 'skip' });

  const rows = await (sql as NonNullable<typeof sql>)`select paused, slot_weekday from callers`;
  assert.equal(rows[0]?.['paused'], false);
  assert.equal(rows[0]?.['slot_weekday'], 2);
  await stop();
});

test('an expired or forged link says so and does nothing', { skip: skip() }, async () => {
  await enrolled('+4790000064');
  const { base, stop } = await serve();

  const forged = await fetch(`${base}/r/not.a.token`);
  assert.equal(forged.status, 410);
  assert.match(await forged.text(), /expired/i);

  const stale = mintLink(phoneKey('+4790000064'), LINK_SECRET, new Date(Date.now() - 8 * 24 * 3600_000));
  assert.equal((await fetch(`${base}/r/${stale}`)).status, 410);

  // And nothing moved.
  const rows = await (sql as NonNullable<typeof sql>)`select next_call_at from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).getUTCDay(), 2);
  await stop();
});

test('a link for somebody who has since left is not an error page with a stack in it', { skip: skip() }, async () => {
  const token = mintLink(phoneKey('+4790000065'), LINK_SECRET);
  const { base, stop } = await serve();
  const res = await fetch(`${base}/r/${token}`);
  assert.equal(res.status, 410);
  assert.ok(!(await res.text()).includes('Error'));
  await stop();
});
