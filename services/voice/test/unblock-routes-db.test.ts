import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { encrypt } from '../src/store/crypto.ts';
import { Links } from '../src/link/token.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { unblockRoutes } from '../src/unblock/routes.ts';
import { csrfFor } from '../src/unblock/http.ts';
import { csrfFor as beliefsCsrf } from '../src/beliefs/http.ts';
import { UnblockRepository } from '../src/unblock/repository.ts';
import { unblockReadiness } from '../src/unblock/readiness.ts';
import { applyCommand, emptyProgramme, finishCall, type Command, type Programme } from '../src/unblock/model.ts';

const opened = await openTestDb('unblock_routes'); const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
// A Tuesday, 11:00 in Oslo.
const now = new Date('2026-11-10T10:00:00Z'); const phone = '+4791000040'; const hash = phoneKey(phone);
let texts: string[] = []; let clients = 0; let events = 0;
const deps = (): LoopDeps => ({ store: db!.store, scheduler: new Scheduler(db!.sql), script: loadScript(), agent: { placeCall: async () => { throw Error('should not call'); } } as unknown as LoopDeps['agent'],
  sms: { send: async (_to: string, body: string) => { texts.push(body); return { id: 'synthetic-sms' }; } }, mailer: { send: async () => undefined } });
const repo = () => new UnblockRepository(db!.sql);
const run = (p: Programme, c: Command): Programme => applyCommand(p, c, 'route-' + ++events, now);

function request(path: string, init: { form?: URLSearchParams; cookie?: string; origin?: string } = {}) {
  const req = new IncomingMessage(new Socket()); req.method = init.form ? 'POST' : 'GET';
  req.headers = { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.origin ? { origin: init.origin } : {}) };
  req.push(init.form?.toString() ?? ''); req.push(null);
  return unblockRoutes(req, new URL(path, 'https://8and80.example'), deps(), 'client-' + ++clients, now);
}
const priv = (token: string, path: string, form?: URLSearchParams, origin?: string) => request(path, { form, cookie: 'unblock=' + token, origin });
const csrfForm = (token: string, fields: Record<string, string>) => new URLSearchParams({ csrf: csrfFor(token), event: 'ev-' + ++events, ...fields });

async function enroll(opts: { programme?: Programme; standing?: string } = {}) {
  await db!.store.upsertProfile(phone, { name: 'Synthetic tester', email: 'synthetic@example.com' });
  await repo().enroll(hash, now);
  const programme = opts.programme ?? finishCall(emptyProgramme(), 'opening', 0);
  await db!.sql`update unblock_enrollments set programme_enc=${encrypt(JSON.stringify(programme))}, revision=${programme.revision}, standing=${opts.standing ?? 'active'},
    timezone='Europe/Oslo', weekly_weekday=2, weekly_minute=1080, light_weekdays='{1,3,5}', light_minute=1140,
    next_weekly_at=${new Date('2026-11-10T17:00:00Z')}, next_light_at=${new Date('2026-11-11T18:00:00Z')} where phone_hash=${hash}`;
  return new Links(db!.sql).mint(hash, now, 'unblock');
}
const row = async () => (await repo().load(hash))!;

