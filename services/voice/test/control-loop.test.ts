import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import type { Slot } from '../src/schedule/time.ts';
import { tick } from '../src/loop/tick.ts';
import { sweep } from '../src/loop/sweep.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { controlPlane } from '../src/control.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import type { PlaceCallRequest, PlacedCall } from '../src/agent/speechify.ts';
import type { Recap } from '../src/recap/compose.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
const SECRET = 'whsec_loop';
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };
const NOW = new Date('2026-09-08T06:00:00Z');
const script = loadScript();

const opened = await openTestDb('control_loop');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;
const sched = sql ? new Scheduler(sql) : undefined;

/** Stands in for the platform, and remembers what it was asked to do. */
class FakeAgent {
  readonly placed: PlaceCallRequest[] = [];
  refuse = false;
  n = 0;
  async placeCall(req: PlaceCallRequest): Promise<PlacedCall> {
    if (this.refuse) throw new Error('platform said no');
    this.placed.push(req);
    return { conversationId: `conv_${++this.n}`, status: 'pending' };
  }
  async conversation(): Promise<unknown> {
    return {};
  }
  reset(): void {
    this.placed.length = 0;
    this.refuse = false;
    // Counting from one again per test, so conv_1 means this test's call and
    // not the fifth one the file happened to place.
    this.n = 0;
  }
}

const agent = new FakeAgent();
const mail: { to: string; recap: Recap }[] = [];
const texts: { to: string; body: string }[] = [];

const deps = (): LoopDeps => ({
  store: store as NonNullable<typeof store>,
  scheduler: sched as Scheduler,
  agent: agent as unknown as LoopDeps['agent'],
  mailer: { send: async (to, recap) => void mail.push({ to, recap }) },
  sms: { send: async (to, body) => void texts.push({ to, body }) },
  script,
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table callers, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  process.env['LINK_SECRET'] = 'link_secret';
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  agent.reset();
  mail.length = 0;
  texts.length = 0;
});

async function enrol(phone: string, extra: { email?: string; name?: string } = {}): Promise<void> {
  await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'Eirik', ...extra });
  await (sched as Scheduler).setSlot(phone, OSLO, new Date('2026-09-07T10:00:00Z'));
}

const completed = (conversationId: string, turns: { role: string; content: string }[], durationMs = 700_000) => ({
  event: 'conversation.completed',
  conversation_id: conversationId,
  duration_ms: durationMs,
  status: 'completed',
  messages: turns,
});

const readBack = (script.get('next.confirm') ?? '')
  .replace('{{commitment}}', 'run three times')
  .replace('{{day}}', 'Wednesday');

test('a tick rings whoever is due, carrying last week in their own words', { skip: skip() }, async () => {
  await enrol('+4790000040');
  await (store as NonNullable<typeof store>).record('+4790000040', {
    at: NOW.toISOString(),
    durationMs: 1,
    commitment: 'run three times',
    day: 'wednesday',
  });

  const result = await tick(deps(), NOW);
  assert.deepEqual(result, { claimed: 1, placed: 1, failed: 0 });
  assert.equal(agent.placed[0]?.to, '+4790000040');
  assert.equal(agent.placed[0]?.variables?.['commitment'], 'run three times');
  assert.equal(agent.placed[0]?.variables?.['day'], 'wednesday');
  // AMD is on by default: a fifteen-minute call must never reach a machine.
  assert.equal(agent.placed[0]?.amd, true);
});

test('a tick with nobody due does nothing at all', { skip: skip() }, async () => {
  await enrol('+4790000041');
  assert.deepEqual(await tick(deps(), new Date('2026-09-08T05:00:00Z')), { claimed: 0, placed: 0, failed: 0 });
  assert.equal(agent.placed.length, 0);
});

test('one caller failing does not cost the others their week', { skip: skip() }, async () => {
  await enrol('+4790000042');
  await enrol('+4790000043');
  // No number on file for the second: the claim exists, the caller does not.
  await (sql as NonNullable<typeof sql>)`update callers set phone_enc = 'broken' where phone_hash = (select phone_hash from callers offset 1 limit 1)`;

  const result = await tick(deps(), NOW);
  assert.equal(result.claimed, 2);
  assert.equal(result.placed + result.failed, 2);
  assert.equal(result.placed, 1, 'the other one still got their call');
});

test('a platform refusal is a failed attempt and no text', { skip: skip() }, async () => {
  await enrol('+4790000044');
  agent.refuse = true;
  const result = await tick(deps(), NOW);
  assert.deepEqual(result, { claimed: 1, placed: 0, failed: 1 });
  // Nobody was rung, so there is nothing for them to have missed.
  assert.equal(texts.length, 0);
});

