import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { tick, NOTHING_RECORDED } from '../src/loop/tick.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { settle, type Turn } from '../src/call/outcome.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { needsOnboarding } from '../src/store/types.ts';
import { buildInstructions } from '../src/prompt.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import type { PlaceCallRequest } from '../src/agent/speechify.ts';
import type { Recap } from '../src/recap/compose.ts';

const opened = await openTestDb('onboarding_journey');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const now = new Date('2026-09-08T06:00:00Z');
const phone = '+4792000001';
const slot = { weekday: 2, minute: 480, timezone: 'Europe/Oslo' };
const placed: PlaceCallRequest[] = [];
const emails: Recap[] = [];
const texts: string[] = [];
const scheduler = () => new Scheduler(db!.sql);
const deps = (): LoopDeps => ({
  store: db!.store, scheduler: scheduler(), script,
  agent: { placeCall: async (req: PlaceCallRequest) => { placed.push(req); return { conversationId: `journey_${placed.length}`, status: 'pending' }; }, conversation: async () => ({}) } as unknown as LoopDeps['agent'],
  mailer: { send: async (_to, recap) => { emails.push(recap); } },
  sms: { send: async (_to, body) => { texts.push(body); } },
});
const agent = (text: string): Turn => ({ speaker: 'agent', text });
const caller = (text: string): Turn => ({ speaker: 'caller', text });
const map = script.get('read.first.keep')!.replace('{{eight}}', 'football and friends').replace('{{eighty}}', 'time with family').replace('{{goals}}', 'learn to sail');
const confirmed = script.get('onboarding.confirmed')!;
const callback = script.get('reschedule.confirm')!.replace('{{time}}', '17:30 today');
const action = script.get('next.confirm')!.replace('{{commitment}}', 'book a sailing lesson');
const payload = (id: string, turns: Turn[], durationMs = 300_000) => ({ event: 'conversation.completed', conversation_id: id, duration_ms: durationMs, status: 'completed', messages: turns.map(t => ({ role: t.speaker === 'agent' ? 'assistant' : 'user', content: t.text })) });
const classify = (turns: Turn[], durationMs = 300_000) => settle({ providerCallId: 'unit', turns, durationMs }, script, now);

beforeEach(async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 4).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  if (db) await db.sql`truncate journey_events, journey_counts, message_attempts, message_outbox, callers, call_attempts, links`;
  placed.length = emails.length = texts.length = 0;
});
after(async () => { await db?.close(); });
async function enrol(): Promise<void> {
  await db!.store.upsertProfile(phone, { email: 'synthetic@example.com' });
  await scheduler().setSlot(phone, slot, new Date(+now - 86400_000));
}

test('a 25-second callback keeps first-call routing and sends only the dated booking', options, async () => {
  await enrol();
  await tick(deps(), now);
  const event = payload('journey_1', [agent('Is now a good moment?'), caller('Later today please.'), agent(callback)], 25_000);
  assert.equal((await settleConversation(event, deps(), undefined, now)).status, 'rescheduled');
  const record = await db!.store.load(phone);
  assert.equal(record.callNumber, 1);
  assert.equal(record.onboarding, 'pending');
  assert.equal(emails.length, 0);
  assert.equal(texts.length, 1);
  assert.match(texts[0]!, /8 September.*17:30.*CEST/);
  assert.equal((await scheduler().nextEligibleCallFor(phone, now))?.toISOString(), '2026-09-08T15:30:00.000Z');
  assert.equal((await settleConversation(event, deps(), undefined, now)).handled, false);
  assert.equal(texts.length, 1, 'duplicate provider callbacks cannot send another booking');
  await tick(deps(), new Date('2026-09-08T15:30:00Z'));
  assert.equal(placed[1]?.firstCall, true);
  const cycles = await db!.sql`select cycle_key from call_attempts order by scheduled_for`;
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0]?.['cycle_key'], cycles[1]?.['cycle_key'], 'the callback continues the original cycle');
});

test('an unfinished map is retained; a confirmed map without an action completes the introduction', options, async () => {
  await enrol();
  await tick(deps(), now);
  await settleConversation(payload('journey_1', [caller('I want to learn to sail.'), agent(map)]), deps(), undefined, now);
  const partial = await db!.store.load(phone);
  assert.equal(partial.onboarding, 'in_progress');
  assert.equal(partial.onboardingCompletedAt, undefined);
  assert.equal(partial.goals, 'learn to sail');
  await tick(deps(), new Date('2026-09-15T06:00:00Z'));
  assert.equal(placed[1]?.firstCall, true, 'the call counter is not onboarding completion');
  assert.equal(placed[1]?.variables?.['onboarding_progress'], 'in_progress');
  assert.equal(placed[1]?.variables?.['own_goals'], 'learn to sail');
  const finishedAt = new Date('2026-09-15T06:10:00Z');
  await settleConversation(payload('journey_2', [agent(map), caller('Yes, that is right.'), agent(confirmed), caller('No action this week.')]), deps(), undefined, finishedAt);
  const complete = await db!.store.load(phone);
  assert.equal(complete.onboarding, 'complete');
  assert.equal(complete.onboardingCompletedAt, finishedAt.toISOString());
  assert.equal(complete.lastCommitment, undefined);
  await tick(deps(), new Date('2026-09-22T06:00:00Z'));
  assert.equal(placed[2]?.firstCall, false);
  await settleConversation(payload('journey_3', [agent('How has the week been?'), caller('It helped to have space to reflect. No action this week.')]), deps(), undefined, new Date('2026-09-22T06:10:00Z'));
  const conversations = await db!.sql`select cycle_key from journey_events where event = 'conversation_completed'`;
  assert.equal(conversations.length, 2, 'completed no-action conversations count');
  assert.equal(new Set(conversations.map(row => row['cycle_key'])).size, 2);
  assert.equal((await db!.sql`select * from journey_events where event = 'action_read_back'`).length, 0);
});

