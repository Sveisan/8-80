import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadScript } from '../src/script.ts';
import { readStripeWebhook, verifyStripeSignature, STANDING, stripePayments } from '../src/billing/stripe.ts';
import { STANDING as LEMON } from '../src/billing/lemonsqueezy.ts';
import { composeTrialEnded } from '../src/billing/notice.ts';
import { letterHtml } from '../src/recap/letter.ts';

const script = loadScript();
const SECRET = 'whsec_stripe';
const NOW = new Date('2026-09-26T12:00:00Z');
const seconds = Math.floor(NOW.getTime() / 1000);

const sign = (body: Buffer, t = seconds, secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')}`;

const subscription = (status: string) =>
  Buffer.from(
    JSON.stringify({
      type: 'customer.subscription.updated',
      data: { object: { object: 'subscription', id: 'sub_123', customer: 'cus_9', status, current_period_end: 1790000000 } },
    }),
  );

test('a delivery signed with the wrong secret is refused', () => {
  const body = subscription('active');
  assert.equal(verifyStripeSignature({ 'stripe-signature': sign(body, seconds, 'other') }, body, SECRET, NOW).ok, false);
  assert.equal(verifyStripeSignature({}, body, SECRET, NOW).ok, false);
  assert.equal(verifyStripeSignature({ 'stripe-signature': sign(body) }, body, '', NOW).ok, false, 'no secret fails closed');
});

test('a correctly signed delivery is accepted', () => {
  const body = subscription('active');
  assert.equal(verifyStripeSignature({ 'stripe-signature': sign(body) }, body, SECRET, NOW).ok, true);
});

test('the timestamp is checked, so a captured delivery cannot be replayed forever', () => {
  const body = subscription('active');
  const old = seconds - 10 * 60;
  const header = sign(body, old);
  assert.equal(verifyStripeSignature({ 'stripe-signature': header }, body, SECRET, NOW).ok, false);
  // And the signature over the old timestamp is still valid at the time it was made.
  assert.equal(verifyStripeSignature({ 'stripe-signature': header }, body, SECRET, new Date(old * 1000)).ok, true);
});

test('more than one v1 passes if any of them matches, which is how rotation works', () => {
  const body = subscription('active');
  const good = sign(body).split('v1=')[1] as string;
  const header = `t=${seconds},v1=${'0'.repeat(64)},v1=${good}`;
  assert.equal(verifyStripeSignature({ 'stripe-signature': header }, body, SECRET, NOW).ok, true);
});

test('cancelled means the opposite thing at the two vendors', () => {
  // At Lemon Squeezy, `cancelled` means "do not renew" and the subscription
  // runs to the end of the paid period. At Stripe, `canceled` means it is
  // already over. Carrying the first mapping to the second vendor would have
  // ended somebody's calls on the day they cancelled, taking away a month
  // they had paid for.
  assert.equal(LEMON['cancelled'], 'active');
  assert.equal(STANDING['canceled'], 'ended');
});

test('a card stuck in 3-D Secure does not cost somebody their week', () => {
  assert.equal(STANDING['incomplete'], 'past_due');
  assert.equal(STANDING['trialing'], 'active');
  assert.equal(STANDING['past_due'], 'past_due');
  assert.equal(STANDING['unpaid'], 'ended');
});

test('an unknown status fails towards still calling somebody', () => {
  const read = readStripeWebhook({}, JSON.parse(subscription('some_new_state').toString('utf8')));
  assert.ok(read.ok);
  assert.equal(read.change.standing, 'past_due');
  assert.equal(read.change.subscriptionId, 'sub_123');
  assert.equal(read.change.customerId, 'cus_9');
});

test('the checkout session is the one event that knows who this is', () => {
  // It carries client_reference_id; nothing after it does. Every later event
  // is found by the subscription id this one writes.
  const body = {
    type: 'checkout.session.completed',
    data: {
      object: {
        object: 'checkout.session',
        client_reference_id: 'hash-abc',
        subscription: 'sub_777',
        customer: 'cus_5',
        payment_status: 'paid',
      },
    },
  };
  const read = readStripeWebhook({}, body);
  assert.ok(read.ok);
  assert.equal(read.change.phoneHash, 'hash-abc');
  assert.equal(read.change.subscriptionId, 'sub_777');
  assert.equal(read.change.standing, 'active');
});

test('an expanded object is read the same as a bare id', () => {
  // Stripe sends either, depending on the event and the API version.
  const read = readStripeWebhook({}, {
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', subscription: { id: 'sub_9' }, customer: { id: 'cus_1' } } },
  });
  assert.ok(read.ok);
  assert.equal(read.change.subscriptionId, 'sub_9');
  assert.equal(read.change.customerId, 'cus_1');
});

test('a failed invoice is past_due and a paid one is active', () => {
  for (const [event, standing] of [
    ['invoice.payment_failed', 'past_due'],
    ['invoice.paid', 'active'],
  ] as const) {
    const read = readStripeWebhook({}, {
      type: event,
      data: { object: { object: 'invoice', subscription: 'sub_1', customer: 'cus_1' } },
    });
    assert.ok(read.ok, event);
    assert.equal(read.change.standing, standing, event);
    assert.equal(read.change.subscriptionId, 'sub_1');
  }
});

test('an event about something else is not acted on, and says what it was', () => {
  const read = readStripeWebhook({}, { type: 'payout.paid', data: { object: { object: 'payout', id: 'po_1' } } });
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.ok(read.why.includes('payout'), read.why);
});

test('the checkout link carries our key, and Stripe will accept the parameter', () => {
  const link = stripePayments.checkout('https://buy.stripe.com/abc', 'hash-abc', 'e@example.com');
  assert.ok(link.includes('client_reference_id=hash-abc'), link);
  assert.ok(link.includes('prefilled_email=e%40example.com'), link);
});

test('the trial letter still works whichever vendor is live', () => {
  const letter = composeTrialEnded(script, 'https://buy.stripe.com/abc?client_reference_id=x');
  assert.ok(letter);
  assert.ok(letterHtml(letter).includes('href="https://buy.stripe.com/abc?client_reference_id=x"'));
});
