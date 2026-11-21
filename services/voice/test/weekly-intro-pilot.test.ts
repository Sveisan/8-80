import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { controlPlane } from '../src/control.ts';
import { tick } from '../src/loop/tick.ts';
import { settleConversation } from '../src/loop/settle.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { accountState } from '../src/link/account.ts';
import { invitationLinks, redeemOffer } from '../src/weekly/intro-pilot.ts';
import { stripePilotCheckout } from '../src/billing/pilot-checkout.ts';
import { syncBilling } from '../src/billing/service.ts';
import type { Change } from '../src/billing/types.ts';

const opened = await openTestDb('weekly_intro_pilot');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const texts: string[] = [];
const attempts: string[] = [];
const phone = '+4794700000';
const hash = phoneKey(phone);
const offsetDays = (days: number) => new Date(Date.now() + days * 86400_000);

Object.assign(process.env, {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'), PUBLIC_URL: 'https://8and80.example',
  SIGNUP_OPEN: '1', WEEKLY_PILOT_INTAKE: '1', WEEKLY_FRIEND_INVITES: '1', WEEKLY_PILOT_INVITE_SECRET: 'synthetic-invitation-token-for-pilot-testing',
  TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'fixture', SMS_FROM_NUMBER: '+4794700999',
  BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'fixture', STRIPE_WEBHOOK_SECRET: 'fixture',
  STRIPE_WEEKLY_PILOT_PRICE_ID: 'price_fixture', STRIPE_WEEKLY_PILOT_COUPON_ID: 'intro_fixture',
});
const links = invitationLinks('https://8and80.example');
const token = (key: keyof typeof links) => new URL(links[key]).searchParams.get('invite')!;
const deps = (): LoopDeps => ({
  store: db!.store, scheduler: new Scheduler(db!.sql), script,
  sms: { send: async (_to, body) => { texts.push(body); } },
  agent: { placeCall: async () => {
    const id = 'pilot_call_' + (attempts.length + 1);
    attempts.push(id);
    return { conversationId: id, status: 'pending' };
  } } as unknown as LoopDeps['agent'],
  mailer: { send: async () => {} },
  billing: {
    subscription: async () => ({ event: 'invoice.paid', subscriptionId: 'sub_pilot', customerId: 'cus_pilot', provider: 'stripe',
      status: 'active', standing: 'active', cancelAtPeriodEnd: false, endsAt: offsetDays(30).toISOString() }),
    cancel: async () => { throw Error('Unexpected cancellation'); },
    portal: async () => { throw Error('Unexpected portal'); },
  },
});
after(async () => { await db?.close(); });

test('pilot link authorizes signup, preserves the draft and spends the seat only after SMS proof', options, async () => {
  const server = controlPlane(deps(), 'test');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const fields = { phone, name: 'Fixture', email: 'pilot@example.com', weekday: '4', time: '16:30', timezone: 'Europe/Oslo' };
  const post = (body: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(body), redirect: 'manual' as const });
  try {
    assert.match(await (await fetch(base + '/start')).text(), /taking bookings by invitation/);
    assert.equal((await fetch(base + '/start', post(fields))).status, 409);
    assert.equal(texts.length, 0);
    const landing = await fetch(base + '/start?invite=' + token('pilot'));
    assert.equal(landing.headers.get('referrer-policy'), 'no-referrer');
    const html = await landing.text();
    assert.match(html, /NOK 189 for the first paid month and NOK 249/);
    assert.doesNotMatch(html, /30 days free/);
    const booking = await fetch(base + '/start', post({ ...fields, invite: token('pilot') }));
    const draft = /name="draft" value="([^"]+)"/.exec(await booking.text())?.[1];
    const code = texts[0]?.match(/\b\d{6}\b/)?.[0];
    assert.ok(draft && code);
    assert.equal((await db!.sql`select * from weekly_invite_redemptions`).length, 0);
    const editing = await fetch(base + '/start/edit', post({ draft }));
    assert.match(await editing.text(), /name="invite"/);
    const verified = await fetch(base + '/start/verify', post({ phone, draft, code }));
    assert.equal(verified.status, 303);
    const cookie = verified.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.equal((await db!.sql`select used from weekly_invite_redemptions where invitation='pilot'`)[0]?.['used'], 1);
    const me = await (await fetch(base + '/me', { headers: { cookie } })).text();
    assert.match(me, /Your first call is free/);
    assert.doesNotMatch(me, /Continue for NOK 189/);

    process.env['WEEKLY_PILOT_INTAKE'] = '0';
    const friendLanding = await (await fetch(base + '/start?invite=' + token('friend-1'))).text();
    assert.match(friendLanding, /30 days, with up to four free calls/);
    assert.doesNotMatch(friendLanding, /NOK 189/);
    assert.match(await (await fetch(base + '/start?invite=' + token('pilot'))).text(), /taking bookings by invitation/);
  } finally {
    process.env['WEEKLY_PILOT_INTAKE'] = '1';
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('the shared link has eight seats and each friend link has its own single seat', options, async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => redeemOffer(db!.sql, token('pilot'))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 7);
  assert.equal(await redeemOffer(db!.sql, token('friend-1')), 'friend');
  await assert.rejects(redeemOffer(db!.sql, token('friend-1')));
  assert.equal(await redeemOffer(db!.sql, token('friend-2')), 'friend');
  await assert.rejects(redeemOffer(db!.sql, token('pilot') + 'x'));
});

