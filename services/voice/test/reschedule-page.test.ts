import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Links } from '../src/link/token.ts';
import { controlPlane } from '../src/control.ts';
import { nextSlotAfter, type Slot } from '../src/schedule/time.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
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
  if (sql) await sql`truncate table message_attempts, message_outbox, callers, call_attempts, links`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
});

/**
 * Runs the body against a listening control plane and always closes it.
 *
 * A `stop()` after the assertions is a `stop()` that does not run when one
 * fails, and a listening server keeps the process alive — so a failing test
 * becomes a hanging suite with no output, which is far more expensive to read
 * than a red line.
 */
async function serving(body: (base: string) => Promise<void>): Promise<void> {
  const server = controlPlane(deps(), 'whsec_x');
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function enrolled(phone: string): Promise<string> {
  await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'Eirik' });
  await (sched as Scheduler).setSlot(phone, OSLO, new Date('2026-09-07T10:00:00Z'));
  return await new Links(sql as NonNullable<typeof sql>).mint(phoneKey(phone));
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

  await serving(async (base) => {
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
  });
});

test('a tap moves this week and leaves the arrangement alone', { skip: skip() }, async () => {
  const token = await enrolled('+4790000061');
  await serving(async (base) => {

  const res = await post(base, token, { action: 'move', weekday: '3', time: '09:00' });
  assert.equal(res.status, 200);

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, next_call_at from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 2, 'the standing slot is untouched');
  const next = rows[0]?.['next_call_at'] as Date;
  assert.equal(next.getUTCDay(), 3);
  });
});

test('ticking "every week" moves the standing slot', { skip: skip() }, async () => {
  const token = await enrolled('+4790000062');
  await serving(async (base) => {
  await post(base, token, { action: 'move', weekday: '4', time: '07:30', always: '1' });

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, slot_minute from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 4);
  assert.equal(rows[0]?.['slot_minute'], 450);
  });
});

test('a skip form targets the displayed appointment and cannot skip twice', { skip: skip() }, async () => {
  const phone = '+4790000063';
  const token = await enrolled(phone);
  await (store as NonNullable<typeof store>).record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const next = await (sched as Scheduler).setSlot(phone, OSLO);
  await serving(async (base) => {
    const body = await (await fetch(`${base}/r/${token}`)).text();
    const skipAt = /name="skip_at" value="([^"]+)"/.exec(body)?.[1];
    assert.equal(skipAt, next.toISOString(), 'the occurrence the page names is the one submitted');
    assert.match(body, /Skip this call/);
    assert.ok(!body.includes('value="later"'), 'no action guesses an hour');

    const form = { action: 'skip', skip_at: skipAt as string };
    const first = await post(base, token, form);
    assert.match(await first.text(), /Skipped/);
    const second = await post(base, token, form);
    assert.match(await second.text(), /No call changed/);

    const rows = await (sql as NonNullable<typeof sql>)`select paused, slot_weekday, next_call_at from callers`;
    assert.equal(rows[0]?.['paused'], false);
    assert.equal(rows[0]?.['slot_weekday'], 2);
    assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), nextSlotAfter(next, OSLO).toISOString());
  });
});

test('legacy later and untargeted skip forms cannot change a returning caller schedule', { skip: skip() }, async () => {
  const phone = '+4790000068';
  const token = await enrolled(phone);
  await (store as NonNullable<typeof store>).record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const next = await (sched as Scheduler).setSlot(phone, OSLO);
  await serving(async (base) => {
    const forms: Record<string, string>[] = [{ action: 'later' }, { action: 'skip' }, { action: 'skip', skip_at: 'not-a-date' }];
    for (const form of forms) {
      const res = await post(base, token, form);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /name="time"/);
      assert.equal((await (sched as Scheduler).nextCallFor(phone))?.toISOString(), next.toISOString());
    }
  });
});

test('an expired or forged link says so and does nothing', { skip: skip() }, async () => {
  await enrolled('+4790000064');
  await serving(async (base) => {

  const forged = await fetch(`${base}/r/abcdefghij`);
  assert.equal(forged.status, 410);
  // Against the script line, not a literal: the copy is Eirik's to reword.
  assert.ok((await forged.text()).includes(script.get('page.expired') ?? ''));

  const stale = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey('+4790000064'), new Date(Date.now() - 8 * 24 * 3600_000));
  assert.equal((await fetch(`${base}/r/${stale}`)).status, 410);

  // And nothing moved.
  const rows = await (sql as NonNullable<typeof sql>)`select next_call_at from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).getUTCDay(), 2);
  });
});

test('a link for somebody who has since left is not an error page with a stack in it', { skip: skip() }, async () => {
  const token = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey('+4790000065'));
  await serving(async (base) => {
  const res = await fetch(`${base}/r/${token}`);
  assert.equal(res.status, 410);
  assert.ok(!(await res.text()).includes('Error'));
  });
});

/**
 * The address the call is not allowed to ask for.
 *
 * SCRIPT.md §7: an email address is never taken on a call — one real call spent
 * ninety seconds failing to spell a Norwegian name letter by letter down a
 * phone line. So it is collected here, and "here" has to actually work.
 */
test('an address can be set from the link, and a bad one changes nothing', { skip: skip() }, async () => {
  const phone = '+4790000066';
  const token = await enrolled(phone);
  const s_ = store as NonNullable<typeof store>;

  await serving(async (base) => {
    const bad = await post(base, token, { action: 'email', email: 'eirik at example dot com' });
    assert.equal(bad.status, 200);
    assert.match(await bad.text(), /another go/i, 'nothing told them it was refused');
    assert.equal((await s_.load(phone)).email, undefined, 'a rejected address was stored anyway');

    const ok = await post(base, token, { action: 'email', email: 'eirik@example.com' });
    assert.equal(ok.status, 200);
    const body = await ok.text();
    assert.match(body, /Saved/i);
    assert.match(body, /e•••@e•••\.com/, 'the saved address is recognisable');
    assert.ok(!body.includes('eirik@example.com'), 'the full address must not appear in markup');
    assert.equal((await s_.load(phone)).email, 'eirik@example.com');
  });
});

test('setting an address does not disturb the slot', { skip: skip() }, async () => {
  // One page, several controls, one caller record. A form that saved an address
  // by rewriting the row would quietly move somebody's weekly call.
  const phone = '+4790000067';
  const token = await enrolled(phone);
  const before = await (sched as Scheduler).slotFor(phone);

  await serving(async (base) => {
    await post(base, token, { action: 'email', email: 'x@example.com' });
  });

  assert.deepEqual(await (sched as Scheduler).slotFor(phone), before);
});
