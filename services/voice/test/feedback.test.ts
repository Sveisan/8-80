import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Links } from '../src/link/token.ts';
import { controlPlane } from '../src/control.ts';
import { feedbackNumbers, sendDueFeedback } from '../src/feedback/feedback.ts';
import { composeExport } from '../src/legal/export.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

/** SCRIPT.md §20: one feedback text, once, fifteen minutes after the call. */

const KEY = Buffer.alloc(32, 7).toString('base64');
const script = loadScript();
const MIN = 60_000;

const opened = await openTestDb('feedback');
const skip = () => (typeof opened === 'string' ? opened : false);
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql as NonNullable<typeof db>['sql'];
const store = db?.store as NonNullable<typeof db>['store'];
const sched = sql ? new Scheduler(sql) : (undefined as unknown as Scheduler);

let sent: Array<{ to: string; body: string }> = [];
const deps = (): LoopDeps => ({
  store,
  scheduler: sched,
  agent: {} as LoopDeps['agent'],
  mailer: { send: async () => undefined },
  sms: { send: async (to: string, body: string) => void sent.push({ to, body }) },
  script,
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers, call_attempts, links, feedback`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  process.env['PUBLIC_URL'] = 'https://8and80.me';
  delete process.env['FEEDBACK_AFTER_CALL'];
  sent = [];
});

async function caller(phone: string): Promise<void> {
  await store.upsertProfile(phone, { name: 'x' });
  await sched.setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
}

/** A call that happened, ending `endedAgo` before `now`. */
async function call(phone: string, now: Date, endedAgo: number, extra: { minutes?: number; note?: string; tier?: number } = {}): Promise<void> {
  const ended = new Date(now.getTime() - endedAgo);
  await sql`
    insert into call_attempts (id, phone_hash, scheduled_for, status, ended_at, duration_ms, note, safety_tier)
    values (${randomUUID()}, ${phoneKey(phone)}, ${new Date(ended.getTime() - 20 * MIN).toISOString()}, 'completed',
            ${ended.toISOString()}, ${(extra.minutes ?? 12) * MIN}, ${extra.note ?? null}, ${extra.tier ?? null})
  `;
}

const now = new Date('2026-10-06T09:00:00Z');

test('fifteen minutes after the first call, one text, and never a second', { skip: skip() }, async () => {
  await caller('+4790000201');
  await call('+4790000201', now, 10 * MIN);
  assert.equal(await sendDueFeedback(deps(), now), 0, 'not before fifteen minutes');

  const soon = new Date(now.getTime() + 6 * MIN);
  assert.equal(await sendDueFeedback(deps(), soon), 1, 'sent at sixteen');
  assert.equal(sent.length, 1);
  const body = sent[0]?.body ?? '';
  assert.match(body, /^One call in, so two questions about me for a change: https:\/\/8and80\.me\/f\/[a-z2-9]{10}$/);
  assert.ok(!body.includes('4790000201'), 'the number is never in the link');

  // Again, and again after another call: nothing. Once, ever.
  assert.equal(await sendDueFeedback(deps(), new Date(soon.getTime() + MIN)), 0);
  await call('+4790000201', new Date(now.getTime() + 7 * 24 * 60 * MIN), 20 * MIN);
  assert.equal(await sendDueFeedback(deps(), new Date(now.getTime() + 7 * 24 * 60 * MIN)), 0);
  assert.equal(sent.length, 1);
});

test('the call number it follows is a setting', { skip: skip() }, async () => {
  process.env['FEEDBACK_AFTER_CALL'] = '4';
  await caller('+4790000202');
  for (let i = 3; i >= 1; i--) await call('+4790000202', now, i * 7 * 24 * 60 * MIN);
  assert.equal(await sendDueFeedback(deps(), now), 0, 'three calls is not four');
  await call('+4790000202', now, 20 * MIN);
  assert.equal(await sendDueFeedback(deps(), now), 1);
  assert.match(sent[0]?.body ?? '', /^Four calls in/);

  await sql`truncate table feedback`;
  sent = [];
  process.env['FEEDBACK_AFTER_CALL'] = '0';
  assert.equal(await sendDueFeedback(deps(), now), 0, '0 switches it off');
});

test('a short call or one that ended early waits for the next call', { skip: skip() }, async () => {
  await caller('+4790000203');
  await call('+4790000203', now, 20 * MIN, { minutes: 2 });
  assert.equal(await sendDueFeedback(deps(), now), 0);
  await sql`truncate table call_attempts`;
  await call('+4790000203', now, 20 * MIN, { note: 'moved during the call' });
  assert.equal(await sendDueFeedback(deps(), now), 0);
  assert.equal((await sql`select 1 from feedback`).length, 0, 'not written off, only deferred');

  await call('+4790000203', now, 16 * MIN);
  assert.equal(await sendDueFeedback(deps(), now), 1);
});

test('a flagged call skips them for good', { skip: skip() }, async () => {
  await caller('+4790000204');
  await call('+4790000204', now, 20 * MIN, { tier: 2 });
  assert.equal(await sendDueFeedback(deps(), now), 0);
  const rows = await sql`select state from feedback`;
  assert.equal(rows[0]?.['state'], 'skipped');

  const later = new Date(now.getTime() + 7 * 24 * 60 * MIN);
  await call('+4790000204', later, 20 * MIN);
  assert.equal(await sendDueFeedback(deps(), later), 0, 'not deferred to the next call');
  assert.equal(sent.length, 0);
});

test('never within half an hour of another text, and never to somebody who stopped', { skip: skip() }, async () => {
  await caller('+4790000205');
  await call('+4790000205', now, 20 * MIN);
  await sql`update call_attempts set sms_sent_at = ${new Date(now.getTime() - 10 * MIN).toISOString()}`;
  assert.equal(await sendDueFeedback(deps(), now), 0);
  assert.equal(await sendDueFeedback(deps(), new Date(now.getTime() + 25 * MIN)), 1, 'sent once the half hour is up');

  await caller('+4790000206');
  await call('+4790000206', now, 20 * MIN);
  await sched.setPaused('+4790000206', true);
  assert.equal(await sendDueFeedback(deps(), now), 0);
});

test('every version of the text is one segment of plain characters', () => {
  const link = 'https://8and80.me/f/abcdefghjk';
  for (const key of ['sms.feedback.1', 'sms.feedback.4', 'sms.feedback']) {
    const body = (script.get(key) ?? '').replace('{{count}}', '12').replace('{{link}}', link);
    assert.ok(body, `${key} is missing`);
    assert.ok(body.length <= 160, `${key} is ${body.length} characters`);
    // GSM-7 basic set, near enough: anything outside it makes the message UCS-2 and 70 a segment.
    assert.match(body, /^[A-Za-z0-9 .,:;'?()/@&\-+=_"%]*$/, `${key} has a character that is not GSM-7`);
    assert.ok(!/!/.test(body), 'no exclamation marks');
  }
});

async function serving(body: (base: string) => Promise<void>): Promise<void> {
  const server = controlPlane(deps(), 'whsec_x');
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const escaped = (key: string): string =>
  (script.get(key) ?? '\u0000').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

test('the form: two questions on equal footing, saved encrypted, shown again to edit', { skip: skip() }, async () => {
  const phone = '+4790000207';
  await caller(phone);
  await call(phone, new Date(), 20 * MIN);
  await sendDueFeedback(deps());
  const code = /\/f\/([a-z2-9]+)$/.exec(sent[0]?.body ?? '')?.[1] as string;

  // Whatever the log sees during all of this, none of it is what they wrote.
  const logged: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) => {
    logged.push(String(chunk));
    return write(chunk, ...rest);
  }) as typeof process.stdout.write;

  try {
    await serving(async (base) => {
      // A messaging app drawing a preview card is not somebody opening it.
      await (await fetch(`${base}/f/${code}`, { headers: { 'user-agent': 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' } })).text();
      assert.equal((await feedbackNumbers(sql)).opened, 0);

      const page = await (await fetch(`${base}/f/${code}`)).text();
      assert.equal((await feedbackNumbers(sql)).opened, 1);
      for (const key of ['feedback.pickup', 'feedback.nearly', 'feedback.else']) assert.ok(page.includes(escaped(key)), key);
      // Equal footing: the two questions are rendered by the same markup.
      const box = (name: string) => new RegExp(`<textarea id="${name}" name="${name}" rows="4"`).test(page);
      assert.ok(box('pickup') && box('nearly'), 'both questions get the same box');
      assert.ok(!/type="range"|type="radio"|\bNPS\b|1-10|\u2605/.test(page), 'no scales');

      const res = await fetch(`${base}/f/${code}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ pickup: 'it was my own voice asking', nearly: 'I was on the train', else: '' }),
      });
      assert.equal(res.status, 200);
      assert.ok((await res.text()).includes(escaped('feedback.thanks')));

      const [row] = await sql`select pickup_enc, nearly_enc, submitted_at from feedback`;
      assert.ok(row?.['submitted_at']);
      assert.ok(!String(row?.['pickup_enc']).includes('own voice'), 'encrypted before it reached the database');

      const again = await (await fetch(`${base}/f/${code}`)).text();
      assert.ok(again.includes('it was my own voice asking') && again.includes('I was on the train'), 'shown again, to edit');

      // A feedback code opens nothing else, and a reschedule code does not open this.
      assert.equal((await fetch(`${base}/r/${code}`)).status, 410);
      const other = await new Links(sql).mint(phoneKey(phone));
      assert.equal((await fetch(`${base}/f/${other}`)).status, 410);
    });
  } finally {
    process.stdout.write = write;
  }
  assert.ok(!logged.some((l) => l.includes('own voice') || l.includes('on the train')), 'an answer reached the log');

  const n = await feedbackNumbers(sql);
  assert.deepEqual(n, { sent: 1, opened: 1, submitted: 1, rate: 100 });

  // In the copy of everything, and gone with everything.
  const letter = await composeExport(store, phone, script);
  assert.ok(letter?.body.includes('it was my own voice asking'), 'the export carries the answers');
  await store.forget(phone);
  assert.equal((await sql`select 1 from feedback`).length, 0);
});

test('the link lasts a fortnight', { skip: skip() }, async () => {
  const links = new Links(sql);
  const code = await links.mint(phoneKey('+4790000208'), now, 'feedback');
  assert.ok((await links.open(code, new Date(now.getTime() + 13 * 24 * 60 * MIN), 'feedback')).ok);
  assert.equal((await links.open(code, new Date(now.getTime() + 15 * 24 * 60 * MIN), 'feedback')).ok, false);
});

test('every line the feedback flow says is in SCRIPT.md', () => {
  for (const key of [
    'feedback.title', 'feedback.detail', 'feedback.pickup', 'feedback.nearly', 'feedback.else',
    'feedback.speak', 'feedback.speak.stop', 'feedback.speak.note', 'feedback.submit',
    'feedback.thanks', 'feedback.expired', 'export.feedback',
  ]) {
    const line = script.get(key);
    assert.ok(line, `${key} is missing`);
    assert.ok(!line.includes('!'), `${key} has an exclamation mark`);
  }
});
