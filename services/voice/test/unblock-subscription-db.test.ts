import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { encrypt } from '../src/store/crypto.ts';
import { controlPlane } from '../src/control.ts';
import { composeExport } from '../src/legal/export.ts';
import { deleteAccount, syncBilling } from '../src/billing/service.ts';
import type { BillingGateway, Subscription } from '../src/billing/gateway.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { UnblockRepository, callsAllowed } from '../src/unblock/repository.ts';
import { claimUnblock, settleUnblock, tickUnblock, unblockTool } from '../src/unblock/runtime.ts';
import { cancelUnblock, refreshUnblock, standingFor, syncUnblockSubscription, unblockPortal } from '../src/unblock/billing.ts';
import { unblockCheckout } from '../src/unblock/payment.ts';
import { chapterComplete, emptyProgramme, finishCall, type Programme } from '../src/unblock/model.ts';
import { sessionToken } from '../src/unblock/protocol.ts';
import { addMonths, periodEnd, periodStart, planNext, tooClose, weekdaysFor, occurrences } from '../src/unblock/cadence.ts';

const opened = await openTestDb('unblock_subscription'); const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
// A Tuesday, 11:00 in Oslo (UTC+1 since 25 October). The weekly slot is Tuesday 18:00 Oslo = 17:00Z.
const now = new Date('2026-11-10T10:00:00Z'); const phone = '+4791000050'; const hash = phoneKey(phone);
const texts: string[] = []; let events = 0; let cancels = 0; let portals = 0; let providerSub: Subscription;
const gateway: BillingGateway = {
  async subscription() { return { ...providerSub }; },
  async cancel() { cancels++; providerSub = { ...providerSub, cancelAtPeriodEnd: true }; return { ...providerSub }; },
  async portal(_p, customer, subscription, returnUrl) { portals++; assert.equal(customer, 'cus_ub'); assert.equal(subscription, 'sub_ub'); assert.match(returnUrl, /\/unblock\/account\?billing=return$/); return 'https://billing.stripe.com/p/unblock'; },
};
const deps = (): LoopDeps => ({ store: db!.store, scheduler: new Scheduler(db!.sql), script: loadScript(), billing: gateway, agent: { placeCall: async () => { throw Error('should not call base agent'); } } as unknown as LoopDeps['agent'],
  sms: { send: async (_to: string, body: string) => { texts.push(body); } }, mailer: { send: async () => undefined } });
const repo = () => new UnblockRepository(db!.sql);
const load = async () => (await repo().load(hash))!;
const day = (n: number, base = now) => new Date(+base + n * 86400_000);
const payload = (id: string, said: string | string[]) => ({ type: 'conversation.completed', data: { conversation_id: id, duration_ms: 60000, messages: (typeof said === 'string' ? [said] : said).map(content => ({ role: 'user', content })) } });
const token = (id: string) => sessionToken(id, 'u'.repeat(40));
const price = 'price_unblock';
const stripe = (over: Partial<Subscription> = {}): Subscription => ({ provider: 'stripe', subscriptionId: 'sub_ub', customerId: 'cus_ub', standing: 'active', status: 'active', event: 'customer.subscription.updated',
  cancelAtPeriodEnd: false, endsAt: new Date('2026-12-10T10:00:00Z').toISOString(), productIds: [price], ...over });
const checkoutEvent = (reference: string) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: 'cs_1', client_reference_id: reference, subscription: 'sub_ub', customer: 'cus_ub', payment_status: 'paid' } } });
const subEvent = (id = 'sub_ub') => ({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { object: 'subscription', id, customer: 'cus_ub', status: 'active', cancel_at_period_end: false } } });

