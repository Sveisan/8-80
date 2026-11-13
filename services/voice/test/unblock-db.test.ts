import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { encrypt, decrypt } from '../src/store/crypto.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { composeExport } from '../src/legal/export.ts';
import { sweep } from '../src/loop/sweep.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { controlPlane } from '../src/control.ts';
import { dispatchMessage } from '../src/messages/outbox.ts';
import { UnblockRepository } from '../src/unblock/repository.ts';
import { claimUnblock, closeUnblockSession, settleUnblock, tickUnblock, unblockTool } from '../src/unblock/runtime.ts';
import { chapterComplete, emptyProgramme, finishCall, type Programme } from '../src/unblock/model.ts';
import { sessionToken as beliefToken } from '../src/beliefs/protocol.ts';
import { sessionToken } from '../src/unblock/protocol.ts';

const opened = await openTestDb('unblock'); const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
// A Tuesday, 11:00 in Oslo. Weekly slot Tuesday 18:00 Oslo; light evenings Mon/Wed/Fri 19:00 Oslo.
const now = new Date('2026-11-10T10:00:00Z'); const phone = '+4791000030'; const hash = phoneKey(phone);
const deps = (): LoopDeps => ({ store: db!.store, scheduler: new Scheduler(db!.sql), script: loadScript(), agent: { placeCall: async () => { throw Error('should not call base agent'); } } as unknown as LoopDeps['agent'], sms: { send: async () => undefined }, mailer: { send: async () => undefined } });
const repo = () => new UnblockRepository(db!.sql);
const token = (id: string) => sessionToken(id, 'u'.repeat(40));
const day = (n: number, base = now) => new Date(+base + n * 86400_000);
const payload = (id: string, said: string | string[]) => ({ type: 'conversation.completed', data: { conversation_id: id, duration_ms: 60000, messages: (typeof said === 'string' ? [said] : said).map(content => ({ role: 'user', content })) } });
let events = 0;

async function enroll(options: { opened?: boolean; programme?: Programme; due?: 'opening' | 'weekly' | 'light' | null } = {}) {
  await db!.store.upsertProfile(phone, { name: 'Synthetic tester', email: 'synthetic@example.com' });
  await repo().enroll(hash, now);
  const programme = options.programme ?? (options.opened ? finishCall(emptyProgramme(), 'opening', 0) : emptyProgramme());
  const due = options.due === undefined ? 'weekly' : options.due;
  await db!.sql`update unblock_enrollments set programme_enc=${encrypt(JSON.stringify(programme))}, revision=${programme.revision}, standing='active',
    timezone='Europe/Oslo', weekly_weekday=2, weekly_minute=1080, light_weekdays='{1,3,5}', light_minute=1140,
    next_weekly_at=${due === 'weekly' || due === 'opening' ? now : null}, next_light_at=${due === 'light' ? now : null} where phone_hash=${hash}`;
}
const programme = async () => (await repo().load(hash))!;
async function place(id: string, conversation: string) { await db!.sql`update call_attempts set status='placed',provider_call_id=${conversation} where id=${id}`; }
const say = (id: string, said: string, fields: Record<string, unknown>, at = now) =>
  unblockTool(deps(), { session_id: id, session_token: token(id), event_id: 'ev-' + (++events), caller_text: said, confirmed: true, ...fields }, at);
/** Runs one complete call: claim, place, capture, signed completion. */
async function call(at: Date, saves: [string, Record<string, unknown>][], extraTurns: string[] = []) {
  const [s] = await claimUnblock(deps(), at); assert.ok(s, 'a call should be claimed');
  await place(s.id, 'conv-' + s.id);
  const turns: string[] = [];
  for (const [said, fields] of saves) { turns.push(...said.split('|')); await say(s.id, said.split('|').join(' '), fields, at); }
  const result = await settleUnblock(payload('conv-' + s.id, [...turns, ...extraTurns]), deps(), undefined, at);
  return { s, result };
}
beforeEach(async () => {
  if (db) await db.sql`truncate unblock_sessions,unblock_enrollments,belief_refund_requests,belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries,heartbeats`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 14).toString('base64');
  Object.assign(process.env, { UNBLOCK_TOOL_SECRET: 'u'.repeat(40), PUBLIC_URL: 'https://8and80.example', OPERATOR_PHONE: '+4791000000', UNBLOCK_COVERAGE_START: '00:00', UNBLOCK_COVERAGE_END: '24:00', UNBLOCK_ENABLED: 'false', UNBLOCK_LIVE_CALLS: 'false' });
  delete process.env['OPERATOR_PHONE_BACKUP'];
});
after(async () => db?.close());

