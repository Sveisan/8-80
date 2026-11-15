import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { URLSearchParams } from 'node:url';
import { checkSandbox } from './guards.mjs';

process.umask(0o077);
const state = resolve('output/unblock-sandbox');
const { fetch, AbortSignal } = globalThis;
const raw = readFileSync(resolve(state, 'stripe-provision.private.json'), 'utf8');
const provision = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
const secret = provision.secret_key;
checkSandbox({ databaseUrl: 'postgres://postgres@127.0.0.1:55586/unblock_sandbox', publicUrl: 'https://127.0.0.1:8793', stripeKey: secret });
if (!secret || !/^acct_[A-Za-z0-9]+$/.test(provision.account_id)) throw Error('No validated Stripe test sandbox credentials.');
const path = resolve(state, 'stripe-resources.private.json');
const resources = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { account: provision.account_id };
if (resources.account !== provision.account_id) throw Error('Do not mix sandbox accounts.');
const save = () => writeFileSync(path, JSON.stringify(resources, null, 2), { mode: 0o600 });
const api = async (route, fields, idempotency) => {
  const response = await fetch('https://api.stripe.com/v1' + route, {
    method: fields ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Bearer ' + secret, ...(fields ? { 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': idempotency } : {}) },
    ...(fields ? { body: new URLSearchParams(fields) } : {}),
  });
  if (!response.ok) throw Error('Stripe sandbox request failed: ' + route + ' (HTTP ' + response.status + ').');
  const value = await response.json();
  if (value.livemode === true) throw Error('A live Stripe object is forbidden in the sandbox.');
  return value;
};
if (!resources.product) {
  const value = await api('/products', { name: '8&80 Unblock · private QA', 'metadata[purpose]': 'unblock-private-sandbox' }, 'unblock-private-qa-product-v1');
  if (value.livemode !== false) throw Error('Stripe product is not a test object.');
  resources.product = value.id; save();
}
if (!resources.price) {
  const value = await api('/prices', { product: resources.product, currency: 'nok', unit_amount: '24900', 'recurring[interval]': 'month', 'metadata[purpose]': 'unblock-private-sandbox' }, 'unblock-private-qa-price-v1');
  if (value.livemode !== false) throw Error('Stripe price is not a test object.');
  resources.price = value.id; save();
}
if (!resources.paymentLink) {
  const value = await api('/payment_links', {
    'line_items[0][price]': resources.price, 'line_items[0][quantity]': '1',
    'after_completion[type]': 'redirect', 'after_completion[redirect][url]': 'https://127.0.0.1:8793/unblock/account?billing=return',
    'metadata[purpose]': 'unblock-private-sandbox',
  }, 'unblock-private-qa-payment-link-v1');
  if (value.livemode !== false) throw Error('Stripe checkout is not a test object.');
  checkSandbox({ databaseUrl: 'postgres://postgres@127.0.0.1:55586/unblock_sandbox', publicUrl: 'https://127.0.0.1:8793', stripeKey: secret, checkout: value.url });
  resources.paymentLink = value.id; resources.checkout = value.url; save();
}
const result = spawnSync(resolve(state, 'bin/stripe'), ['listen', '--print-secret'], {
  encoding: 'utf8', timeout: 20000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: secret, STRIPE_NO_AUTO_UPDATE: '1' },
});
const signing = result.stdout?.match(/whsec_[A-Za-z0-9]+/)?.[0];
if (result.status !== 0 || !signing) throw Error('Stripe test webhook signing secret could not be prepared.');
writeFileSync(resolve(state, 'private.env'), [
  'STRIPE_SECRET_KEY=' + secret, 'STRIPE_WEBHOOK_SECRET=' + signing,
  'UNBLOCK_PRODUCT_ID=' + resources.product, 'UNBLOCK_CHECKOUT_URL=' + resources.checkout,
  'UNBLOCK_PRICE_LABEL=249 kr / month', '',
].join('\n'), { mode: 0o600 });
chmodSync(resolve(state, 'private.env'), 0o600);
writeFileSync(resolve(state, 'claim.private.json'), JSON.stringify({ claimUrl: provision.claim_url, expiresAt: provision.expires_at, accountId: provision.account_id }, null, 2), { mode: 0o600 });
console.log('Stripe test product, monthly NOK price, hosted checkout and webhook listener credentials prepared.');
console.log('No live keys, real payments, production settings or customer records were used.');