beforeEach(async () => {
  if (db) await db.sql`truncate product_feedback,unblock_sessions,unblock_enrollments,belief_refund_requests,belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries,heartbeats`;
  texts = []; clients = 0;
  Object.assign(process.env, { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 15).toString('base64'), PUBLIC_URL: 'https://8and80.example', OPERATOR_PHONE: '+4791000000', SUPPORT_EMAIL: 'support@example.com',
    UNBLOCK_ENABLED: 'true', UNBLOCK_LIVE_CALLS: 'false', UNBLOCK_SAFETY_APPROVED: 'true', UNBLOCK_SCRIPTS_APPROVED: 'true', UNBLOCK_AGENTS_VERIFIED: 'true', UNBLOCK_PRICE_VERIFIED: 'true',
    UNBLOCK_PRICE_LABEL: 'Synthetic price label', UNBLOCK_PRODUCT_ID: 'synthetic-product', UNBLOCK_CHECKOUT_URL: 'https://buy.stripe.com/synthetic', UNBLOCK_SUPPORT_HOURS: 'Synthetic staffed window',
    UNBLOCK_OPENING_AGENT_ID: 'synthetic-open', UNBLOCK_WEEKLY_AGENT_ID: 'synthetic-weekly', UNBLOCK_LIGHT_AGENT_ID: 'synthetic-light', UNBLOCK_TOOL_SECRET: 'u'.repeat(40),
    UNBLOCK_COVERAGE_START: '00:00', UNBLOCK_COVERAGE_END: '24:00', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', SMS_FROM_NUMBER: '+4791000001', SPEECHIFY_API_KEY: 'synthetic', SPEECHIFY_WEBHOOK_SECRET: 'synthetic', BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'synthetic', STRIPE_WEBHOOK_SECRET: 'synthetic' });
  delete process.env['OPERATOR_PHONE_BACKUP'];
});
after(async () => db?.close());

test('the test configuration is fully ready, and the join gate closes when it is not', options, async () => {
  assert.deepEqual(unblockReadiness(), []);
  process.env['UNBLOCK_SAFETY_APPROVED'] = 'false';
  const closed = await request('/unblock/join', { form: new URLSearchParams({ phone, consent: 'yes' }) });
  assert.equal(closed!.status, 503); assert.ok(closed!.body.includes('not open yet')); assert.equal(texts.length, 0);
  assert.equal((await db!.sql`select * from signups`).length, 0);
});

test('join: consent and phone proof come first, a code is texted, and verification creates the account with a scoped one-hour cookie', options, async () => {
  const noConsent = await request('/unblock/join', { form: new URLSearchParams({ phone, name: 'Synthetic' }) }); assert.equal(noConsent!.status, 400);
  assert.equal((await db!.sql`select * from callers`).length, 0, 'nothing exists before the number is proven');
  const joined = await request('/unblock/join', { form: new URLSearchParams({ phone, name: 'Synthetic', email: 'support-only@example.com', consent: 'yes' }) });
  assert.equal(joined!.status, 200); assert.equal(texts.length, 1); assert.match(texts[0]!, /^Your 8&80 Unblock code is \d{6}\./);
  assert.ok(!/Synthetic|support-only|wish/.test(texts[0]!), 'no personal content in the message');
  assert.equal((await db!.sql`select * from callers`).length, 0, 'still nothing before verification');
  const code = texts[0]!.match(/(\d{6})/)![1]!; const challenge = joined!.body.match(/name="challenge" value="([^"]+)"/)![1]!;
  const wrong = await request('/unblock/verify', { form: new URLSearchParams({ challenge, phone, code: code === '000000' ? '111111' : '000000' }) }); assert.equal(wrong!.status, 400);
  const verified = await request('/unblock/verify', { form: new URLSearchParams({ challenge, phone, code }) });
  assert.equal(verified!.status, 303); assert.equal(verified!.headers!['location'], '/unblock/schedule');
  assert.match(String(verified!.headers!['set-cookie']), /^unblock=[a-z2-9]+; Path=\/unblock; Max-Age=3600; HttpOnly; SameSite=Lax; Secure$/);
  const e = (await row()).enrollment; assert.equal(e.standing, 'awaiting_payment'); assert.equal((await db!.sql`select count(*)::int as n from callers`)[0]!['n'], 1);
  assert.equal((await row()).programme.contact?.name, 'Synthetic');
  assert.equal((await db!.sql`select slot_weekday from callers`)[0]!['slot_weekday'], null, 'no weekly slot or signup is created');
  assert.equal((await request('/unblock/verify', { form: new URLSearchParams({ challenge, phone, code }) }))!.status, 400, 'a code is single use');
});

