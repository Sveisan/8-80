import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { SpeechifyAgent } from '../src/agent/speechify.ts';
import { tick, NOTHING_RECORDED } from '../src/loop/tick.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { controlPlane } from '../src/control.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { readMemory, correctMemory } from '../src/memory/context.ts';
import { enqueue, dispatchMessage } from '../src/messages/outbox.ts';
import { buildInstructions } from '../src/prompt.ts';
import { weeklyPrompt } from '../src/agent/prompt-pack.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const opened = await openTestDb('weekly_memory_journey');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const now = new Date('2026-10-06T06:00:00Z');
const nextWeek = new Date('2026-10-13T06:00:00Z');
const phoneA = '+4798200001';
const phoneB = '+4798200002';
const secret = 'synthetic-webhook-secret';
const nativeFetch = globalThis.fetch;
const wire: Array<Record<string, unknown>> = [];
const messages: unknown[] = [];
let providerReply: (() => Response) | undefined;
const fill = (key: string, values: Record<string, string> = {}) => script.get(key)!.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key] ?? key);
const event = (id: string, lines: Array<['user' | 'assistant', string]>) => ({ event: 'conversation.completed', conversation_id: id, duration_ms: 600_000, status: 'completed', messages: lines.map(([role, content]) => ({ role, content })) });
const deps = (): LoopDeps => ({
  store: db!.store, scheduler: new Scheduler(db!.sql), script,
  agent: new SpeechifyAgent('synthetic-key', 'return-agent', 'first-agent', 'https://speechify.invalid', { variables: true, amd: false, language: false, ringingTimeout: false }),
  sms: { send: async (_to, body) => { messages.push(body); } },
  mailer: { send: async (_to, body) => { messages.push(body); } },
});
async function enrol(phone = phoneA) {
  await db!.store.upsertProfile(phone, { name: phone === phoneA ? 'Alpha Person' : 'Beta Person', email: `${phone === phoneA ? 'alpha' : 'beta'}@example.com` });
  await new Scheduler(db!.sql).setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' }, new Date(+now - 86400_000));
}
beforeEach(async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 12).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['BELIEFS_ENABLED'] = '0';
  if (db) await db.sql`truncate belief_sessions, belief_refund_requests, belief_enrollments, journey_events, journey_counts, message_attempts, message_outbox, callers, call_attempts, links, webhook_deliveries`;
  wire.length = messages.length = 0;
  providerReply = undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://speechify.invalid/v1/agents/outbound-calls') {
      wire.push(JSON.parse(String(init?.body)));
      return providerReply?.() ?? Response.json({ conversation_id: `wire_${wire.length}`, status: 'pending' });
    }
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    throw new Error('unexpected external request in local verification');
  };
});
after(async () => { globalThis.fetch = nativeFetch; await db?.close(); });

