import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import twilio from 'twilio';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { loadScript } from '../src/script.ts';
import { Links } from '../src/link/token.ts';
import { composeExport } from '../src/legal/export.ts';
import { encrypt } from '../src/store/crypto.ts';
import { accountState } from '../src/link/account.ts';
import { syncBilling, cancelRenewal, deleteAccount } from '../src/billing/service.ts';
import { controlPlane } from '../src/control.ts';
import { sendDueFeedback } from '../src/feedback/feedback.ts';
import type { BillingGateway, Subscription } from '../src/billing/gateway.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { handleReply } from '../src/sms/missed.ts';

const opened = await openTestDb('billing_journey');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const phone = '+4795000001';
const hash = phoneKey(phone);
const script = loadScript();
const texts: string[] = [];
const letters: string[] = [];
let unavailable = false;
let failMail = false;
let cancellations = 0;
let sub: Subscription;
const billing: BillingGateway = {
  async subscription() { if (unavailable) throw new Error('synthetic provider failure'); return { ...sub }; },
  async cancel() { if (unavailable) throw new Error('synthetic provider failure'); if (!sub.cancelAtPeriodEnd) cancellations++; sub.cancelAtPeriodEnd = true; return { ...sub }; },
  async portal(provider, customer, subscription, returnUrl) { assert.equal(provider, 'stripe'); assert.equal(customer, 'cus_1'); assert.equal(subscription, 'sub_1'); assert.match(returnUrl, /\/me\?billing=return$/); if (unavailable) throw new Error('synthetic provider failure'); return 'https://billing.stripe.com/p/session_test'; },
};
const scheduler = () => new Scheduler(db!.sql);
const deps = (): LoopDeps => ({ store: db!.store, scheduler: scheduler(), script, billing, agent: {} as LoopDeps['agent'], sms: { send: async (_to, text) => { texts.push(text); } }, mailer: { send: async (_to, recap) => { if (failMail) throw new Error('synthetic mail failure'); letters.push(recap.body); } } });
const post = (body: Record<string, string>, extra: Record<string, string> = {}): RequestInit => ({ method: 'POST', redirect: 'manual', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra } });
async function enrol(paid = true): Promise<string> {
  await db!.store.upsertProfile(phone, { email: 'synthetic@example.com' });
  await scheduler().setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
  if (paid) await db!.sql`update callers set billing_status = 'active', billing_provider = 'stripe', ls_subscription_id = 'sub_1', ls_customer_id = 'cus_1', paid_until = ${new Date(sub.endsAt!)}`;
  else await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = now() + interval '20 days'`;
  return new Links(db!.sql).mint(hash);
}
async function serve(body: (base: string) => Promise<void>): Promise<void> {
  const server = controlPlane(deps(), 'test');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
beforeEach(async () => {
  if (db) await db.sql`truncate journey_events, journey_counts, message_attempts, message_outbox, callers, call_attempts, links, feedback, webhook_deliveries, signups, access_codes`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 8).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['BILLING_PROVIDER'] = 'stripe'; process.env['STRIPE_WEBHOOK_SECRET'] = 'billing_secret';
  delete process.env['STRIPE_SECRET_KEY'];
  process.env['TWILIO_AUTH_TOKEN'] = 'sms_secret';
  delete process.env['TWILIO_SMS_WEBHOOK_URL'];
  delete process.env['STRIPE_CHECKOUT_URL']; delete process.env['LEMONSQUEEZY_CHECKOUT_URL'];
  sub = { provider: 'stripe', subscriptionId: 'sub_1', customerId: 'cus_1', standing: 'active', status: 'active', event: 'customer.subscription.updated', cancelAtPeriodEnd: false, endsAt: new Date(Date.now() + 20 * 86400_000).toISOString() };
  unavailable = failMail = false; cancellations = 0; texts.length = letters.length = 0;
});
after(async () => { await db?.close(); });

test('cancellation is confirmed by the provider, preserves a pause, and cannot renew past the paid boundary', options, async () => {
  await enrol(); await scheduler().setPaused(phone, true);
  assert.equal(await cancelRenewal(deps(), hash), 'cancelled');
  assert.equal(await cancelRenewal(deps(), hash), 'cancelled');
  assert.equal(cancellations, 1);
  const state = await accountState(db!.sql, hash); assert.equal(state?.paused, true); assert.equal(state?.cancelAtPeriodEnd, true);
  await scheduler().setPaused(phone, false);
  assert.equal((await accountState(db!.sql, hash, new Date(sub.endsAt!)))?.canCall, false);
  assert.equal((await scheduler().claimDue(new Date(Date.parse(sub.endsAt!) + 1000))).length, 0);
  assert.equal(await scheduler().moveIfActive(phone, new Date(Date.parse(sub.endsAt!) + 1000)), false);
});

test('late paid events use current provider state and cannot revive an ended subscription', options, async () => {
  await enrol(); sub.standing = 'ended'; sub.status = 'canceled';
  const result = await syncBilling(deps(), { event: 'invoice.paid', provider: 'stripe', subscriptionId: 'sub_1', standing: 'active' });
  assert.equal(result.standing, 'ended');
  assert.equal((await accountState(db!.sql, hash))?.canCall, false);
});

test('signed duplicate webhooks confirm a payment once and never undo a user pause', options, async () => {
  await enrol(false); await scheduler().setPaused(phone, true);
  await serve(async base => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', client_reference_id: hash, subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } } });
    const time = Math.floor(Date.now() / 1000);
    const signature = `t=${time},v1=${createHmac('sha256', 'billing_secret').update(`${time}.${payload}`).digest('hex')}`;
    const init = { method: 'POST', headers: { 'stripe-signature': signature }, body: payload };
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/webhooks/payments`, init)).status, 200);
    assert.equal(letters.length, 1); assert.match(letters[0]!, /does not restart paused calls/);
    assert.equal((await accountState(db!.sql, hash))?.paused, true);
    const unsigned = await fetch(`${base}/webhooks/payments`, { ...init, headers: {} });
    assert.equal(unsigned.status, 401);
  });
});