test('access: the response is the same for known and unknown numbers, and only a known one is texted', options, async () => {
  await enroll();
  const known = await request('/unblock/access', { form: new URLSearchParams({ phone }) });
  const unknown = await request('/unblock/access', { form: new URLSearchParams({ phone: '+4791000099' }) });
  assert.equal(known!.status, 200); assert.equal(unknown!.status, 200);
  assert.equal(known!.body.includes('Check your messages'), unknown!.body.includes('Check your messages'));
  assert.equal(texts.length, 1); assert.match(texts[0]!, /^Your 8&80 Unblock code is/);
  const code = texts[0]!.match(/(\d{6})/)![1]!; const challenge = known!.body.match(/name="challenge" value="([^"]+)"/)![1]!;
  const back = await request('/unblock/verify', { form: new URLSearchParams({ challenge, phone, code, access: 'yes' }) });
  assert.equal(back!.status, 303); assert.equal(back!.headers!['location'], '/unblock/account');
  const stranger = unknown!.body.match(/name="challenge" value="([^"]+)"/)![1]!;
  const none = await request('/unblock/verify', { form: new URLSearchParams({ challenge: stranger, phone: '+4791000099', code: '123456', access: 'yes' }) }); assert.equal(none!.status, 400);
});

test('private pages need an Unblock credential: base, Beliefs and expired ones are refused; forms need CSRF and a same-site origin', options, async () => {
  const token = await enroll();
  assert.equal((await request('/unblock/account'))!.status, 303);
  for (const purpose of ['browser', 'beliefs', 'reschedule'] as const) {
    const other = await new Links(db!.sql).mint(hash, now, purpose); assert.equal((await priv(other, '/unblock/account'))!.status, 303, purpose);
  }
  assert.equal((await new Links(db!.sql).open(token, now, 'beliefs')).ok, false); assert.equal((await new Links(db!.sql).open(token, now, 'browser')).ok, false);
  const stale = await new Links(db!.sql).mint(hash, new Date(+now - 3600_001), 'unblock'); assert.equal((await priv(stale, '/unblock/account'))!.status, 303);
  const page = await priv(token, '/unblock/account'); assert.equal(page!.status, 200);
  assert.equal(page!.headers!['cache-control'], 'no-store'); assert.equal(page!.headers!['referrer-policy'], 'no-referrer'); assert.match(String(page!.headers!['content-security-policy']), /script-src 'sha256-/);
  assert.equal((await priv(token, '/unblock/action', new URLSearchParams({ action: 'pause' })))!.status, 403, 'no CSRF');
  assert.equal((await priv(token, '/unblock/action', new URLSearchParams({ action: 'pause', csrf: beliefsCsrf(token) })))!.status, 403, 'a Beliefs token is not an Unblock token');
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'pause', revision: '2' }), 'https://elsewhere.example'))!.status, 403, 'cross-site');
  assert.equal((await row()).programme.state, 'active');
  assert.equal((await priv(token, '/unblock/nothing'))!.status, 404);
});

test('an enrolled caller sees only their own words; another account\'s credential shows nothing of theirs', options, async () => {
  const p = run(finishCall(emptyProgramme(), 'opening', 0), { type: 'wish', text: 'My private wish', why: '' });
  const token = await enroll({ programme: p });
  await db!.store.upsertProfile('+4791000041', { name: 'Other' }); const other = phoneKey('+4791000041'); await repo().enroll(other, now);
  const otherToken = await new Links(db!.sql).mint(other, now, 'unblock');
  assert.ok((await priv(token, '/unblock/account'))!.body.includes('My private wish'));
  assert.ok(!(await priv(otherToken, '/unblock/account'))!.body.includes('My private wish'));
});