test('signed webhook → encrypted memory → next outbound request and prompt, isolated for two callers', options, async t => {
  await enrol(); await enrol(phoneB);
  const d = deps();
  await tick(d, now);
  assert.equal(wire.length, 2);
  assert.ok(wire.every(body => body['agent_id'] === 'first-agent'));
  const idFor = (phone: string) => `wire_${wire.findIndex(body => body['to'] === phone) + 1}`;
  const server = controlPlane(d, secret);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/speechify`;
  async function post(payload: unknown, signed = true) {
    const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return fetch(url, { method: 'POST', body, headers: signed ? { 'speechify-signature': `t=${timestamp},v0=${signature}` } : {} });
  }
  const alpha = event(idFor(phoneA), [
    ['assistant', fill('read.first.keep', { eight: 'alpha games', eighty: 'alpha family', goals: 'alpha garden' })],
    ['user', 'No, change eight.'], ['assistant', fill('read.first.fix_eight', { eight: 'alpha drawing' })],
    ['user', 'Yes, exactly.'], ['assistant', fill('onboarding.confirmed')],
    ['user', 'Plant alpha seeds.'], ['assistant', fill('next.confirm', { commitment: 'plant alpha seeds' })], ['assistant', 'Right. Goodbye.'],
  ]);
  assert.equal((await post(alpha, false)).status, 401);
  assert.equal((await db!.store.load(phoneA)).callNumber, 1);
  assert.equal((await post(alpha)).status, 200);
  assert.equal((await post(alpha)).status, 200);
  assert.equal(messages.length, 1, 'duplicate webhook cannot produce a second recap');
  await post(event(idFor(phoneB), [
    ['assistant', fill('read.first.keep', { eight: 'beta books', eighty: 'beta family', goals: 'beta lessons' })],
    ['user', 'Yes.'], ['assistant', fill('onboarding.confirmed')], ['user', 'Book beta lessons.'], ['assistant', fill('next.confirm', { commitment: 'book beta lessons' })],
  ]));
  assert.equal((await db!.store.load(phoneA)).callNumber, 2);
  const sealed = await db!.sql`select last_commitment_enc, eight_enc, goals_enc from callers`;
  assert.doesNotMatch(JSON.stringify(sealed), /alpha|beta/);
  await tick(d, nextWeek);
  assert.equal(wire.length, 4);
  for (const [phone, prefix, eight] of [[phoneA, 'alpha', 'alpha drawing'], [phoneB, 'beta', 'beta books']] as const) {
    const body = wire.slice(2).find(body => body['to'] === phone)!;
    assert.equal(body['agent_id'], 'return-agent');
    const vars = body['dynamic_variables'] as Record<string, string>;
    assert.equal(vars['own_eight'], eight);
    assert.equal(vars['own_goals'], prefix === 'alpha' ? 'alpha garden' : 'beta lessons');
    assert.doesNotMatch(JSON.stringify(vars), prefix === 'alpha' ? /beta/ : /alpha/);
    const prompt = buildInstructions(script, { callNumber: Number(vars['call_number']), onboardingProgress: vars['onboarding_progress'], lastCommitment: vars['last_commitment'], eight: vars['own_eight'], eighty: vars['own_eighty'], goals: vars['own_goals'] });
    assert.ok(prompt.includes(vars['last_commitment']!));
    assert.ok(prompt.includes(eight));
    assert.match(prompt, /THIS IS NOT THE FIRST CALL/);
    const rendered = weeklyPrompt(false).replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key] ?? '');
    assert.ok(rendered.includes(`Last week you said you'd ${vars['last_commitment']}. What happened?`));
    assert.ok(rendered.includes(eight));
    assert.doesNotMatch(rendered, /\{\{/);
  }
});

test('no-action clears the old action; incomplete extraction preserves it; a new action clears an old day', options, async () => {
  await enrol();
  await db!.store.record(phoneA, { at: now.toISOString(), durationMs: 100_000, commitment: 'old action', day: 'Monday', onboardingComplete: true });
  await db!.store.record(phoneA, { at: now.toISOString(), durationMs: 100_000 });
  assert.equal((await db!.store.load(phoneA)).lastCommitment, 'old action');
  await tick(deps(), now);
  await settleConversation(event('wire_1', [['user', 'No action this week.'], ['assistant', fill('next.none')]]), deps(), undefined, now);
  assert.equal((await db!.store.load(phoneA)).lastCommitment, undefined);
  assert.equal((await db!.store.load(phoneA)).lastCommitmentDay, undefined);
  await tick(deps(), nextWeek);
  const vars = wire[1]!['dynamic_variables'] as Record<string, string>;
  assert.equal(vars['last_commitment'], NOTHING_RECORDED);
  await db!.store.record(phoneA, { at: nextWeek.toISOString(), durationMs: 100_000, commitment: 'new action' });
  assert.equal((await db!.store.load(phoneA)).lastCommitmentDay, undefined);
});

test('an authenticated correction wins over a delayed call and suppresses its stale recap', options, async () => {
  await enrol(); await tick(deps(), now);
  const hash = phoneKey(phoneA), before = await readMemory(db!.sql, hash);
  assert.ok(before);
  assert.equal(await correctMemory(db!.sql, hash, before.revision, 'corrected action', 'corrected goals'), 'saved');
  await settleConversation(event('wire_1', [['user', 'Old action.'], ['assistant', fill('next.confirm', { commitment: 'old action' })]]), deps(), undefined, now);
  const after = await db!.store.load(phoneA);
  assert.equal(after.lastCommitment, 'corrected action');
  assert.equal(after.goals, 'corrected goals');
  assert.equal(messages.length, 0);
  assert.equal((await db!.sql`select reason from message_outbox`)[0]?.['reason'], 'memory_corrected');
  await tick(deps(), nextWeek);
  const vars = wire[1]!['dynamic_variables'] as Record<string, string>;
  assert.equal(vars['last_commitment'], 'corrected action');
  await settleConversation(event('wire_2', [['user', 'New chosen action.'], ['assistant', fill('next.confirm', { commitment: 'new chosen action' })]]), deps(), undefined, nextWeek);
  assert.equal((await db!.store.load(phoneA)).lastCommitment, 'new chosen action', 'later calls may update corrected memory');
  assert.equal(messages.length, 1);
});

test('STOP, pause, safety, billing end and moved schedule between claim and placement prevent dispatch without a missed-call notice', options, async () => {
  for (const field of ['all_calls_stopped', 'paused', 'held_for_review', 'billing_status', 'next_call_at']) {
    await enrol();
    const d = deps(), claim = d.scheduler.claimDue.bind(d.scheduler);
    d.scheduler.claimDue = async at => {
      const claims = await claim(at);
      if (field === 'billing_status') await db!.sql`update callers set billing_status = 'ended'`;
      else if (field === 'next_call_at') await db!.sql`update callers set next_call_at = next_call_at + interval '1 day'`;
      else await db!.sql`update callers set ${db!.sql(field)} = true`;
      return claims;
    };
    assert.deepEqual(await tick(d, now), { claimed: 1, placed: 0, failed: 1 }, field);
    assert.equal(wire.length, 0);
    assert.equal(messages.length, 0);
    assert.equal((await db!.sql`select note from call_attempts`)[0]?.['note'], 'suppressed before placement');
    await db!.sql`delete from callers`;
    await db!.sql`delete from call_attempts`;
  }
});

test('a STOP committed during carrier backoff prevents the retry', options, async () => {
  await enrol();
  let stopped: Promise<unknown> | undefined;
  providerReply = () => {
    stopped = db!.sql`update callers set all_calls_stopped = true`;
    // Start the preference write without waiting inside the placement lock.
    void stopped.then(() => undefined);
    return Response.json({ error: { message: 'carrier congestion' } }, { status: 503 });
  };
  assert.equal((await tick(deps(), now)).placed, 0);
  await stopped;
  assert.equal(wire.length, 1);
  assert.equal(messages.length, 0);
});

test('a local transaction failure after acceptance never places the same call again', options, async () => {
  await enrol();
  await db!.store.setRehearseFirstCall(phoneA, true);
  const d = deps(), original = d.store.in.bind(d.store);
  d.store.in = tx => {
    const scoped = original(tx);
    scoped.clearRehearseFirstCall = async () => { throw new Error('synthetic local failure after provider acceptance'); };
    return scoped;
  };
  try {
    assert.deepEqual(await tick(d, now), { claimed: 1, placed: 1, failed: 0 });
    assert.equal(wire.length, 1);
    assert.equal(messages.length, 0);
    assert.equal((await db!.sql`select provider_call_id from call_attempts`)[0]?.['provider_call_id'], 'wire_1');
  } finally { d.store.in = original; }
});

test('safety holds suppress both a pending recap and call SMS', options, async () => {
  await enrol(); await tick(deps(), now);
  const [attempt] = await db!.sql`select id from call_attempts`;
  await db!.sql`update call_attempts set safety_tier = 2`;
  for (const kind of ['recap', 'call'] as const) {
    const id = await enqueue(db!.sql, { eventKey: `safety:${kind}`, phoneHash: phoneKey(phoneA), channel: kind === 'recap' ? 'email' : 'sms', kind, reference: attempt!['id'], to: kind === 'recap' ? 'alpha@example.com' : phoneA, body: kind === 'recap' ? { subject: 'Synthetic', body: 'Private', parts: [] } : 'Private' }, now);
    assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  }
  assert.equal(messages.length, 0);
});