test('provider failure leaves cancellation and deletion unconfirmed and preserves all identifiers', options, async () => {
  await enrol(); unavailable = true;
  await assert.rejects(cancelRenewal(deps(), hash));
  await assert.rejects(deleteAccount(deps(), phone, hash));
  assert.equal((await accountState(db!.sql, hash))?.paused, true, 'the request to leave still stops future calls');
  const [row] = await db!.sql`select ls_subscription_id, ls_customer_id, cancel_at_period_end from callers`;
  assert.deepEqual(row, { ls_subscription_id: 'sub_1', ls_customer_id: 'cus_1', cancel_at_period_end: false });
});

test('successful deletion cancels renewal before erasing account and credentials', options, async () => {
  const code = await enrol();
  await assert.rejects(db!.store.forget(phone), /billing/);
  assert.equal(await deleteAccount(deps(), phone, hash), true);
  assert.equal(cancellations, 1);
  assert.equal(await db!.store.phoneFor(hash), undefined);
  assert.equal((await new Links(db!.sql).open(code)).ok, false);
  assert.equal(await deleteAccount(deps(), phone, hash), false);
});

test('the web controls separate payment management, cancellation and pause, and report export failures', options, async () => {
  const token = await enrol();
  await serve(async base => {
    const html = await (await fetch(`${base}/r/${token}`)).text();
    assert.match(html, /value="billing-portal"/); assert.match(html, /value="cancel-renewal"/); assert.match(html, /value="stop"/);
    const portal = await fetch(`${base}/r/${token}`, post({ action: 'billing-portal' }));
    assert.equal(portal.status, 303); assert.equal(portal.headers.get('location'), 'https://billing.stripe.com/p/session_test');
    assert.equal(cancellations, 0);
    const confirm = await fetch(`${base}/r/${token}`, post({ action: 'cancel-renewal' }));
    assert.match(await confirm.text(), /value="cancel-renewal-confirm"/); assert.equal(cancellations, 0);
    await fetch(`${base}/r/${token}`, post({ action: 'cancel-renewal-confirm' }));
    assert.equal(cancellations, 1);
    const state = await accountState(db!.sql, hash); assert.equal(state?.paused, false);
    failMail = true;
    const failed = await fetch(`${base}/r/${token}`, post({ action: 'export' }));
    const failedPage = await failed.text();
    assert.equal(failed.status, 503); assert.match(failedPage, /could not send your copy/);
    assert.doesNotMatch(failedPage, /You can close this/);
  });
});

test('expired paid access is described as ended even before the provider sends its final event', options, async () => {
  const token = await enrol();
  await db!.sql`update callers set cancel_at_period_end = true, paid_until = now() - interval '1 day'`;
  await serve(async base => {
    const html = await (await fetch(`${base}/r/${token}`)).text();
    assert.match(html, /Your paid access has ended/);
    assert.doesNotMatch(html, /Your paid subscription is active|value="start"|value="move"/);
  });
});