test('payment: before authoritative payment calls stay off, nothing in the routes can activate the account, and preview controls do not exist', options, async () => {
  const token = await enroll({ standing: 'awaiting_payment' });
  const page = await priv(token, '/unblock/account');
  assert.ok(page!.body.includes('Start Unblock')); assert.ok(!page!.body.includes('Your next call'));
  const link = page!.body.match(/href="(https:\/\/buy\.stripe\.com[^"]+)"/)![1]!.replaceAll('&amp;', '&');
  assert.equal(new URL(link).searchParams.get('client_reference_id'), (await row()).enrollment.checkout_reference, 'the checkout carries the enrolment reference');
  assert.match(new URL(link).searchParams.get('client_reference_id') ?? '', /^[A-Za-z0-9_-]{1,200}$/, 'Stripe silently drops any other client_reference_id');
  assert.ok(!page!.body.includes('data-preview-controls')); assert.ok(page!.body.includes('data-seam="subscription"'));
  for (const action of ['pay', 'sim_call', 'sim_light', 'sim_missed', 'activate', 'standing'])
    assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action, standing: 'active', revision: '1' })))!.status, 409, action);
  assert.equal((await row()).enrollment.standing, 'awaiting_payment');
  await db!.sql`update unblock_enrollments set standing='payment_hold'`; assert.ok((await priv(token, '/unblock/account'))!.body.includes('payment needs review'));
  await assert.rejects(() => repo().occurrence(hash, new URLSearchParams({ action: 'skip', kind: 'call', expected_at: '2026-11-10T17:00:00.000Z' }), now), /calls_held/);
  // Without the product configured there is no checkout link, only an honest note.
  await db!.sql`update unblock_enrollments set standing='awaiting_payment'`; process.env['UNBLOCK_CHECKOUT_URL'] = '';
  const closed = await priv(token, '/unblock/account'); assert.ok(closed!.body.includes('Checkout is not available here yet')); assert.ok(!closed!.body.includes('buy.stripe.com'));
});

test('schedule: saved with default three light evenings, a clear none, coverage and spacing rules, and an opening time before the first call', options, async () => {
  const token = await enroll({ programme: emptyProgramme(), standing: 'awaiting_payment' });
  await db!.sql`update unblock_enrollments set weekly_weekday=null,weekly_minute=null,light_weekdays='{}',light_minute=null,next_weekly_at=null,next_light_at=null`;
  const page = await priv(token, '/unblock/schedule'); assert.ok(page!.body.includes('First conversation')); assert.ok(page!.body.includes('Make room for it'));
  const base = { action: 'schedule', timezone: 'Europe/Oslo', weekday: '0', weekly: '17:00', opening_local: '2026-11-12T18:00' };
  const saved = await priv(token, '/unblock/action', csrfForm(token, { ...base, light_choice: 'evenings', light_day: '1' }));
  assert.equal(saved!.status, 303); assert.equal(saved!.headers!['location'], '/unblock/account?saved=schedule');
  let e = (await row()).enrollment; assert.deepEqual(e.light_weekdays, [1]); assert.equal(e.light_minute, 1140); assert.equal(e.timezone, 'Europe/Oslo');
  assert.equal(e.opening_at!.toISOString(), '2026-11-12T17:00:00.000Z'); assert.equal(e.weekly_weekday, 0); assert.equal(e.weekly_minute, 1020);
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, base)))!.status, 303); e = (await row()).enrollment; assert.deepEqual(e.light_weekdays, [1, 3, 5], 'untouched light choice is the default three evenings');
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { ...base, light_choice: 'none' })))!.status, 303); e = (await row()).enrollment;
  assert.deepEqual(e.light_weekdays, []); assert.equal(e.light_minute, null);
  assert.ok((await priv(token, '/unblock/schedule'))!.body.includes('value="none" checked'));
  // An empty first-conversation time is allowed by the backend: the first call is then the usual weekly time.
  const refused = async (fields: Record<string, string>, text: RegExp) => { const r = await priv(token, '/unblock/action', csrfForm(token, { ...base, ...fields })); assert.equal(r!.status, 409); assert.match(r!.body, text); };
  await refused({ timezone: 'Mars/Base' }, /valid timezone/); await refused({ opening_local: '2026-10-01T18:00' }, /future/);
  await refused({ light_choice: 'evenings', light_day: '0', light: '17:30' }, /45 minutes/); await refused({ light_choice: 'evenings' }, /days you chose/);
  process.env['UNBLOCK_COVERAGE_START'] = '08:00'; process.env['UNBLOCK_COVERAGE_END'] = '20:00';
  await refused({ weekly: '23:00' }, /response hours/); await refused({ light_choice: 'evenings', light_day: '1', light: '21:00' }, /response hours/);
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, base)))!.status, 303);
});