async function enroll(opts: { programme?: Programme; standing?: string; calls?: number; lightMinute?: number } = {}) {
  await db!.store.upsertProfile(phone, { name: 'Synthetic tester', email: 'synthetic@example.com' });
  const id = await repo().enroll(hash, now);
  const programme = opts.programme ?? finishCall(emptyProgramme(), 'opening', 0);
  await db!.sql`update unblock_enrollments set programme_enc=${encrypt(JSON.stringify(programme))}, revision=${programme.revision}, standing=${opts.standing ?? 'awaiting_payment'}, calls_per_month=${opts.calls ?? 4},
    timezone='Europe/Oslo', weekly_weekday=2, weekly_minute=1080, light_weekdays='{1,3,5}', light_minute=${opts.lightMinute ?? 1140} where phone_hash=${hash}`;
  return id;
}
/** Activates through the real provider path: a checkout event, re-read from the (fake) provider. */
async function activate(at = now, over: Partial<Subscription> = {}) {
  providerSub = stripe(over); const e = (await load()).enrollment;
  return syncUnblockSubscription(deps(), checkoutEvent(e.checkout_reference), {}, at);
}
beforeEach(async () => {
  if (db) await db.sql`truncate unblock_sessions,unblock_enrollments,belief_refund_requests,belief_sessions,belief_enrollments,callers,call_attempts,links,signups,access_codes,message_outbox,message_attempts,feedback,journey_events,journey_tracking,journey_counts,webhook_deliveries,heartbeats`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 16).toString('base64');
  for (const key of ['UNBLOCK_ENABLED', 'UNBLOCK_LIVE_CALLS', 'UNBLOCK_SAFETY_APPROVED', 'UNBLOCK_SCRIPTS_APPROVED', 'UNBLOCK_AGENTS_VERIFIED', 'UNBLOCK_PRICE_VERIFIED']) process.env[key] = 'true';
  Object.assign(process.env, { PUBLIC_URL: 'https://8and80.example', OPERATOR_PHONE: '+4791000000', SUPPORT_EMAIL: 'support@example.com', UNBLOCK_PRICE_LABEL: 'Synthetic price', UNBLOCK_PRODUCT_ID: price,
    UNBLOCK_CHECKOUT_URL: 'https://buy.stripe.com/synthetic', UNBLOCK_SUPPORT_HOURS: 'Synthetic window', UNBLOCK_OPENING_AGENT_ID: 'synthetic-opening', UNBLOCK_WEEKLY_AGENT_ID: 'synthetic-weekly', UNBLOCK_LIGHT_AGENT_ID: 'synthetic-light',
    UNBLOCK_TOOL_SECRET: 'u'.repeat(40), UNBLOCK_COVERAGE_START: '00:00', UNBLOCK_COVERAGE_END: '24:00', TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', SMS_FROM_NUMBER: '+4791000001',
    SPEECHIFY_API_KEY: 'synthetic', SPEECHIFY_WEBHOOK_SECRET: 'synthetic', BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'synthetic', STRIPE_WEBHOOK_SECRET: 'billing_secret' });
  delete process.env['OPERATOR_PHONE_BACKUP'];
  texts.length = 0; cancels = 0; portals = 0; providerSub = stripe();
});
after(async () => db?.close());

