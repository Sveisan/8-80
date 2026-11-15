import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import process from 'node:process';
import console from 'node:console';
import { URLSearchParams } from 'node:url';
import { checkSandbox } from './guards.mjs';

const { fetch, AbortSignal } = globalThis;
process.umask(0o077);
const state = 'output/unblock-sandbox';
const env = parse(readFileSync(state + '/private.env', 'utf8'));
checkSandbox({ databaseUrl: 'postgres://postgres@127.0.0.1:55586/unblock_sandbox', publicUrl: 'https://127.0.0.1:8793', stripeKey: env.STRIPE_SECRET_KEY, checkout: env.UNBLOCK_CHECKOUT_URL });
const resources = JSON.parse(readFileSync(state + '/stripe-resources.private.json', 'utf8'));
const local = JSON.parse(readFileSync(state + '/state.private.json', 'utf8'));
const api = async (route, method = 'GET', fields) => {
  const response = await fetch('https://api.stripe.com/v1' + route, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(fields ? { body: new URLSearchParams(fields) } : {}),
  });
  if (!response.ok) throw Error('Test provider inspection failed (HTTP ' + response.status + ').');
  const value = await response.json(); if (value.livemode === true) throw Error('A live object is forbidden.'); return value;
};
// Claimable test keys intentionally cannot read account-level settings. Verify
// ownership through the task-created test product instead of broadening access.
const product = await api('/products/' + resources.product);
if (product.livemode !== false || product.metadata?.purpose !== 'unblock-private-sandbox') throw Error('Unexpected Stripe sandbox product.');
if (process.argv[2] === 'cleanup') {
  const list = await api('/subscriptions?status=all&limit=100');
  if (list.has_more) throw Error('Refusing incomplete cleanup enumeration.');
  let cancelled = 0;
  for (const sub of list.data) {
    if (sub.livemode !== false || !sub.items.data.some(i => i.price.product === resources.product)) continue;
    if (sub.status !== 'canceled') { await api('/subscriptions/' + sub.id, 'DELETE'); cancelled++; }
  }
  const link = await api('/payment_links/' + resources.paymentLink);
  if (link.livemode !== false) throw Error('Unexpected checkout mode.');
  await api('/payment_links/' + resources.paymentLink, 'POST', { active: 'false' });
  const proof = { testSubscriptionsCancelled: cancelled, checkoutDeactivated: true, realFundsMoved: false, productionCredentialsUsed: false, at: new Date().toISOString() };
  writeFileSync(state + '/cleanup-proof.json', JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} else if (process.argv[2] === 'proof') {
  if (!local.enrollment?.subscription_id) throw Error('A real test checkout must complete first.');
  const sub = await api('/subscriptions/' + local.enrollment.subscription_id);
  if (sub.livemode !== false) throw Error('Unexpected subscription mode.');
  const invoice = await api('/invoices/' + sub.latest_invoice);
  const proof = { livemode: sub.livemode, standing: sub.status, renewalCancelled: sub.cancel_at_period_end, invoicePaid: invoice.status === 'paid', amountPaid: invoice.amount_paid, currency: invoice.currency, appStanding: local.enrollment.standing, at: new Date().toISOString() };
  writeFileSync(state + '/provider-proof.json', JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} else throw Error('Use proof or cleanup.');