test('a finished call is stored and the recap goes out', { skip: skip() }, async () => {
  await enrol('+4790000045', { email: 'eirik@example.com' });
  await tick(deps(), NOW);

  const out = await settleConversation(
    completed('conv_1', [
      { role: 'user', content: 'I got out on the Monday.' },
      { role: 'assistant', content: readBack },
    ]),
    deps(),
  );
  assert.equal(out.status, 'completed');

  const caller = await (store as NonNullable<typeof store>).load('+4790000045');
  assert.equal(caller.lastCommitment, 'run three times');
  assert.equal(mail.length, 1);
  assert.ok(mail[0]?.recap.body.includes('run three times'));
});

test('a retried webhook does not settle twice', { skip: skip() }, async () => {
  await enrol('+4790000046', { email: 'eirik@example.com' });
  await tick(deps(), NOW);
  const payload = completed('conv_1', [
    { role: 'user', content: 'yes' },
    { role: 'assistant', content: readBack },
  ]);

  const first = await settleConversation(payload, deps());
  const second = await settleConversation(payload, deps());
  assert.equal(first.handled, true);
  assert.equal(second.handled, false, 'the second delivery must do nothing');
  // Two recaps, or a call number advanced twice, is what this prevents.
  assert.equal(mail.length, 1);
  assert.equal((await (store as NonNullable<typeof store>).load('+4790000046')).callNumber, 2);
});

test('a call nobody could hear stores nothing and writes to nobody', { skip: skip() }, async () => {
  await enrol('+4790000047', { email: 'eirik@example.com' });
  await tick(deps(), NOW);

  const out = await settleConversation(
    completed('conv_1', [{ role: 'assistant', content: 'Hello again.' }], 15_000),
    deps(),
  );
  assert.equal(out.status, 'silent');
  assert.equal(mail.length, 0, 'writing about a conversation they did not have is worse than saying nothing');
  assert.equal((await (store as NonNullable<typeof store>).load('+4790000047')).lastCommitment, undefined);
});

test('a call that rang out produces the one text', { skip: skip() }, async () => {
  await enrol('+4790000048');
  await tick(deps(), NOW);

  await settleConversation(
    { event: 'conversation.failed', conversation_id: 'conv_1', duration_ms: 30_000, end_reason: 'no_answer', messages: [] },
    deps(),
  );
  assert.equal(texts.length, 1);
  assert.ok(texts[0]?.body.includes('https://8and80.example/r/'), texts[0]?.body);
  // The link carries a hash, never the number it was sent to.
  assert.ok(!texts[0]?.body.includes('4790000048'));
});

test('a conversation we did not place is acknowledged and ignored', { skip: skip() }, async () => {
  const out = await settleConversation(completed('conv_from_the_console', [{ role: 'assistant', content: 'hi' }]), deps());
  assert.equal(out.handled, false);
});

test('a call that never came back is closed by the sweep, not retried', { skip: skip() }, async () => {
  await enrol('+4790000049');
  await tick(deps(), NOW);
  await (sql as NonNullable<typeof sql>)`update call_attempts set claimed_at = now() - interval '2 hours'`;

  assert.equal(await sweep(deps()), 1);
  const rows = await (sql as NonNullable<typeof sql>)`select status from call_attempts`;
  assert.equal(rows[0]?.['status'], 'failed');
  // Ringing somebody two hours late is not the weekly call.
  assert.equal(agent.placed.length, 1);
});

test('the webhook endpoint refuses anything it cannot prove', { skip: skip() }, async () => {
  const server = controlPlane(deps(), SECRET);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/webhooks/speechify`;
  const body = JSON.stringify(completed('conv_unknown', [{ role: 'assistant', content: 'hi' }]));

  const unsigned = await fetch(url, { method: 'POST', body });
  assert.equal(unsigned.status, 401);

  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const signed = await fetch(url, {
    method: 'POST',
    headers: { 'speechify-signature': `t=${t},v0=${v0}` },
    body,
  });
  assert.equal(signed.status, 200);

  // A payload it cannot read must 500 so it is retried and noticed, never 200.
  const junk = JSON.stringify({ event: 'conversation.completed', conversation_id: 'x' });
  const t2 = Math.floor(Date.now() / 1000);
  const v2 = createHmac('sha256', SECRET).update(`${t2}.${junk}`).digest('hex');
  const broken = await fetch(url, {
    method: 'POST',
    headers: { 'speechify-signature': `t=${t2},v0=${v2}` },
    body: junk,
  });
  assert.equal(broken.status, 500);

  await new Promise<void>((r) => server.close(() => r()));
});