test('standalone enrollment leaves the base slot, memories, trial and call count untouched', options, async () => {
  await enroll({ due: null }); const before = await db!.store.load(phone);
  assert.equal((await programme()).programme.state, 'active'); assert.equal((await programme()).enrollment.standing, 'active');
  assert.deepEqual(await db!.store.load(phone), before); assert.equal(await new Scheduler(db!.sql).slotFor(phone), undefined);
  const [fresh] = await db!.sql`select standing from unblock_enrollments`; assert.equal(fresh!['standing'], 'active');
  await db!.sql`delete from unblock_enrollments`; await repo().enroll(hash, now);
  assert.equal((await programme()).enrollment.standing, 'awaiting_payment', 'entitlement is set only by the (separate) purchase flow');
  assert.equal((await claimUnblock(deps(), now)).length, 0);
});
test('opening call: claim, staged captures and a signed completion open the arc, schedule week 1 and light evenings, and send one neutral text', options, async () => {
  await enroll({ due: 'opening' }); const before = await db!.store.load(phone);
  const wish = 'I want to learn to sail because I loved boats at eight. Yes, that is right.';
  const { s, result } = await call(now, [
    [wish, { command: 'wish', text: 'learn to sail', why_text: 'I loved boats at eight' }],
    ['I will phone the sailing club on Thursday. Yes.', { command: 'step', text: 'phone the sailing club on Thursday' }],
  ]);
  assert.equal(s.kind, 'opening'); assert.equal(s.week, 0); assert.equal(result!.status, 'completed');
  const saved = await programme();
  assert.equal(saved.programme.openingHeld, true); assert.equal(saved.programme.wishes[0]!.text, 'learn to sail'); assert.equal(saved.programme.steps[0]!.week, 1);
  assert.ok(saved.enrollment.next_weekly_at! >= day(5)); assert.equal(saved.enrollment.next_weekly_at!.toISOString().slice(11, 16), '17:00');
  assert.ok(saved.enrollment.next_light_at! > now); assert.equal(saved.enrollment.opening_at, null);
  const [message] = await db!.sql`select kind,payload_enc from message_outbox`; const body = decrypt(message!['payload_enc']);
  assert.equal(message!['kind'], 'unblock'); assert.ok(body.includes('/unblock/access') && body.includes('next call is'));
  for (const secret of ['sail', 'sailing', 'boats', 'Thursday']) assert.ok(!body.includes(secret), secret);
  assert.deepEqual(await db!.store.load(phone), before, 'the weekly profile, counter and memories are untouched');
  const [closed] = await db!.sql`select snapshot_enc from unblock_sessions where id=${s.id}`; const retained = decrypt(closed!['snapshot_enc']);
  assert.ok(!retained.includes('sail')); assert.equal(JSON.parse(retained).canonicalVerified, true); assert.deepEqual(JSON.parse(retained).captureKinds, ['wish', 'step']);
  assert.equal((await settleUnblock(payload('conv-' + s.id, wish), deps(), undefined, now))!.handled, false, 'a repeated callback changes nothing');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox`)[0]!['n'], 1);
});
test('the plain utterance check needs no command; the staged programme is provisional until the signed transcript', options, async () => {
  await enroll({ due: 'opening' }); const [s] = await claimUnblock(deps(), now); await place(s!.id, 'conv-prov');
  assert.deepEqual(await unblockTool(deps(), { session_id: s!.id, session_token: token(s!.id), caller_text: 'Hello there' }, now), { held: false });
  const staged = await say(s!.id, 'I want to learn to sail. Yes.', { command: 'wish', text: 'learn to sail' });
  assert.equal(staged['provisional'], true); assert.equal((staged['programme'] as { wish: { text: string } }).wish.text, 'learn to sail');
  assert.equal((await programme()).programme.wishes.length, 0);
  assert.equal((await settleUnblock(payload('conv-prov', 'Totally different words'), deps(), undefined, now))!.status, 'unverified');
  assert.equal((await programme()).programme.wishes.length, 0); assert.equal((await programme()).programme.openingHeld, false);
  const [closedRow] = await db!.sql`select snapshot_enc from unblock_sessions where id=${s!.id}`; assert.equal(JSON.parse(decrypt(closedRow!['snapshot_enc'])).canonicalVerified, false);
});
test('a first call that saved nothing keeps the arc at the opening and the next weekly slot offers it again', options, async () => {
  await enroll({ due: 'opening' }); const first = await call(now, [], ['Hello?']);
  assert.equal(first.result!.status, 'interrupted'); assert.equal((await programme()).programme.openingHeld, false);
  const again = await claimUnblock(deps(), new Date(+day(7) + 7 * 3600_000)); assert.equal(again.length, 1); assert.equal(again[0]!.kind, 'opening');
});
test('duplicate workers cannot ring twice; the pointer has advanced before placement', options, async () => {
  await enroll(); const groups = await Promise.all([claimUnblock(deps(), now), claimUnblock(deps(), now)]);
  assert.equal(groups.flat().length, 1); assert.ok((await programme()).enrollment.next_weekly_at! > now);
});
test('STOP, carrier opt-out, safety hold, payment hold, pause and completion prevent claims and never queue catch-up calls', options, async () => {
  await enroll({ opened: true });
  for (const field of ['all_calls_stopped', 'held_for_review', 'sms_opt_out']) {
    await db!.sql.unsafe(`update callers set ${field}=true where phone_hash=$1`, [hash]);
    await db!.sql`update unblock_enrollments set next_weekly_at=${now} where phone_hash=${hash}`;
    assert.equal((await claimUnblock(deps(), now)).length, 0, field);
    assert.ok((await programme()).enrollment.next_weekly_at! > now, 'the held slot is consumed, not queued');
    await db!.sql.unsafe(`update callers set ${field}=false where phone_hash=$1`, [hash]);
    assert.equal((await claimUnblock(deps(), now)).length, 0);
  }
  await db!.sql`update unblock_enrollments set standing='payment_hold',next_weekly_at=${now} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), now)).length, 0);
  await db!.sql`update unblock_enrollments set standing='active',programme_enc=${encrypt(JSON.stringify({ ...finishCall(emptyProgramme(), 'opening', 0), state: 'paused' }))},next_weekly_at=${now} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), now)).length, 0);
  await db!.sql`update unblock_enrollments set programme_enc=${encrypt(JSON.stringify({ ...finishCall(emptyProgramme(), 'opening', 0), state: 'completed' }))},next_weekly_at=${now},next_light_at=${now} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), now)).length, 0);
  const done = await programme(); assert.equal(done.enrollment.next_weekly_at, null); assert.equal(done.enrollment.next_light_at, null);
  assert.equal((await db!.sql`select count(*)::int as n from call_attempts`)[0]!['n'], 0);
});
test('outage recovery skips an overdue weekly slot with one neutral notice, an overdue light evening silently, and never catches up', options, async () => {
  await enroll({ opened: true, due: null });
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(-1)},next_light_at=${day(-2)} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), now)).length, 0); assert.equal((await claimUnblock(deps(), now)).length, 0);
  const messages = await db!.sql`select payload_enc from message_outbox where kind='unblock'`; assert.equal(messages.length, 1);
  const text = decrypt(messages[0]!['payload_enc']); assert.ok(text.includes('Check or change')); assert.ok(!text.includes('rang'));
  const e = (await programme()).enrollment; assert.ok(e.next_weekly_at! > now); assert.ok(e.next_light_at! > now);
  assert.deepEqual((await db!.sql`select status from call_attempts order by scheduled_for`).map(r => r['status']), ['missed', 'missed']);
  assert.equal((await programme()).programme.weeksHeld, 0, 'a missed call is not held');
});
test('calls within 45 minutes of another attempt or of the base weekly slot are skipped, the weekly call winning over the light call', options, async () => {
  await enroll({ opened: true, due: null });
  await db!.sql`update unblock_enrollments set next_weekly_at=${now},next_light_at=${new Date(+now - 4 * 60_000)} where phone_hash=${hash}`;
  const claimed = await claimUnblock(deps(), now); assert.deepEqual(claimed.map(s => s.kind), ['weekly']);
  assert.deepEqual((await db!.sql`select status from call_attempts order by status`).map(r => r['status']), ['claimed', 'missed']);
  await db!.sql`delete from call_attempts`;
  await db!.sql`update callers set next_call_at=${new Date(+now + 20 * 60_000)} where phone_hash=${hash}`;
  await db!.sql`update unblock_enrollments set next_weekly_at=${now} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), now)).length, 0);
});
test('weekly call: last step outcome, a blocker and the next step; the week advances only on a held call', options, async () => {
  let p = finishCall(emptyProgramme(), 'opening', 0);
  p = { ...p, wishes: [{ version: 1, text: 'learn to sail', why: '', at: now.toISOString() }], steps: [{ week: 1, text: 'phone the club', outcome: null, outcomeText: '', at: now.toISOString() }], revision: 3 };
  await enroll({ programme: p });
  const { s, result } = await call(now, [
    ['I did phone the club but they were closed. Yes.', { command: 'step_outcome', outcome: 'partly', outcome_text: 'phone the club but they were closed' }],
    ['I am afraid I would look foolish at my age. Yes, that is right.', { command: 'block', text: 'afraid I would look foolish', kind: 'prediction' }],
    ['I will visit the club on Saturday. Yes.', { command: 'step', text: 'visit the club on Saturday' }],
  ]);
  assert.equal(s.kind, 'weekly'); assert.equal(s.week, 1); assert.equal(result!.status, 'completed');
  const saved = (await programme()).programme;
  assert.equal(saved.weeksHeld, 1); assert.equal(saved.steps[0]!.outcome, 'partly'); assert.equal(saved.steps[1]!.week, 2); assert.equal(saved.blocks[0]!.kind, 'prediction');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox`)[0]!['n'], 0, 'no sendout after an ordinary weekly call');
  // An interrupted second call keeps its verified save but repeats week 2.
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(7)} where phone_hash=${hash}`;
  const second = await call(day(7), [], ['Hello?']); assert.equal(second.s.week, 2); assert.equal(second.result!.status, 'interrupted');
  assert.equal((await programme()).programme.weeksHeld, 1);
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox`)[0]!['n'], 1, 'one recovery notice');
});
test('light calls: only the chosen evenings, one ledger entry per answer, nothing when declined, and a quiet evening is still a completed call', options, async () => {
  await enroll({ opened: true, due: 'light' });
  const { s, result } = await call(now, [['The smell of rain on the pavement. Yes.', { command: 'light', text: 'The smell of rain on the pavement' }]]);
  assert.equal(s.kind, 'light'); assert.equal(result!.status, 'completed');
  const ledger = (await programme()).programme.ledger; assert.equal(ledger.length, 1);
  assert.deepEqual([ledger[0]!.source, ledger[0]!.occurredOn, ledger[0]!.week], ['light_call', '2026-11-10', 1]);
  assert.equal((await programme()).programme.weeksHeld, 0, 'a light call never advances the weekly arc');
  const next = (await programme()).enrollment.next_light_at!; assert.ok(next > now);
  assert.ok([1, 3, 5].includes(new Date(next).getUTCDay()), 'only chosen evenings');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox`)[0]!['n'], 0);
  // A quiet evening: the caller says something but nothing is saved.
  await db!.sql`update unblock_enrollments set next_light_at=${day(2)} where phone_hash=${hash}`;
  const quiet = await call(day(2), [], ['Nothing really, sorry.']); assert.equal(quiet.result!.status, 'completed');
  // Declining by voice stops every future evening.
  await db!.sql`update unblock_enrollments set next_light_at=${day(4)} where phone_hash=${hash}`;
  await call(day(4), [['Please stop the evening calls, no more.|Yes.', { command: 'light_schedule', days: '' }]]);
  const stopped = await programme(); assert.deepEqual(stopped.enrollment.light_weekdays, []); assert.equal(stopped.enrollment.next_light_at, null);
  await db!.sql`update unblock_enrollments set next_light_at=${day(6)} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), day(6))).length, 0);
});
test('declining light calls in the opening call means none are ever placed', options, async () => {
  await enroll({ due: 'opening' });
  await call(now, [['learn to sail. Yes.', { command: 'wish', text: 'learn to sail' }], ['No light calls for me, thank you.|Yes, that is right.', { command: 'light_schedule' }]]);
  const e = (await programme()).enrollment; assert.equal(e.next_light_at, null); assert.deepEqual(e.light_weekdays, []); assert.ok(e.next_weekly_at);
});
test('choosing light evenings by voice stores them and schedules the next one', options, async () => {
  await enroll({ due: 'opening' });
  await call(now, [['learn to sail. Yes.', { command: 'wish', text: 'learn to sail' }], ['Tuesday and Thursday at eight in the evening. Yes, that is right.', { command: 'light_schedule', days: 'tue,thu', time: '20:00' }]]);
  const e = (await programme()).enrollment; assert.deepEqual(e.light_weekdays, [2, 4]); assert.equal(e.light_minute, 1200);
  assert.ok([2, 4].includes(new Date(e.next_light_at!.getTime() + 3600_000).getUTCDay()));
});
test('the first month: opening, three weekly calls, then a closing call that reads back the ledger and ends the chapter, not the programme', options, async () => {
  await enroll({ due: 'opening' }); const before = await db!.store.load(phone);
  await call(now, [['learn to sail. Yes.', { command: 'wish', text: 'learn to sail' }], ['I will phone the club. Yes.', { command: 'step', text: 'phone the club' }]]);
  for (let w = 1; w <= 3; w++) {
    const at = day(7 * w); await db!.sql`update unblock_enrollments set next_weekly_at=${at} where phone_hash=${hash}`;
    const light = `Evening moment ${w}`;
    const c = await call(at, [
      [`Done. Yes.`, { command: 'step_outcome', outcome: 'done' }],
      [`${light}. Yes.`, { command: 'light', text: light }],
      [`I will take step ${w + 1}. Yes.`, { command: 'step', text: `take step ${w + 1}` }],
    ]);
    assert.equal(c.s.week, w); assert.equal(c.result!.status, 'completed');
  }
  assert.equal((await programme()).programme.weeksHeld, 3);
  // Week 4: the placement context carries the ledger read-back and the week.
  process.env['SPEECHIFY_API_KEY'] = 'synthetic'; const at = day(28); await db!.sql`update unblock_enrollments set next_weekly_at=${at},next_light_at=null where phone_hash=${hash}`;
  fakeReady(); let sent: { agent_id: string; dynamic_variables: Record<string, string> } | undefined;
  const fetcher: typeof fetch = async (_url, init) => { sent = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ conversation_id: 'conv-week4' })); };
  assert.deepEqual(await tickUnblock(deps(), at, fetcher), { claimed: 1, placed: 1, failed: 0 });
  const v = sent!.dynamic_variables; assert.equal(sent!.agent_id, 'synthetic-weekly'); assert.equal(v['call_kind'], 'weekly'); assert.equal(v['week'], '4');
  const context = JSON.parse(v['unblock_context']!);
  assert.deepEqual(context.ledger_readback.map((e: { text: string }) => e.text), ['Evening moment 1', 'Evening moment 2', 'Evening moment 3']);
  assert.equal(context.call_context.preferred_name, 'Synthetic tester'); assert.equal(context.last_step, 'take step 4');
  assert.equal(v['belief_context'], undefined); assert.equal(JSON.parse(v['unblock_context']!).contact, undefined);
  const [s4] = await db!.sql`select id from unblock_sessions where week=4`;
  // Without the closing reflection the programme does not complete.
  const turns = ['Done. Yes.'];
  await say(s4!['id'], 'Done. Yes.', { command: 'step_outcome', outcome: 'partly' }, at);
  assert.equal((await settleUnblock(payload('conv-week4', turns), deps(), undefined, at))!.status, 'interrupted');
  assert.equal((await programme()).programme.weeksHeld, 3);
  // The same week is offered again at the next slot; this time with the closing reflection.
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(35)} where phone_hash=${hash}`;
  const closing = await call(day(35), [['What was already here was a lot. Take the evenings with me. Yes.', { command: 'closing', text: 'What was already here was a lot', carry_text: 'Take the evenings with me' }]]);
  assert.equal(closing.s.week, 4); assert.equal(closing.result!.status, 'completed');
  const done = await programme();
  assert.equal(done.programme.state, 'active', 'the programme completes only when the subscription ends'); assert.equal(done.programme.closing!.carryText, 'Take the evenings with me');
  assert.equal(done.programme.weeksHeld, 4); assert.equal(chapterComplete(done.programme), true); assert.equal(done.enrollment.completed_at, null);
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where reference=${closing.s.id}`)[0]!['n'], 0, 'a close that is not the last call sends no goodbye text');
  // The chapter is complete: the same weekly slot places nothing until the next billing month starts a new chapter.
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(42)} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), day(42))).length, 0, 'no further call in a finished chapter');
  assert.ok((await programme()).enrollment.next_weekly_at! > day(42), 'the waiting slot is consumed, not queued');
  assert.deepEqual(await db!.store.load(phone), before, 'the weekly counter and memories were never touched');
});
test('safety keywords hold the whole account with a content-free alert and repeated flags create one alert', options, async () => {
  await enroll({ opened: true }); const [s] = await claimUnblock(deps(), now);
  for (let i = 0; i < 2; i++) assert.equal((await unblockTool(deps(), { session_id: s!.id, session_token: token(s!.id), caller_text: 'I have thoughts of suicide' }, now))['held'], true);
  assert.equal((await db!.sql`select held_for_review from callers where phone_hash=${hash}`)[0]!['held_for_review'], true);
  assert.equal((await db!.sql`select safety_tier from call_attempts where id=${s!.id}`)[0]!['safety_tier'], 1);
  const alerts = await db!.sql`select payload_enc from message_outbox where kind='safety'`; assert.equal(alerts.length, 1); assert.ok(!decrypt(alerts[0]!['payload_enc']).includes('suicide'));
  assert.equal((await unblockTool(deps(), { session_id: s!.id, session_token: token(s!.id), caller_text: 'Fine now' }, now))['held'], true, 'an existing hold refuses every further change');
  await assert.rejects(() => say(s!.id, 'A wish. Yes.', { command: 'light', text: 'A wish' }).then(r => { if (r['held']) throw Error('held'); }));
});
test('a keyword in the signed completion holds the account and commits nothing', options, async () => {
  await enroll({ due: 'opening' }); const [s] = await claimUnblock(deps(), now); await place(s!.id, 'conv-flag');
  await say(s!.id, 'learn to sail. Yes.', { command: 'wish', text: 'learn to sail' });
  assert.equal((await settleUnblock(payload('conv-flag', ['learn to sail. Yes.', 'I want to kill myself']), deps(), undefined, now))!.status, 'interrupted');
  assert.equal((await programme()).programme.wishes.length, 0); assert.equal((await db!.sql`select held_for_review from callers where phone_hash=${hash}`)[0]!['held_for_review'], true);
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='unblock'`)[0]!['n'], 0);
});
test('credentials are per call and per module: another module token, wrong token and closed sessions are refused', options, async () => {
  await enroll({ opened: true }); const [s] = await claimUnblock(deps(), now);
  const ask = (t: string) => unblockTool(deps(), { session_id: s!.id, session_token: t, caller_text: 'Hello' }, now);
  await assert.rejects(() => ask('wrong'), /unauthorized/); await assert.rejects(() => ask(beliefToken(s!.id, 'u'.repeat(40))), /unauthorized/);
  await assert.rejects(() => unblockTool(deps(), { session_id: 'unknown', session_token: token('unknown'), caller_text: 'Hello' }, now), /unauthorized/);
  await assert.rejects(() => unblockTool(deps(), { session_id: s!.id, session_token: token(s!.id), caller_text: '   ' }, now), /wording_required|session_closed/);
  assert.deepEqual(await ask(token(s!.id)), { held: false });
  await assert.rejects(() => unblockTool(deps(), { session_id: s!.id, session_token: token(s!.id), caller_text: 'Hello' }, new Date(+now + 46 * 60_000)), /session_closed/);
  await db!.sql`update unblock_enrollments set standing='payment_hold' where phone_hash=${hash}`;
  await assert.rejects(() => ask(token(s!.id)), /page_changed/);
});
test('voice pause stops the programme; only a revision-guarded account resume restarts it', options, async () => {
  await enroll({ opened: true });
  await call(now, [['Please pause this for a while. Yes, that is right.', { command: 'pause' }]]);
  const paused = await programme(); assert.equal(paused.programme.state, 'paused');
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(7)},next_light_at=${day(7)} where phone_hash=${hash}`;
  assert.equal((await claimUnblock(deps(), day(7))).length, 0);
  await assert.rejects(() => repo().command(hash, { type: 'resume' }, 'stale', paused.programme.revision - 1), /page_changed/);
  await repo().command(hash, { type: 'resume' }, 'resume-1', paused.programme.revision, day(8));
  const resumed = await programme(); assert.equal(resumed.programme.state, 'active'); assert.ok(resumed.enrollment.next_weekly_at! > day(8)); assert.ok(resumed.enrollment.next_light_at! > day(8));
});
test('an uncertain provider placement is never retried and the sweep closes the stale session with one notice', options, async () => {
  await enroll({ opened: true }); fakeReady(); let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw new Error('synthetic uncertain request'); };
  const first = await tickUnblock(deps(), now, fetcher); assert.deepEqual([first.claimed, first.failed], [1, 1]);
  await tickUnblock(deps(), new Date(+now + 60000), fetcher); assert.equal(requests, 1);
  const [attempt] = await db!.sql`select id,status,note from call_attempts`; assert.equal(attempt!['status'], 'claimed'); assert.ok(attempt!['note'].includes('do not redial'));
  assert.equal(await sweep(deps(), 60 * 60_000, new Date(Date.now() + 3 * 3600_000)), 1);
  assert.equal((await db!.sql`select status from call_attempts`)[0]!['status'], 'failed'); assert.equal((await db!.sql`select complete from unblock_sessions`)[0]!['complete'], true);
  assert.equal(await closeUnblockSession(deps(), attempt!['id'], now), true);
  const [message] = await db!.sql`select kind,payload_enc from message_outbox where reference=${attempt!['id']}`; assert.equal(message!['kind'], 'unblock'); assert.ok(decrypt(message!['payload_enc']).includes('/unblock/access'));
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox`)[0]!['n'], 1);
});
test('placement carries only the five declared variables and is idempotent per attempt', options, async () => {
  await enroll({ opened: true }); fakeReady(); let headers: Record<string, string> = {}; let body: { dynamic_variables: Record<string, string>; agent_id: string } | undefined;
  const fetcher: typeof fetch = async (_u, init) => { headers = init!.headers as Record<string, string>; body = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ conversation_id: 'conv-vars' })); };
  assert.equal((await tickUnblock(deps(), now, fetcher)).placed, 1);
  assert.deepEqual(Object.keys(body!.dynamic_variables).sort(), ['call_kind', 'session_id', 'session_token', 'unblock_context', 'week']);
  const [attempt] = await db!.sql`select id,status,provider_call_id from call_attempts`; assert.equal(headers['Idempotency-Key'], `unblock:${attempt!['id']}`);
  assert.equal(attempt!['status'], 'placed'); assert.equal(body!.dynamic_variables['week'], '1'); assert.equal(body!.agent_id, 'synthetic-weekly');
  assert.equal(body!.dynamic_variables['session_token'], sessionToken(body!.dynamic_variables['session_id']!, 'u'.repeat(40)));
  // Nothing is placed outside readiness, the coverage window, or while launch flags are off.
  await db!.sql`delete from call_attempts`; await db!.sql`update unblock_enrollments set next_weekly_at=${now}`;
  process.env['UNBLOCK_LIVE_CALLS'] = 'false'; assert.equal((await tickUnblock(deps(), now, fetcher)).claimed, 0);
  process.env['UNBLOCK_LIVE_CALLS'] = 'true'; process.env['UNBLOCK_SAFETY_APPROVED'] = 'false'; assert.equal((await tickUnblock(deps(), now, fetcher)).claimed, 0);
  process.env['UNBLOCK_SAFETY_APPROVED'] = 'true'; process.env['UNBLOCK_COVERAGE_START'] = '03:00'; process.env['UNBLOCK_COVERAGE_END'] = '04:00'; assert.equal((await tickUnblock(deps(), now, fetcher)).claimed, 0);
});
test('Unblock completions are never mistaken for weekly calls: the shared settle path routes them and leaves the weekly counter alone', options, async () => {
  await enroll({ due: 'opening' }); const before = await db!.store.load(phone); const [s] = await claimUnblock(deps(), now); await place(s!.id, 'conv-shared');
  await say(s!.id, 'learn to sail. Yes.', { command: 'wish', text: 'learn to sail' });
  const result = await settleConversation(payload('conv-shared', 'learn to sail. Yes.'), deps(), undefined, now);
  assert.equal(result.handled, true); assert.equal(result.status, 'completed'); assert.deepEqual(await db!.store.load(phone), before);
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='recap'`)[0]!['n'], 0);
});
test('neutral sendouts follow the outbox rules: a human-review hold suppresses them', options, async () => {
  await enroll({ opened: true, due: null }); await db!.sql`update unblock_enrollments set next_weekly_at=${day(-1)} where phone_hash=${hash}`;
  await claimUnblock(deps(), now); const [message] = await db!.sql`select id from message_outbox where kind='unblock'`;
  await db!.sql`update callers set held_for_review=true where phone_hash=${hash}`;
  assert.equal(await dispatchMessage(deps(), message!['id'], now), 'suppressed');
});
test('export decodes the encrypted programme for the complete owner download only; deletion cascades', options, async () => {
  await enroll({ due: 'opening' }); await call(now, [['learn to sail. Yes.', { command: 'wish', text: 'learn to sail' }]]);
  const base = await composeExport(db!.store, phone, loadScript());
  assert.ok(!base!.body.includes('learn to sail')); assert.ok(base!.body.includes('/unblock/access'));
  const full = await composeExport(db!.store, phone, loadScript(), { includeBeliefs: true });
  assert.ok(full!.body.includes('learn to sail')); assert.ok(full!.body.includes('unblockSessions')); assert.ok(!full!.body.includes('programme_enc'));
  const only = await composeExport(db!.store, phone, loadScript(), { includeUnblock: true });
  assert.ok(only!.body.includes('learn to sail'));
  await db!.store.forget(phone);
  assert.equal((await db!.sql`select * from unblock_enrollments`).length, 0); assert.equal((await db!.sql`select * from unblock_sessions`).length, 0);
});
test('schedule(): Oslo fallback, three default evenings, first-call date, base-slot collisions and completed rejection', options, async () => {
  await db!.store.upsertProfile(phone, { name: 'Synthetic tester', email: '' }); await repo().enroll(hash, now);
  await db!.sql`update unblock_enrollments set standing='active'`;
  await repo().schedule(hash, new URLSearchParams({ weekday: 'tue', weekly: '18:00', opening_local: '2026-11-12T17:00' }), now);
  let e = (await programme()).enrollment;
  assert.deepEqual([e.timezone, e.light_weekdays, e.light_minute, e.weekly_weekday, e.weekly_minute], ['Europe/Oslo', [1, 3, 5], 1140, 2, 1080]);
  assert.equal(e.opening_at!.toISOString(), '2026-11-12T16:00:00.000Z'); assert.ok(e.next_weekly_at! >= day(5, e.opening_at!)); assert.equal(e.next_light_at, null, 'no light calls before the opening call');
  await repo().schedule(hash, new URLSearchParams({ weekday: 'tue', weekly: '18:00', timezone: 'Europe/London', light_days: 'none' }), now);
  e = (await programme()).enrollment; assert.deepEqual([e.timezone, e.light_weekdays, e.light_minute, e.opening_at], ['Europe/London', [], null, null]);
  await db!.sql`update callers set slot_weekday=2,slot_minute=1080,timezone='Europe/London' where phone_hash=${hash}`;
  await assert.rejects(() => repo().schedule(hash, new URLSearchParams({ weekday: 'tue', weekly: '18:20', timezone: 'Europe/London' }), now), /base_calls_too_close/);
  await repo().schedule(hash, new URLSearchParams({ weekday: 'thu', weekly: '18:00', timezone: 'Europe/London' }), now);
  await assert.rejects(() => repo().schedule(hash, new URLSearchParams({ weekday: 'thu', weekly: '18:00', timezone: 'Nowhere/Land' }), now), /timezone_invalid/);
});
test('the HTTP route /unblock/tool authenticates, answers the provider probe without acting, and accepts the webhook envelope', options, async () => {
  await enroll({ opened: true }); const at = new Date();
  await db!.sql`update unblock_enrollments set next_weekly_at=${at}`; const [claimed] = await claimUnblock(deps(), at); const id = claimed!.id;
  const server = controlPlane(deps(), 'synthetic-webhook-secret'); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(base + '/unblock/tool', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    assert.equal((await post({ session_id: id, session_token: 'forged', caller_text: 'Hi' })).status, 401);
    assert.equal((await post('x'.repeat(25000))).status, 413);
    const probe = await post({ session_id: id, session_token: token(id), caller_text: 'I have thoughts of suicide' }, { 'speechify-webhook-test': 'true' });
    assert.equal(probe.status, 200); assert.equal((await probe.json() as { action_performed: boolean }).action_performed, false);
    assert.equal((await db!.sql`select held_for_review from callers where phone_hash=${hash}`)[0]!['held_for_review'], false);
    const ok = await post({ tool_name: 'capture_unblock', tool_call_id: 'tc1', timestamp: 1, arguments: { session_id: id, session_token: token(id), caller_text: 'Hello' } });
    assert.deepEqual(await ok.json(), { held: false });
    assert.equal((await post({ tool_name: 'other', arguments: { session_id: id, session_token: token(id), caller_text: 'Hello' } })).status, 401);
    const rejected = await post({ session_id: id, session_token: token(id), event_id: 'x', caller_text: 'Maybe', command: 'light', text: 'Maybe', confirmed: true });
    assert.equal(rejected.status, 409);
  } finally { await new Promise(r => server.close(r)); }
});
function fakeReady(): void {
  for (const key of ['UNBLOCK_ENABLED', 'UNBLOCK_LIVE_CALLS', 'UNBLOCK_SAFETY_APPROVED', 'UNBLOCK_SCRIPTS_APPROVED', 'UNBLOCK_AGENTS_VERIFIED', 'UNBLOCK_PRICE_VERIFIED']) process.env[key] = 'true';
  Object.assign(process.env, { UNBLOCK_PRICE_LABEL: 'Synthetic price', UNBLOCK_CHECKOUT_URL: 'https://buy.stripe.com/synthetic', UNBLOCK_PRODUCT_ID: 'prod_synthetic', UNBLOCK_SUPPORT_HOURS: 'Synthetic staffed test window', SUPPORT_EMAIL: 'support@example.com',
    UNBLOCK_OPENING_AGENT_ID: 'synthetic-opening', UNBLOCK_WEEKLY_AGENT_ID: 'synthetic-weekly', UNBLOCK_LIGHT_AGENT_ID: 'synthetic-light', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', SMS_FROM_NUMBER: '+4791000000', SPEECHIFY_API_KEY: 'synthetic', SPEECHIFY_WEBHOOK_SECRET: 'synthetic', BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'synthetic', STRIPE_WEBHOOK_SECRET: 'synthetic' });
}