test('move and skip: only the next call, later in its own week, never inside coverage gaps or near other calls; STOP and stale pages refuse', options, async () => {
  const token = await enroll();
  const booked = '2026-11-10T17:00:00.000Z';
  const move = (local: string, expected = booked) => priv(token, '/unblock/action', csrfForm(token, { action: 'occurrence', kind: 'call', expected_at: expected, occurrence_local: local }));
  assert.ok((await priv(token, '/unblock/account'))!.body.includes('Move only this call'));
  let r = await move('2026-11-10T12:00'); assert.equal(r!.status, 409); assert.match(r!.body, /after your usual one/);
  r = await move('2026-11-17T19:00'); assert.equal(r!.status, 409); assert.match(r!.body, /before the following usual call/);
  r = await move('2026-11-11T18:30'); assert.equal(r!.status, 409); assert.match(r!.body, /45 minutes/, 'too close to the Wednesday light call');
  process.env['UNBLOCK_COVERAGE_START'] = '08:00'; process.env['UNBLOCK_COVERAGE_END'] = '20:00';
  r = await move('2026-11-12T22:00'); assert.equal(r!.status, 409); assert.match(r!.body, /response hours/); process.env['UNBLOCK_COVERAGE_START'] = '00:00'; process.env['UNBLOCK_COVERAGE_END'] = '24:00';
  await db!.sql`update callers set all_calls_stopped=true`; r = await move('2026-11-12T18:00'); assert.equal(r!.status, 409); assert.match(r!.body, /on hold/); await db!.sql`update callers set all_calls_stopped=false`;
  r = await move('2026-11-12T18:00', '2026-11-10T16:00:00.000Z'); assert.equal(r!.status, 409); assert.match(r!.body, /another tab/);
  r = await move('2026-11-12T18:00'); assert.equal(r!.status, 303);
  let e = (await row()).enrollment; assert.equal(e.next_weekly_at!.toISOString(), '2026-11-12T17:00:00.000Z'); assert.equal(e.weekly_minute, 1080, 'the usual time is untouched');
  const skip = (expected: string, kind = 'call') => priv(token, '/unblock/action', csrfForm(token, { action: 'skip', kind, expected_at: expected }));
  assert.equal((await skip('2026-11-12T17:00:00.000Z'))!.status, 303); e = (await row()).enrollment;
  assert.equal(e.next_weekly_at!.toISOString(), '2026-11-17T17:00:00.000Z', 'the following usual Tuesday; no catch-up'); assert.equal((await skip('2026-11-12T17:00:00.000Z'))!.status, 409);
  assert.equal((await skip('2026-11-11T18:00:00.000Z', 'light'))!.status, 303); assert.equal((await row()).enrollment.next_light_at!.toISOString(), '2026-11-13T18:00:00.000Z');
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'occurrence', kind: 'light', expected_at: '2026-11-13T18:00:00.000Z', occurrence_local: '2026-11-13T20:00' })))!.status, 409, 'a light call can be skipped but not moved');
  await db!.sql`update call_attempts set status='x' where false`;
  await db!.sql`insert into call_attempts(id,phone_hash,scheduled_for,status) values('in-flight',${hash},${now},'placed')`;
  assert.equal((await skip('2026-11-17T17:00:00.000Z'))!.status, 409);
});

