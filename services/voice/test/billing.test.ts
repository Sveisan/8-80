import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadScript } from '../src/script.ts';
import { readLemonWebhook, verifyLemonSignature, STANDING } from '../src/billing/lemonsqueezy.ts';
import { composeTrialEnded, checkoutLink } from '../src/billing/notice.ts';
import { letterHtml } from '../src/recap/letter.ts';
import { composeRecap } from '../src/recap/compose.ts';

const script = loadScript();
const SECRET = 'whsec_lemon';
const sign = (body: Buffer, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

const delivery = (status: string, custom?: Record<string, string>) =>
  Buffer.from(
    JSON.stringify({
      meta: { event_name: 'subscription_updated', ...(custom ? { custom_data: custom } : {}) },
      data: { id: '904231', type: 'subscriptions', attributes: { status, customer_id: 55, ends_at: null } },
    }),
  );

test('an unsigned or wrongly signed delivery is refused', () => {
  const body = delivery('active');
  assert.equal(verifyLemonSignature({}, body, SECRET).ok, false);
  assert.equal(verifyLemonSignature({ 'x-signature': sign(body, 'other') }, body, SECRET).ok, false);
  assert.equal(verifyLemonSignature({ 'x-signature': 'not hex' }, body, SECRET).ok, false);
  // No secret configured must fail closed, not open.
  assert.equal(verifyLemonSignature({ 'x-signature': sign(body) }, body, '').ok, false);
});

test('a correctly signed delivery is accepted, under any of the header names', () => {
  const body = delivery('active');
  for (const header of ['x-signature', 'x-lemonsqueezy-signature', 'signature']) {
    assert.equal(verifyLemonSignature({ [header]: sign(body) }, body, SECRET).ok, true, header);
  }
});

test('a changed body fails, one byte at a time', () => {
  const body = delivery('active');
  const signature = sign(body);
  const tampered = Buffer.from(body.toString('utf8').replace('"active"', '"expired"'));
  assert.equal(verifyLemonSignature({ 'x-signature': signature }, tampered, SECRET).ok, false);
});

test('a cancellation does not end the calls', () => {
  // Cancelling at Lemon Squeezy means "do not renew". The subscription runs to
  // the end of the period they have already paid for, and ending the calls the
  // day somebody cancels takes away a month they bought.
  assert.equal(STANDING['cancelled'], 'active');
  assert.equal(STANDING['expired'], 'ended');
  assert.equal(STANDING['on_trial'], 'active');
  assert.equal(STANDING['past_due'], 'past_due');
});

test('a status we have never seen does not silently end somebody', () => {
  const read = readLemonWebhook({}, JSON.parse(delivery('some_new_status').toString('utf8')));
  assert.ok(read.ok);
  // Not 'ended'. This file was written without their documentation, so an
  // unknown status must fail towards still calling somebody rather than
  // towards cutting off a paying customer.
  assert.equal(read.change.standing, 'past_due');
});

test('the phone hash is what ties their row to ours', () => {
  const read = readLemonWebhook({}, JSON.parse(delivery('active', { phone_hash: 'abc123' }).toString('utf8')));
  assert.ok(read.ok);
  assert.equal(read.change.phoneHash, 'abc123');
  assert.equal(read.change.subscriptionId, '904231');
  assert.equal(read.change.customerId, '55');
  assert.equal(read.change.standing, 'active');
});

test('an unreadable payload comes back with its shape, not a shrug', () => {
  const read = readLemonWebhook({}, { nothing: 'we recognise' });
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.ok(read.shape.includes('nothing'), read.shape);
});

test('the event name is taken from the header when the body has none', () => {
  const read = readLemonWebhook({ 'x-event-name': 'subscription_created' }, { data: { id: '1' } });
  assert.ok(read.ok);
  assert.equal(read.change.event, 'subscription_created');
});

test('the checkout link carries our key and their email', () => {
  const before = process.env['LEMONSQUEEZY_CHECKOUT_URL'];
  try {
    process.env['LEMONSQUEEZY_CHECKOUT_URL'] = 'https://8and80.lemonsqueezy.com/buy/abc';
    const link = checkoutLink('hash123', 'e@example.com');
    assert.ok(link.includes('checkout%5Bcustom%5D%5Bphone_hash%5D=hash123'), link);
    assert.ok(link.includes('checkout%5Bemail%5D=e%40example.com'), link);
    delete process.env['LEMONSQUEEZY_CHECKOUT_URL'];
    assert.equal(checkoutLink('hash123'), '', 'unconfigured means no link, not a broken one');
  } finally {
    if (before === undefined) delete process.env['LEMONSQUEEZY_CHECKOUT_URL'];
    else process.env['LEMONSQUEEZY_CHECKOUT_URL'] = before;
  }
});

test('the trial-ended letter is the same letter, with one link', () => {
  const letter = composeTrialEnded(script, 'https://pay.example/x');
  assert.ok(letter);
  const html = letterHtml(letter);
  assert.ok(html.includes('href="https://pay.example/x"'), 'it says where to continue');
  assert.ok(html.includes('8&amp;80'), 'on the same headed paper');
  assert.ok(!html.includes('<button'), 'text, not a button');
  assert.ok(letter.body.includes('https://pay.example/x'), 'and the plain-text part has it too');
});

test('the recap still has no link at all', () => {
  // The exception is one letter, not a loosening. BRAND.md §1.
  const r = composeRecap({ at: '', durationMs: 600_000, commitment: 'x', day: 'Monday' }, script, {});
  assert.ok(!letterHtml(r).includes('<a '));
});

test('an unconfigured checkout still produces a letter', () => {
  // Somebody whose trial ended must be told even if the payment link is not
  // set up yet. A silence is the one outcome that is not allowed.
  const letter = composeTrialEnded(script, '');
  assert.ok(letter);
  assert.ok(letter.subject.length);
  assert.equal(letter.action, undefined);
});