test('completion needs both the map and a later confirmation marker after the caller speaks', () => {
  for (const turns of [[agent(confirmed), caller('yes')], [agent(map), agent(confirmed), caller('yes')], [agent(map), caller('yes')]]) {
    assert.equal(classify(turns).outcome?.onboardingComplete, undefined);
  }
  assert.equal(classify([agent(map), caller('yes'), agent(confirmed)]).outcome?.onboardingComplete, true);
  assert.equal(classify([agent('Hello'), caller('One moment')], 25_000).status, 'interrupted');
  assert.equal(classify([agent('Hello')], 25_000).status, 'silent');
  assert.equal(classify([agent('Hello')]).status, 'unverified');
  assert.equal(classify([agent('Hello'), caller('  ')]).status, 'unverified');
  assert.equal(classify([]).status, 'failed');
});

test('a substantive call with a callback recaps the callback, not the standing weekly slot', options, async () => {
  await enrol();
  await tick(deps(), now);
  await settleConversation(payload('journey_1', [caller('I will book a lesson.'), agent(action), agent(callback)]), deps(), undefined, now);
  assert.equal(emails.length, 1);
  assert.match(emails[0]!.body, /8 September.*17:30.*CEST/);
  assert.doesNotMatch(emails[0]!.body, /15 September/);
  assert.match(texts[0]!, /17:30/);
});

test('a callback rejected by a pause or trial end never promises the requested time', options, async () => {
  await enrol();
  await tick(deps(), now);
  await scheduler().setPaused(phone, true);
  await settleConversation(payload('journey_1', [caller('later'), agent(callback)], 25_000), deps(), undefined, now);
  assert.equal(emails.length, 0);
  assert.equal(texts.length, 0, 'a pause suppresses call-related follow-ups');
  assert.equal((await db!.sql`select reason from message_outbox where channel = 'sms'`)[0]?.['reason'], 'calls_paused');
  assert.equal(await scheduler().nextEligibleCallFor(phone, now), undefined);
});

test('voice variables distinguish the next actual date from the weekly arrangement and respect trial expiry', options, async () => {
  await enrol();
  await tick(deps(), now);
  assert.match(placed[0]?.variables?.['next_appointment'] ?? '', /15 September/);
  assert.equal(placed[0]?.variables?.['booked_slot'], 'Tuesday at 08:00');
  await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = '2026-09-16T00:00:00Z'`;
  await tick(deps(), new Date('2026-09-15T06:00:00Z'));
  assert.equal(placed[1]?.variables?.['next_appointment'], NOTHING_RECORDED);
});

test('legacy callers keep established routing without invented completion timestamps', options, async () => {
  await enrol();
  await db!.sql`update callers set onboarding = 'legacy', call_number = 4`;
  assert.equal(needsOnboarding(await db!.store.load(phone)), false);
  await db!.store.record(phone, { at: now.toISOString(), durationMs: 300_000 });
  const record = await db!.store.load(phone);
  assert.equal(record.onboarding, 'legacy');
  assert.equal(record.onboardingCompletedAt, undefined);
});

test('the continuation prompt carries saved context and avoids an unconditional next-week farewell', () => {
  const prompt = buildInstructions(script, { callNumber: 2, onboardingProgress: 'in_progress', goals: 'learn to sail', nextSlot: 'Tuesday 15 September at 08:00 Europe/Oslo' });
  assert.match(prompt, /unfinished introduction/);
  assert.match(prompt, /goals=learn to sail/);
  assert.match(prompt, /Tuesday 15 September at 08:00 Europe\/Oslo/);
  assert.doesNotMatch(prompt, /Good\. Talk next week\./);
  assert.match(prompt, /may decline an action/);
});


test('the upgrade preserves established callers without declaring past onboarding complete', options, async () => {
  await enrol();
  await db!.store.upsertProfile('+4792000002', { email: 'legacy@example.com' });
  await db!.sql`update callers set call_number = 4`;
  await db!.sql`update callers set call_number = 1 where phone_hash = ${phoneKey(phone)}`;
  // Recreate the pre-0014 shape inside this test's isolated schema, then run the real migration.
  await db!.sql`alter table callers drop column onboarding, drop column onboarding_completed_at`;
  const migration = readFileSync(new URL('../drizzle/0014_onboarding_progress.sql', import.meta.url), 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) await db!.sql.unsafe(statement);
  const rows = await db!.sql`select call_number, onboarding, onboarding_completed_at from callers order by call_number`;
  assert.equal(rows[0]?.['onboarding'], 'pending');
  assert.equal(rows[1]?.['onboarding'], 'legacy');
  assert.equal(rows[1]?.['onboarding_completed_at'], null);
});


test('an expired callback does not make the next weekly call a continuation', options, async () => {
  await enrol();
  await tick(deps(), now);
  await settleConversation(payload('journey_1', [agent('Hello'), caller('Later, please'), agent(callback)], 25_000), deps(), undefined, now);
  await tick(deps(), new Date('2026-09-15T06:00:00Z'));
  const attempts = await db!.sql`select id, cycle_key from call_attempts where status = 'placed' order by scheduled_for`;
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.['cycle_key'], attempts[0]?.['id'], 'the weekly call starts its own cycle');
});
