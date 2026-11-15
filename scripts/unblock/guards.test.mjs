import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSandbox, syntheticPhone } from './guards.mjs';

const good = { databaseUrl: 'postgres://postgres@127.0.0.1:55586/unblock_sandbox', publicUrl: 'https://127.0.0.1:8793', stripeKey: 'sk_test_synthetic', checkout: 'https://buy.stripe.com/test_synthetic' };
test('a private sandbox accepts only its separate local database and HTTPS loopback origin', () => {
  assert.equal(checkSandbox(good).publicUrl, 'https://127.0.0.1:8793');
  assert.doesNotThrow(() => checkSandbox({ ...good, stripeKey: 'rkcs_test_synthetic' }));
  for (const databaseUrl of ['postgres://postgres@127.0.0.1:55586/eight80', 'postgres://postgres@remote.example/unblock_sandbox', 'postgres://postgres@127.0.0.1:55586/unblock_sandbox?host=production.example']) assert.throws(() => checkSandbox({ ...good, databaseUrl }));
  for (const publicUrl of ['https://8and80.me', 'http://127.0.0.1:8793', 'https://user:pass@127.0.0.1:8793']) assert.throws(() => checkSandbox({ ...good, publicUrl }));
});
test('production Stripe keys and live payment links fail before startup', () => {
  for (const stripeKey of ['sk_live_synthetic', 'rk_live_synthetic', 'unexpected']) assert.throws(() => checkSandbox({ ...good, stripeKey }));
  for (const checkout of ['https://buy.stripe.com/live_link', 'https://evil.example/test_link', 'https://buy.stripe.com.evil.example/test_link']) assert.throws(() => checkSandbox({ ...good, checkout }));
  assert.doesNotThrow(() => checkSandbox({ ...good, stripeKey: '', checkout: '' }));
});
test('captured messages are limited to synthetic test identities', () => {
  assert.ok(syntheticPhone('+4792300901'));
  assert.ok(!syntheticPhone('+4790033575'));
  assert.ok(!syntheticPhone('+47923009010'));
});