test('remembered browsers and cross-site requests cannot cancel a subscription', options, async () => {
  const token = await enrol();
  const cookie = `browser=${await new Links(db!.sql).mint(hash, new Date(), 'browser')}`;
  await serve(async base => {
    await fetch(`${base}/me`, post({ action: 'cancel-renewal-confirm' }, { cookie }));
    const cross = await fetch(`${base}/r/${token}`, post({ action: 'cancel-renewal-confirm' }, { origin: 'https://other.example' }));
    assert.equal(cross.status, 403); assert.equal(cancellations, 0);
  });
});

test('subscription texts require a valid Twilio signature and cancel renewal rather than pause', options, async () => {
  await enrol();
  await db!.sql`update callers set slot_weekday = null, slot_minute = null`;
  await serve(async base => {
    const fields = { From: phone, Body: 'Please cancel my subscription', MessageSid: 'SM_test' };
    const unsigned = await fetch(`${base}/webhooks/sms`, post(fields));
    assert.equal(unsigned.status, 403); assert.equal(cancellations, 0);
    process.env['TWILIO_SMS_WEBHOOK_URL'] = 'https://api.8and80.example/webhooks/sms';
    const wrongHost = twilio.getExpectedTwilioSignature('sms_secret', 'https://8and80.example/webhooks/sms', fields);
    assert.equal((await fetch(`${base}/webhooks/sms`, post(fields, { 'x-twilio-signature': wrongHost }))).status, 403);
    const signature = twilio.getExpectedTwilioSignature('sms_secret', 'https://api.8and80.example/webhooks/sms', fields);
    const result = await fetch(`${base}/webhooks/sms`, post(fields, { 'x-twilio-signature': signature }));
    assert.equal(result.status, 200); assert.equal(await result.text(), '<Response/>');
    assert.equal(cancellations, 1); assert.equal((await accountState(db!.sql, hash))?.paused, false);
    assert.match(texts[0]!, /will not renew/);
  });
});

test('billing migrations classify existing identifiers without inventing paid dates or changing access', options, async () => {
  await enrol();
  await db!.sql.begin(async tx => {
    await tx`alter table callers drop column billing_provider, drop column cancel_at_period_end, drop column paid_until, drop column feedback_opt_out`;
    for (const [index, id] of ['sub_existing', '123456', 'subXunknown', null].entries()) {
      await tx`insert into callers (phone_hash, phone_enc, ls_subscription_id, billing_status, paused) values (${`migration_${index}`}, ${encrypt(`+479500009${index}`)}, ${id}, 'active', true)`;
    }
    for (const file of ['0015_billing_lifecycle.sql', '0016_feedback_preference.sql']) {
      const migration = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint').filter(s => s.trim())) await tx.unsafe(statement);
    }
    const rows = await tx`select billing_provider, billing_status, paused, paid_until, cancel_at_period_end, feedback_opt_out from callers where phone_hash like 'migration_%' order by phone_hash`;
    assert.deepEqual(rows.map(r => r['billing_provider']), ['stripe', 'lemonsqueezy', null, null]);
    for (const row of rows) {
      assert.equal(row['billing_status'], 'active'); assert.equal(row['paused'], true);
      assert.equal(row['paid_until'], null); assert.equal(row['cancel_at_period_end'], false); assert.equal(row['feedback_opt_out'], false);
    }
  });
});