function event(id: string, substantive: boolean) {
  return {
    event: 'conversation.completed', conversation_id: id, status: 'completed',
    duration_ms: substantive ? 350_000 : 9000,
    messages: [{ role: 'assistant', content: 'Is this a good moment?' },
      { role: 'user', content: substantive ? 'Yes, I wanted to think about what matters to me.' : 'Hello?' }],
  };
}

async function runCall(userHash: string, substantive: boolean) {
  const now = new Date();
  await db!.sql`update callers set next_call_at=${now} where phone_hash=${userHash}`;
  assert.equal((await tick(deps(), now)).placed, 1);
  const id = attempts.at(-1)!;
  const eventual = await settleConversation(event(id, substantive), deps(), undefined, now);
  assert.equal((await settleConversation(event(id, substantive), deps(), undefined, now)).handled, false);
  return eventual;
}

test('a short interrupted call can be rebooked, and completion uses the free call once', options, async () => {
  assert.equal((await runCall(hash, false)).status, 'interrupted');
  let s = await accountState(db!.sql, hash);
  assert.equal(s?.weeklyFreeCallsUsed, 0);
  assert.equal(s.canCall, true);
  assert.equal((await runCall(hash, true)).status, 'completed');
  s = await accountState(db!.sql, hash);
  assert.equal(s?.weeklyFreeCallsUsed, 1);
  assert.equal(s.canCall, false);
  assert.equal(s.next, undefined);
  const now = new Date();
  await db!.sql`update callers set next_call_at=${now} where phone_hash=${hash}`;
  assert.equal((await tick(deps(), now)).placed, 0);
});

test('friends cannot get a fifth call or a checkout', options, async () => {
  const friend = '+4794700001';
  const friendHash = phoneKey(friend);
  await db!.store.upsertProfile(friend, {});
  await db!.store.startTrial(friend, offsetDays(30));
  await new Scheduler(db!.sql).setSlot(friend, { weekday: 4, minute: 720, timezone: 'Europe/Oslo' });
  await db!.sql`update callers set weekly_offer='friend' where phone_hash=${friendHash}`;
  for (let i = 1; i <= 4; i++) {
    assert.equal((await runCall(friendHash, true)).status, 'completed');
    const s = await accountState(db!.sql, friendHash);
    assert.equal(s?.weeklyFreeCallsUsed, i);
    assert.equal(s.canCall, i < 4);
  }
  assert.equal(await stripePilotCheckout(db!.sql, friendHash), undefined);
  const now = new Date();
  await db!.sql`update callers set next_call_at=${now} where phone_hash=${friendHash}`;
  assert.equal((await tick(deps(), now)).placed, 0);

  const expired = '+4794700002';
  await db!.store.upsertProfile(expired, {});
  await db!.store.startTrial(expired, offsetDays(-1));
  await db!.sql`update callers set weekly_offer='friend', next_call_at=${now} where phone_hash=${phoneKey(expired)}`;
  assert.equal((await accountState(db!.sql, phoneKey(expired)))?.canCall, false);
  assert.equal((await tick(deps(), now)).placed, 0);
});

test('Stripe checkout applies the one-time amount and only matched paid checkout unlocks calls', options, async () => {
  let creations = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    switch (path) {
      case '/v1/prices/price_fixture':
        return Response.json({ active: true, currency: 'nok', unit_amount: 24900, tax_behavior: 'inclusive', recurring: { interval: 'month', interval_count: 1 } });
      case '/v1/checkout/sessions': {
        creations++;
        assert.equal(init?.method, 'POST');
        const body = new URLSearchParams(String(init.body));
        assert.equal(body.get('line_items[0][price]'), 'price_fixture');
        assert.equal(body.get('discounts[0][coupon]'), 'intro_fixture');
        assert.equal(body.get('client_reference_id'), hash);
        return Response.json({ id: 'cs_fixture', url: 'https://checkout.stripe.com/c/pay/fixture', currency: 'nok', amount_total: 18900 });
      }
      case '/v1/checkout/sessions/cs_fixture':
        return Response.json({ status: 'open', url: 'https://checkout.stripe.com/c/pay/fixture' });
      default: throw Error('Unexpected Stripe request');
    }
  };
  const urls = await Promise.all([stripePilotCheckout(db!.sql, hash, fetcher), stripePilotCheckout(db!.sql, hash, fetcher)]);
  assert.deepEqual(urls, ['https://checkout.stripe.com/c/pay/fixture', 'https://checkout.stripe.com/c/pay/fixture']);
  assert.equal(creations, 1);
  const paid: Change = { event: 'checkout.session.completed', provider: 'stripe', phoneHash: hash, subscriptionId: 'sub_pilot',
    customerId: 'cus_pilot', status: 'paid', checkout: { id: 'cs_fixture', currency: 'nok', amount: 18900, mode: 'subscription' } };
  assert.equal((await syncBilling(deps(), { ...paid, status: 'unpaid' })).matched, false);
  assert.equal((await syncBilling(deps(), { ...paid, checkout: { ...paid.checkout!, amount: 24900 } })).matched, false);
  assert.equal((await accountState(db!.sql, hash))?.canCall, false);
  assert.equal((await syncBilling(deps(), paid)).standing, 'active');
  assert.equal((await accountState(db!.sql, hash))?.canCall, true);
});
