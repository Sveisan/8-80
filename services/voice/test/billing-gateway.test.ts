import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingGateway, providerUrl } from '../src/billing/gateway.ts';
import { readStripeWebhook } from '../src/billing/stripe.ts';
import { readLemonWebhook } from '../src/billing/lemonsqueezy.ts';
import { checkoutLink, composePaymentFailed } from '../src/billing/notice.ts';
import { loadScript } from '../src/script.ts';

const stripeSub = { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: 1900000000 }] } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('Stripe cancellation and portal requests use the stored customer and official API', async () => {
  process.env['STRIPE_SECRET_KEY'] = 'fixture_secret';
  const calls: { url: string; init: RequestInit }[] = [];
  const gateway = billingGateway((async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('billing_portal')) return response({ url: 'https://billing.stripe.com/p/session' });
    return response({ ...stripeSub, cancel_at_period_end: init.method === 'POST' });
  }) as typeof fetch);
  const result = await gateway.cancel('stripe', 'sub_1');
  assert.equal(result.cancelAtPeriodEnd, true); assert.equal(result.endsAt, new Date(1900000000 * 1000).toISOString());
  assert.equal(calls[1]?.init.body?.toString(), 'cancel_at_period_end=true');
  assert.equal(calls[1]?.url, 'https://api.stripe.com/v1/subscriptions/sub_1');
  const portal = await gateway.portal('stripe', 'cus_1', 'sub_1', 'https://8and80.example/me');
  assert.equal(portal, 'https://billing.stripe.com/p/session');
  assert.match(calls[2]?.init.body?.toString() ?? '', /customer=cus_1/);
  assert.match(calls[2]?.init.body?.toString() ?? '', /return_url=/);
  delete process.env['STRIPE_SECRET_KEY'];
});

test('Lemon Squeezy cancellation preserves access to ends_at and uses the signed customer portal', async () => {
  process.env['LEMONSQUEEZY_API_KEY'] = 'fixture_secret';
  const methods: string[] = [];
  const gateway = billingGateway((async (_url, init = {}) => {
    methods.push(init.method!);
    return response({ data: { type: 'subscriptions', id: '123', attributes: { customer_id: 456, status: init.method === 'DELETE' ? 'cancelled' : 'active', cancelled: init.method === 'DELETE', ends_at: '2030-03-01T00:00:00Z', urls: { customer_portal: 'https://store.lemonsqueezy.com/billing?signature=fixture' } } } });
  }) as typeof fetch);
  const cancelled = await gateway.cancel('lemonsqueezy', '123');
  assert.equal(cancelled.standing, 'active'); assert.equal(cancelled.cancelAtPeriodEnd, true);
  assert.deepEqual(methods, ['GET', 'DELETE']);
  assert.match(await gateway.portal('lemonsqueezy', '456', '123', 'https://8and80.example/me'), /^https:\/\/store\.lemonsqueezy\.com\/billing/);
  await assert.rejects(gateway.portal('lemonsqueezy', 'wrong', '123', 'https://8and80.example/me'));
  delete process.env['LEMONSQUEEZY_API_KEY'];
});

test('missing keys, failed responses, wrong objects and unconfirmed cancellation fail closed', async () => {
  delete process.env['STRIPE_SECRET_KEY'];
  const noNetwork = billingGateway((async () => { throw new Error('must not call'); }) as typeof fetch);
  await assert.rejects(noNetwork.subscription('stripe', 'sub_1'), /temporarily unavailable/);
  process.env['STRIPE_SECRET_KEY'] = 'fixture_secret';
  for (const body of [{ ...stripeSub, id: 'sub_other' }, { ...stripeSub, status: 'unknown_status' }, { ...stripeSub, cancel_at_period_end: true, items: {} }]) {
    await assert.rejects(billingGateway((async () => response(body)) as typeof fetch).subscription('stripe', 'sub_1'));
  }
  await assert.rejects(billingGateway((async () => response({}, 503)) as typeof fetch).cancel('stripe', 'sub_1'));
  await assert.rejects(billingGateway((async () => response(stripeSub)) as typeof fetch).cancel('stripe', 'sub_1'));
  delete process.env['STRIPE_SECRET_KEY'];
});

test('unrelated invoices and checkouts do not grant subscriptions', () => {
  for (const type of ['invoice.created', 'invoice.voided', 'checkout.session.expired']) {
    assert.equal(readStripeWebhook({}, { type, data: { object: { object: 'invoice', subscription: 'sub_1' } } }).ok, false);
  }
  const current = readStripeWebhook({}, { type: 'invoice.paid', data: { object: { object: 'invoice', parent: { subscription_details: { subscription: 'sub_1' } } } } });
  assert.ok(current.ok); assert.equal(current.change.subscriptionId, 'sub_1');
  const lemon = readLemonWebhook({}, { meta: { event_name: 'subscription_payment_failed' }, data: { id: 'invoice_2', type: 'subscription-invoices', attributes: { subscription_id: 123, customer_id: 456, status: 'failed' } } });
  assert.ok(lemon.ok); assert.equal(lemon.change.subscriptionId, '123'); assert.equal(lemon.change.standing, 'past_due');
});

test('checkout configuration is provider-specific and cannot redirect to arbitrary or insecure hosts', () => {
  process.env['BILLING_PROVIDER'] = 'stripe'; delete process.env['STRIPE_CHECKOUT_URL'];
  process.env['LEMONSQUEEZY_CHECKOUT_URL'] = 'https://store.lemonsqueezy.com/buy/test';
  assert.equal(checkoutLink('hash'), '');
  for (const url of ['http://buy.stripe.com/test', 'https://buy.stripe.com.evil.example/test', 'https://evil.example', 'https://user:pass@buy.stripe.com/test']) {
    assert.throws(() => providerUrl(url, 'stripe'));
    process.env['STRIPE_CHECKOUT_URL'] = url; assert.equal(checkoutLink('hash'), '');
  }
  delete process.env['BILLING_PROVIDER']; delete process.env['STRIPE_CHECKOUT_URL']; delete process.env['LEMONSQUEEZY_CHECKOUT_URL'];
});

test('a payment notice without a destination gives support instead of an absent-link promise', () => {
  const notice = composePaymentFailed(loadScript(), ''); assert.ok(notice);
  assert.equal(notice.action, undefined); assert.match(notice.body, /contact/);
  assert.doesNotMatch(notice.body, /worth a minute|Update the card/);
});

test('checkout needs the selected provider API key, signing secret and secure return destination', () => {
  const keys = ['BILLING_PROVIDER', 'STRIPE_CHECKOUT_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PUBLIC_URL'];
  const saved = keys.map(key => process.env[key]);
  try {
    process.env['BILLING_PROVIDER'] = 'stripe';
    process.env['STRIPE_CHECKOUT_URL'] = 'https://buy.stripe.com/fixture';
    process.env['STRIPE_SECRET_KEY'] = process.env['STRIPE_WEBHOOK_SECRET'] = 'fixture';
    process.env['PUBLIC_URL'] = 'https://8and80.example';
    assert.match(checkoutLink('hash'), /client_reference_id=hash/);
    for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PUBLIC_URL']) {
      const value = process.env[key]; delete process.env[key];
      assert.equal(checkoutLink('hash'), '', key); process.env[key] = value;
    }
    process.env['PUBLIC_URL'] = 'http://8and80.example'; assert.equal(checkoutLink('hash'), '');
    process.env['PUBLIC_URL'] = 'https://8and80.example';
    process.env['BILLING_PROVIDER'] = 'misspelled'; assert.equal(checkoutLink('hash'), '');
  } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});