test('cadence: billing months follow the anchor with month-end clamping, and the plan spreads the close onto the last slot', () => {
  const anchor = new Date('2026-01-31T10:00:00Z');
  assert.equal(addMonths(anchor, 1).toISOString(), '2026-02-28T10:00:00.000Z'); assert.equal(addMonths(anchor, 2).toISOString(), '2026-03-31T10:00:00.000Z');
  assert.equal(periodStart(anchor, new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(periodEnd(anchor, new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-03-31T10:00:00.000Z');
  assert.equal(periodEnd(anchor, anchor).toISOString(), '2026-02-28T10:00:00.000Z', 'a boundary instant belongs to the period that starts at it');
  assert.deepEqual(weekdaysFor(2, 4), [2]); assert.deepEqual(weekdaysFor(2, 5), [2, 5]); assert.deepEqual(weekdaysFor(5, 8), [1, 5]);
  const c = { timezone: 'Europe/Oslo', weekdays: [2], minute: 1080 }; const end = new Date('2026-12-10T10:00:00Z');
  assert.equal(occurrences(c, now, end).length, 5);
  // Replaying the online plan for four calls: slots 1, 2, 3 and the last.
  const picks: string[] = []; let after = new Date(+now - 1);
  for (let remaining = 4; remaining >= 1; remaining--) { const at = planNext(c, after, end, remaining)!; picks.push(at.toISOString().slice(5, 10)); after = at; }
  assert.deepEqual(picks, ['11-10', '11-17', '11-24', '12-08'], 'the close is on the last slot');
  assert.equal(planNext(c, now, new Date(+now + 3600_000), 3), null, 'no slot left');
  const short = [] as string[]; after = new Date(+now - 1);
  for (let remaining = 8; remaining >= 1; remaining--) { const at = planNext({ ...c, weekdays: [2, 5] }, after, end, remaining); if (!at) break; short.push(at.toISOString().slice(5, 10)); after = at; }
  assert.equal(short.length, 8); assert.equal(short.at(-1), '12-08');
  assert.equal(tooClose([{ weekday: 1, minute: 1430 }], [{ weekday: 2, minute: 10 }]), true, 'spacing wraps around midnight');
  assert.equal(tooClose([{ weekday: 2, minute: 1080 }], [{ weekday: 2, minute: 1140 }]), false);
});

test('the webhook: a signed checkout event activates only after an authoritative read of this product, refreshes stale pointers and leaves weekly 8&80 alone', options, async () => {
  await enroll({ programme: emptyProgramme() });
  await db!.sql`update unblock_enrollments set opening_at=${day(-3)}, next_weekly_at=${day(-2)}`;
  const [weeklyBefore] = await db!.sql`select billing_status, ls_subscription_id from callers where phone_hash=${hash}`;
  providerSub = stripe(); const reference = (await load()).enrollment.checkout_reference;
  const server = controlPlane(deps(), 'test'); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = async (event: unknown, signed = true) => { const body = JSON.stringify(event); const t = Math.floor(Date.now() / 1000);
      return fetch(`${base}/webhooks/payments`, { method: 'POST', headers: signed ? { 'stripe-signature': `t=${t},v1=${createHmac('sha256', 'billing_secret').update(`${t}.${body}`).digest('hex')}` } : {}, body }); };
    assert.equal((await send(checkoutEvent(reference), false)).status, 401); assert.equal((await load()).enrollment.standing, 'awaiting_payment');
    // A redirect or a forged body proves nothing: the product must be this one.
    providerSub = stripe({ productIds: ['price_weekly'] });
    assert.equal((await send(checkoutEvent(reference))).status, 503); assert.equal((await load()).enrollment.standing, 'awaiting_payment');
    providerSub = stripe(); const ok = await send(checkoutEvent(reference));
    assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { handled: true });
    assert.equal((await send(checkoutEvent(reference))).status, 200, 'a duplicate delivery is harmless');
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  const { enrollment: e, programme: p } = await load();
  assert.equal(e.standing, 'active'); assert.equal(e.subscription_id, 'sub_ub'); assert.equal(e.customer_id, 'cus_ub'); assert.equal(e.provider, 'stripe'); assert.equal(e.product_id, price);
  assert.equal(e.cancel_at_period_end, false); assert.equal(e.paid_until!.toISOString(), '2026-12-10T10:00:00.000Z'); assert.ok(e.paid_at);
  assert.ok(e.anchor_at && e.chapter_started_at && p.chapterStartedAt, 'the chapter clock starts at first activation'); assert.equal(p.chapterCalls, 4); assert.equal(e.chapter, 1); assert.equal(e.year, 1);
  assert.equal(e.opening_at, null, 'a first-conversation date that already passed is not rung'); assert.ok(e.next_weekly_at! > e.anchor_at!, 'the next call is refreshed to the next usual slot');
  assert.equal(e.next_weekly_at!.toISOString().slice(11, 16), '17:00');
  assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='unblock'`)[0]!['n'], 1, 'one confirmation text, not one per delivery');
  assert.deepEqual((await db!.sql`select billing_status, ls_subscription_id from callers where phone_hash=${hash}`)[0], weeklyBefore, 'the weekly subscription columns are untouched');
});

test('events that are not Unblock\'s are left to the weekly product; weekly billing still ignores Unblock subscriptions', options, async () => {
  await enroll({ programme: emptyProgramme() });
  assert.equal(await syncUnblockSubscription(deps(), subEvent('sub_weekly'), {}, now), undefined, 'an unknown subscription is not Unblock\'s');
  assert.equal(await syncUnblockSubscription(deps(), { type: 'invoice.created', data: { object: { object: 'invoice' } } }, {}, now), undefined);
  assert.equal(await syncUnblockSubscription(deps(), checkoutEvent('beliefs:abc'), {}, now), undefined, 'a Beliefs reference is not Unblock\'s');
  assert.equal(await syncUnblockSubscription(deps(), checkoutEvent('unblock_unknown'), {}, now), false, 'an Unblock reference with no enrolment is acknowledged and ignored');
  await activate();
  assert.equal(await syncUnblockSubscription(deps(), subEvent(), {}, now), true, 'later events are found by the stored subscription id');
  // The weekly sync cannot match an Unblock subscription id to any caller, so it changes nothing.
  assert.equal((await syncBilling(deps(), { event: 'customer.subscription.updated', provider: 'stripe', subscriptionId: 'sub_ub', customerId: 'cus_ub' })).matched, false);
  // A second, different subscription never replaces a live one.
  providerSub = stripe({ subscriptionId: 'sub_other' });
  const other = { id: 'e3', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', client_reference_id: (await load()).enrollment.checkout_reference, subscription: 'sub_other', customer: 'cus_ub' } } };
  await assert.rejects(() => syncUnblockSubscription(deps(), other, {}, now));
  assert.equal((await load()).enrollment.subscription_id, 'sub_ub');
});

test('standing follows the provider: past_due keeps calling, a first payment that never cleared grants nothing, cancel-at-period-end runs to the end, ended stops everything', options, async () => {
  assert.equal(standingFor('awaiting_payment', { standing: 'past_due' }), 'awaiting_payment'); assert.equal(standingFor('active', { standing: 'past_due' }), 'past_due');
  assert.equal(standingFor('awaiting_payment', { standing: 'ended' }), 'awaiting_payment'); assert.equal(standingFor('past_due', { standing: 'active' }), 'active'); assert.equal(standingFor('active', { standing: 'ended' }), 'ended');
  await enroll(); await activate(now, { standing: 'past_due', status: 'incomplete' });
  assert.equal((await load()).enrollment.standing, 'awaiting_payment'); assert.equal((await claimUnblock(deps(), day(8))).length, 0);
  await activate(now); assert.equal((await load()).enrollment.standing, 'active');
  providerSub = stripe({ standing: 'past_due', status: 'past_due' }); await syncUnblockSubscription(deps(), subEvent(), {}, day(1));
  const late = await load(); assert.equal(late.enrollment.standing, 'past_due'); assert.ok(callsAllowed(late.enrollment, day(2)), 'a payment problem does not stop calls (as for weekly 8&80)');
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(7)}`; assert.equal((await claimUnblock(deps(), day(7))).length, 1);
  providerSub = stripe({ cancelAtPeriodEnd: true, endsAt: day(20).toISOString() }); await syncUnblockSubscription(deps(), subEvent(), {}, day(8));
  const cancelling = await load(); assert.equal(cancelling.enrollment.standing, 'active'); assert.equal(cancelling.enrollment.cancel_at_period_end, true);
  assert.ok(callsAllowed(cancelling.enrollment, day(19)) && !callsAllowed(cancelling.enrollment, day(20)), 'calls continue to the period end and not past it');
  assert.ok(cancelling.enrollment.next_weekly_at === null || cancelling.enrollment.next_weekly_at < day(20));
  providerSub = stripe({ standing: 'ended', status: 'canceled', cancelAtPeriodEnd: true }); await syncUnblockSubscription(deps(), subEvent(), {}, day(21));
  const ended = await load(); assert.equal(ended.enrollment.standing, 'ended'); assert.equal(ended.programme.state, 'completed');
  assert.deepEqual([ended.enrollment.next_weekly_at, ended.enrollment.next_light_at, ended.enrollment.opening_at], [null, null, null]); assert.ok(ended.enrollment.completed_at);
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(28)}, next_light_at=${day(28)}`; assert.equal((await claimUnblock(deps(), day(28))).length, 0);
  // Coming back: a new subscription starts a fresh billing month and the programme carries on.
  providerSub = stripe({ subscriptionId: 'sub_new' });
  await syncUnblockSubscription(deps(), { id: 'e4', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', client_reference_id: (await load()).enrollment.checkout_reference, subscription: 'sub_new', customer: 'cus_ub' } } }, {}, day(30));
  const back = await load(); assert.equal(back.enrollment.standing, 'active'); assert.equal(back.programme.state, 'active'); assert.equal(back.enrollment.subscription_id, 'sub_new');
});

test('cancel, billing portal, refresh and account deletion all go through the provider; pause is calls-only and never touches billing', options, async () => {
  await enroll(); await activate();
  assert.equal(await cancelUnblock(deps(), hash, day(1)), 'cancelled'); assert.equal(cancels, 1);
  const c = await load(); assert.equal(c.enrollment.cancel_at_period_end, true); assert.equal(c.enrollment.standing, 'active');
  assert.equal(await unblockPortal(deps(), hash), 'https://billing.stripe.com/p/unblock'); assert.equal(portals, 1);
  providerSub = stripe({ cancelAtPeriodEnd: false }); await refreshUnblock(deps(), hash, day(2)); assert.equal((await load()).enrollment.cancel_at_period_end, false, 'a change made in the portal shows after returning');
  await repo().command(hash, { type: 'pause' }, 'pause-1'); const paused = await load();
  assert.equal(paused.programme.state, 'paused'); assert.equal(cancels, 1); assert.equal(portals, 1); assert.equal(paused.enrollment.standing, 'active', 'billing is unchanged by a pause');
  await db!.sql`update unblock_enrollments set next_weekly_at=${day(7)}`; assert.equal((await claimUnblock(deps(), day(7))).length, 0, 'calls stop straight away');
  await repo().command(hash, { type: 'resume' }, 'resume-1', undefined, day(8)); assert.ok((await load()).enrollment.next_weekly_at! > day(8), 'resuming plans the next call');
  const exported = await composeExport(db!.store, phone, loadScript(), { includeBeliefs: true, includeUnblock: true }); assert.ok(exported!.body.includes('sub_ub') && exported!.body.includes('calls_per_month'), 'the owner download includes the Unblock subscription');
  cancels = 0; providerSub = stripe(); assert.equal(await deleteAccount(deps(), phone, hash), true); assert.equal(cancels, 1, 'deleting the account cancels the Unblock subscription');
  assert.equal((await db!.sql`select count(*)::int as n from unblock_enrollments`)[0]!['n'], 0);
});

test('checkout carries the enrolment reference and exists only when the product is configured', options, async () => {
  await enroll(); const ref = (await load()).enrollment.checkout_reference;
  assert.equal(new URL(unblockCheckout(ref)).searchParams.get('client_reference_id'), ref); assert.equal(new URL(unblockCheckout(ref)).hostname, 'buy.stripe.com');
  process.env['UNBLOCK_CHECKOUT_URL'] = 'https://evil.example/pay'; assert.equal(unblockCheckout(ref), '', 'only provider-owned HTTPS hosts');
  process.env['UNBLOCK_CHECKOUT_URL'] = 'https://buy.stripe.com/synthetic'; delete process.env['STRIPE_SECRET_KEY']; assert.equal(unblockCheckout(ref), '', 'no provider key, no checkout');
});

/** One call through the real path: claim at its planned time, place, stage the saves, signed completion. */
async function held(at: Date, saves: [string, Record<string, unknown>][]) {
  const [s] = await claimUnblock(deps(), at); assert.ok(s, 'a call should be claimed at ' + at.toISOString());
  await db!.sql`update call_attempts set status='placed',provider_call_id=${'conv-' + s.id} where id=${s.id}`;
  const turns: string[] = [];
  for (const [said, fields] of saves) { turns.push(...said.split('|')); await unblockTool(deps(), { session_id: s.id, session_token: token(s.id), event_id: 'ev-' + (++events), caller_text: said.split('|').join(' '), confirmed: true, ...fields }, at); }
  const result = await settleUnblock(payload('conv-' + s.id, turns), deps(), undefined, at);
  return { s, result };
}
const stepFor = (n: number): [string, Record<string, unknown>] => [`I will take step ${n}. Yes.`, { command: 'step', text: `take step ${n}` }];
const noLight = () => db!.sql`update unblock_enrollments set light_weekdays='{}', light_minute=null, next_light_at=null`;

test('a month of three calls: spread across the billing month, the third is the close with a personal sign-off context for the real next chapter and call', options, async () => {
  await enroll({ calls: 3 }); await activate(); await noLight();
  assert.deepEqual(await repo().setCalls(hash, 6, now), { applied: 'next_chapter' });
  const stamp = async () => (await load()).enrollment.next_weekly_at!.toISOString().slice(0, 16);
  assert.equal(await stamp(), '2026-11-10T17:00', 'spread over the month: first call on the first slot');
  const one = await held(new Date('2026-11-10T17:00:00Z'), [stepFor(2)]);
  assert.equal(one.s.week, 1); assert.equal(one.result!.status, 'completed');
  assert.equal(await stamp(), '2026-11-24T17:00', 'then the middle of what is left');
  const two = await held(new Date('2026-11-24T17:00:00Z'), [stepFor(3)]); assert.equal(two.s.week, 2);
  assert.equal(await stamp(), '2026-12-08T17:00', 'the close lands on the last slot of the month');
  let sent: { dynamic_variables: Record<string, string> } | undefined;
  const fetcher: typeof fetch = async (_u, init) => { sent = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ conversation_id: 'conv-close' })); };
  await tickUnblock(deps(), new Date('2026-12-08T17:00:00Z'), fetcher);
  const context = JSON.parse(sent!.dynamic_variables['unblock_context']!);
  assert.equal(context.is_close, true); assert.equal(context.chapter.calls_this_month, 3); assert.equal(context.chapter.number, 1); assert.equal(context.sign_off.mode, 'continue');
  assert.equal(context.sign_off.next_chapter_title, 'The First Mile'); assert.match(context.sign_off.next_call_local, /Friday 11 December/, 'the real first call of the next month (six calls use Tuesday and Friday)');
  assert.equal(context.call_context.preferred_name, 'Synthetic tester'); assert.ok(context.chapter_theme.includes('closing call')); assert.ok(context.month_words.steps.length >= 1);
  assert.deepEqual(Object.keys(sent!.dynamic_variables).sort(), ['call_kind', 'session_id', 'session_token', 'unblock_context', 'week'], 'the declared variables are unchanged');
});

test('the close: staged and verified, it completes the chapter; nothing is placed until the billing month ends; the new chapter uses the pending calls', options, async () => {
  await enroll({ calls: 2 }); await activate(); await noLight();
  await repo().setCalls(hash, 5, now);
  assert.equal((await load()).enrollment.next_weekly_at!.toISOString(), '2026-11-17T17:00:00.000Z', 'two calls: the first in the middle of the month');
  await held(new Date('2026-11-17T17:00:00Z'), [stepFor(2)]);
  const closeAt = (await load()).enrollment.next_weekly_at!; assert.equal(closeAt.toISOString(), '2026-12-08T17:00:00.000Z');
  const close = await held(closeAt, [['Home is here. Keep the mornings. Yes.', { command: 'closing', text: 'Home is here', carry_text: 'Keep the mornings' }]]);
  assert.equal(close.s.week, 2); assert.equal(close.result!.status, 'completed');
  const done = await load(); assert.equal(chapterComplete(done.programme), true); assert.equal(done.programme.state, 'active');
  assert.equal(done.enrollment.next_weekly_at!.toISOString(), '2026-12-11T17:00:00.000Z', 'the next chapter starts with the next billing month; five calls use a second day (Friday)');
  assert.equal(done.enrollment.calls_per_month, 2); assert.equal(done.enrollment.pending_calls_per_month, 5);
  assert.equal((await claimUnblock(deps(), new Date('2026-12-09T17:00:00Z'))).length, 0);
  const next = await held(done.enrollment.next_weekly_at!, [stepFor(2)]);
  assert.equal(next.s.week, 1); const rolled = await load();
  assert.equal(rolled.programme.month, 2); assert.equal(rolled.programme.chapterCalls, 5); assert.equal(rolled.programme.weeksHeld, 1); assert.deepEqual([rolled.enrollment.chapter, rolled.enrollment.year, rolled.enrollment.calls_per_month, rolled.enrollment.pending_calls_per_month], [2, 1, 5, null]);
  assert.equal(rolled.programme.closings!.length, 1); assert.equal(rolled.programme.closing, null); assert.equal(rolled.programme.steps.filter(s => s.month === 2).length, 1);
  assert.equal(rolled.enrollment.chapter_started_at!.toISOString(), '2026-12-10T10:00:00.000Z');
});

test('a missed close is offered at the next slot, even in the next month, before a new chapter starts', options, async () => {
  await enroll({ calls: 4 }); await activate(); await noLight();
  await held(new Date('2026-11-10T17:00:00Z'), [stepFor(2)]);
  // Every later slot is missed (no answer): nothing is made up, and the same chapter is offered again, now as its close.
  const lateSlot = new Date('2026-12-15T17:00:00Z');
  await db!.sql`update unblock_enrollments set next_weekly_at=${lateSlot}`;
  const [s] = await claimUnblock(deps(), lateSlot); assert.ok(s);
  assert.equal(s.week, 2, 'the same call number, not a new chapter'); assert.equal((await load()).programme.month ?? 1, 1);
  assert.equal((await load()).programme.chapterCalls, 2, 'the call being offered is the close of the month that ended');
  assert.equal((await load()).enrollment.next_weekly_at!.toISOString(), '2026-12-22T17:00:00.000Z', 'if it is missed too, the next regular slot offers it again');
});

test('the voice path and the account share one set of scheduling rules, including the second day of five or more calls a month', options, async () => {
  await enroll({ calls: 4, lightMinute: 1100 }); await activate();
  await db!.sql`update callers set slot_weekday=4, slot_minute=1080, timezone='Europe/Oslo' where phone_hash=${hash}`;
  await assert.rejects(() => repo().setCalls(hash, 6, now), /calls_too_close/); // Friday 18:00 second day vs Friday 18:20 light call
  await db!.sql`update unblock_enrollments set light_minute=1140`;
  await db!.sql`update unblock_enrollments set next_weekly_at=${now}`;
  const [s] = await claimUnblock(deps(), now); assert.ok(s);
  const say = (said: string, fields: Record<string, unknown>) => unblockTool(deps(), { session_id: s.id, session_token: token(s.id), event_id: 'ev-' + (++events), caller_text: said, confirmed: true, ...fields }, now);
  await assert.rejects(() => say('Tuesday at ten past six. Yes.', { command: 'light_schedule', days: 'tue', time: '18:10' }), /calls_too_close/);
  await assert.rejects(() => say('Thursday at ten past six. Yes.', { command: 'light_schedule', days: 'thu', time: '18:10' }), /calls_too_close|base_calls_too_close/);
  process.env['UNBLOCK_COVERAGE_START'] = '08:00'; process.env['UNBLOCK_COVERAGE_END'] = '20:00';
  await assert.rejects(() => say('Monday at nine at night. Yes.', { command: 'light_schedule', days: 'mon', time: '21:00' }), /outside_coverage/);
  process.env['UNBLOCK_COVERAGE_START'] = '00:00'; process.env['UNBLOCK_COVERAGE_END'] = '24:00';
  const fine = await say('Monday at eight in the evening. Yes.', { command: 'light_schedule', days: 'mon', time: '20:00' }); assert.equal(fine['provisional'], true);
  // With a pending change to six calls a month the voice path also respects the Friday call.
  await db!.sql`update unblock_enrollments set pending_calls_per_month=6, light_weekdays='{1}', light_minute=1200 where phone_hash=${hash}`;
  await assert.rejects(() => say('Friday at ten past six. Yes.', { command: 'light_schedule', days: 'fri', time: '18:10' }), /calls_too_close/);
  // A stale or tampered write (a change that became invalid before the signed completion) is refused rather than committed.
  await assert.rejects(() => repo().command(hash, { type: 'light_schedule', days: [2], minute: 1090 }, 'sneaky'), /calls_too_close/);
});

test('the opening call is extra: chapter one still has all of its calls, and the first regular call is at least five days later', options, async () => {
  await enroll({ calls: 4, programme: emptyProgramme() }); await activate(now); await noLight();
  await db!.sql`update unblock_enrollments set next_weekly_at=${now}, opening_at=null`;
  const opening = await held(now, [['I want to learn to sail. Yes.', { command: 'wish', text: 'learn to sail' }]]);
  assert.equal(opening.s.kind, 'opening'); const after = await load();
  assert.equal(after.programme.openingHeld, true); assert.equal(after.programme.weeksHeld, 0); assert.equal(after.programme.chapterCalls, 4);
  assert.ok(+after.enrollment.next_weekly_at! - +now >= 5 * 86400_000);
  assert.ok(after.enrollment.next_weekly_at! < new Date('2026-12-10T10:00:00Z'));
});