test('move and skip before the opening call: any time within 30 days, ahead of the weekly fallback', options, async () => {
  const token = await enroll({ programme: emptyProgramme() });
  const opening = '2026-11-11T17:00:00.000Z';
  await db!.sql`update unblock_enrollments set opening_at=${new Date(opening)}, next_weekly_at=${new Date('2026-11-17T17:00:00Z')}, next_light_at=null`;
  const move = (local: string) => priv(token, '/unblock/action', csrfForm(token, { action: 'occurrence', kind: 'call', expected_at: opening, occurrence_local: local }));
  assert.equal((await move('2026-11-18T18:00'))!.status, 409, 'must come before the weekly fallback');
  assert.equal((await move('2026-11-10T09:00'))!.status, 409, 'must be in the future');
  assert.equal((await move('2026-11-12T20:00'))!.status, 303); assert.equal((await row()).enrollment.opening_at!.toISOString(), '2026-11-12T19:00:00.000Z');
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'skip', kind: 'call', expected_at: '2026-11-12T19:00:00.000Z' })))!.status, 303);
  const e = (await row()).enrollment; assert.equal(e.opening_at, null); assert.equal(e.next_weekly_at!.toISOString(), '2026-11-17T17:00:00.000Z', 'the usual weekly time is offered instead');
});

test('pause and resume use the revision guard; resume keeps shared holds in force', options, async () => {
  const token = await enroll(); const revision = String((await row()).programme.revision);
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'pause', revision: String(Number(revision) - 1) })))!.status, 409);
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'pause', revision })))!.status, 303); assert.equal((await row()).programme.state, 'paused');
  const paused = await priv(token, '/unblock/account'); assert.ok(paused!.body.includes('Your calls are paused')); assert.ok(!paused!.body.includes('Skip this call'));
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'resume', revision: String((await row()).programme.revision) })))!.status, 303);
  assert.equal((await row()).programme.state, 'active'); assert.ok((await row()).enrollment.next_weekly_at!.getTime() > 0);
  await db!.sql`update callers set held_for_review=true`; const held = await priv(token, '/unblock/account'); assert.ok(held!.body.includes('Calls are on hold')); assert.ok(!held!.body.includes('Skip this call'));
});

test('download contains the account\'s words and nobody else\'s; deletion needs the typed word and erases everything; sign-out withdraws the credential', options, async () => {
  const p = run(finishCall(emptyProgramme(), 'opening', 0), { type: 'wish', text: 'My downloadable wish', why: '' });
  const token = await enroll({ programme: p });
  const exported = await priv(token, '/unblock/action', csrfForm(token, { action: 'export' }));
  assert.equal(exported!.status, 200); assert.match(String(exported!.headers!['content-disposition']), /attachment/); assert.equal(exported!.headers!['cache-control'], 'no-store');
  assert.ok(exported!.body.includes('My downloadable wish')); assert.ok(!exported!.body.includes('unblock_ credential'));
  assert.equal((await priv(token, '/unblock/action', csrfForm(token, { action: 'delete', confirmation: 'delete' })))!.status, 409);
  assert.equal((await db!.sql`select * from unblock_enrollments`).length, 1);
  const out = await priv(token, '/unblock/action', csrfForm(token, { action: 'signout' })); assert.equal(out!.status, 303); assert.match(String(out!.headers!['set-cookie']), /Max-Age=0/);
  assert.equal((await priv(token, '/unblock/account'))!.status, 303, 'signed-out credential is withdrawn');
  const again = await new Links(db!.sql).mint(hash, now, 'unblock');
  const gone = await priv(again, '/unblock/action', csrfForm(again, { action: 'delete', confirmation: 'DELETE' })); assert.equal(gone!.status, 303);
  assert.equal((await db!.sql`select * from unblock_enrollments`).length, 0); assert.equal((await db!.sql`select * from callers`).length, 0);
});