test('a provider outage makes payment webhooks retry without granting access', options, async () => {
  await enrol(false); unavailable = true;
  await serve(async base => {
    const payload = JSON.stringify({ id: 'evt_outage', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', client_reference_id: hash, subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } } });
    const time = Math.floor(Date.now() / 1000);
    const signature = `t=${time},v1=${createHmac('sha256', 'billing_secret').update(`${time}.${payload}`).digest('hex')}`;
    const init = { method: 'POST', headers: { 'stripe-signature': signature }, body: payload };
    assert.equal((await fetch(`${base}/webhooks/payments`, init)).status, 503);
    assert.equal((await accountState(db!.sql, hash))?.billing, 'trialing'); assert.equal(letters.length, 0);
    unavailable = false;
    assert.equal((await fetch(`${base}/webhooks/payments`, init)).status, 200);
    assert.equal((await accountState(db!.sql, hash))?.billing, 'active'); assert.equal(letters.length, 1);
  });
});

test('exports contain remembered context and retained transcripts without authentication secrets', options, async () => {
  const token = await enrol(false);
  await db!.store.record(phone, { at: new Date().toISOString(), durationMs: 300_000, commitment: 'Book a lesson', eight: 'Football', eighty: 'Family time', goals: 'Sailing', belief: 'Nobody will pay', onboardingComplete: true });
  await db!.sql`insert into call_attempts (id, phone_hash, scheduled_for, provider_call_id, status) values ('export_attempt', ${hash}, now(), 'conv_export', 'completed')`;
  await db!.sql`insert into webhook_deliveries (id, conversation_id, body_enc) values ('delivery_export', 'conv_export', ${encrypt('Retained synthetic transcript')})`;
  const result = await composeExport(db!.store, phone, script); assert.ok(result);
  for (const text of ['Football', 'Family time', 'Sailing', 'Nobody will pay', 'Retained synthetic transcript', 'onboarding_completed_at', 'feedback_opt_out']) assert.ok(result.body.includes(text), text);
  assert.ok(!result.body.includes(token)); assert.ok(!result.body.includes('body_enc'));
});

test('an optional-feedback opt-out preserves call eligibility and suppresses future requests', options, async () => {
  const token = await enrol();
  await serve(async base => { await fetch(`${base}/r/${token}`, post({ action: 'feedback-off' })); });
  const state = await accountState(db!.sql, hash); assert.equal(state?.feedbackOptOut, true); assert.equal(state?.canCall, true); assert.equal(state?.paused, false);
  await db!.sql`insert into call_attempts (id, phone_hash, scheduled_for, ended_at, status, duration_ms) values ('feedback_attempt', ${hash}, now() - interval '15 minutes', now() - interval '10 minutes', 'completed', 600000)`;
  await sendDueFeedback(deps()); assert.equal(texts.length, 0);
});

test('unconfigured checkout stays unavailable; returning from checkout does not invent payment', options, async () => {
  const token = await enrol(false);
  await serve(async base => {
    const unavailablePage = await (await fetch(`${base}/r/${token}`)).text();
    assert.doesNotMatch(unavailablePage, /value="checkout"/);
    const returned = await fetch(`${base}/r/${token}?billing=return`);
    assert.match(await returned.text(), /waiting for billing confirmation/);
    assert.equal((await accountState(db!.sql, hash))?.billing, 'trialing');
    process.env['STRIPE_CHECKOUT_URL'] = 'https://buy.stripe.com/test';
    const incomplete = await fetch(`${base}/r/${token}`, post({ action: 'checkout' }));
    assert.equal(incomplete.status, 200); assert.equal(incomplete.headers.get('location'), null);
    process.env['STRIPE_SECRET_KEY'] = 'fixture';
    const checkout = await fetch(`${base}/r/${token}`, post({ action: 'checkout' }));
    assert.equal(checkout.status, 303); assert.match(checkout.headers.get('location')!, /client_reference_id=/);
  });
});

test('SMS START and moves cannot promise calls beyond paid access or undo a pause', options, async () => {
  await enrol(); await scheduler().setPaused(phone, true);
  const slot = (await scheduler().slotFor(phone))!;
  const now = new Date('2026-10-03T12:00:00Z');
  await db!.sql`update callers set cancel_at_period_end = true, paid_until = '2026-10-04T00:00:00Z'`;
  const [before] = await db!.sql`select paused, next_call_at, slot_weekday, slot_minute from callers`;
  const start = await handleReply(phone, 'START', slot, deps(), now);
  assert.equal(start.action, 'unchanged'); assert.match(start.said, /have not restarted/);
  const move = await handleReply(phone, 'Monday 09:00 ALWAYS', slot, deps(), now);
  assert.equal(move.action, 'unchanged'); assert.match(move.said, /could not be booked/);
  assert.deepEqual((await db!.sql`select paused, next_call_at, slot_weekday, slot_minute from callers`)[0], before);
  await db!.sql`update callers set paid_until = '2026-10-20T00:00:00Z'`;
  const resumed = await handleReply(phone, 'START', slot, deps(), now);
  assert.equal(resumed.action, 'started'); assert.match(resumed.said, /6 October/);
  assert.equal((await accountState(db!.sql, hash, now))?.paused, false);
  await db!.sql`update callers set billing_status = 'ended', paused = true`;
  assert.equal((await handleReply(phone, 'START', slot, deps(), now)).action, 'unchanged');
  assert.equal((await accountState(db!.sql, hash, now))?.paused, true);
});

test('skipping the last paid call does not describe the account as a free trial', options, async () => {
  await enrol();
  const now = new Date('2026-10-03T12:00:00Z');
  const at = new Date('2026-10-06T06:00:00Z');
  await db!.sql`update callers set next_call_at = ${at}, cancel_at_period_end = true, paid_until = '2026-10-07T00:00:00Z'`;
  const slot = (await scheduler().slotFor(phone))!;
  const result = await handleReply(phone, 'skip', slot, deps(), now, { skipAt: at });
  assert.equal(result.action, 'skipped'); assert.match(result.said, /paid access ends/);
  assert.doesNotMatch(result.said, /free month|Next call/);
});
