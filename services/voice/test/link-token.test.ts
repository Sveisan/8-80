import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintLink, openLink } from '../src/link/token.ts';

const SECRET = 'link_secret';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-08T06:00:00Z');

test('a link opens for the caller it was minted for', () => {
  const opened = openLink(mintLink(HASH, SECRET, NOW), SECRET, NOW);
  assert.equal(opened.ok, true);
  assert.equal((opened as { claims: { phoneHash: string } }).claims.phoneHash, HASH);
});

test('the number is never in the link', () => {
  const token = mintLink(HASH, SECRET, NOW);
  // A URL ends up in message threads, browser history and server logs.
  assert.ok(!token.includes('47'));
  assert.ok(!Buffer.from(token.split('.')[0] as string, 'base64url').toString().includes('+'));
});

test('a forged or edited link does not open', () => {
  const token = mintLink(HASH, SECRET, NOW);
  const [payload, sig] = token.split('.');
  const other = Buffer.from(JSON.stringify({ phoneHash: 'b'.repeat(64), purpose: 'reschedule', expiresAt: NOW.getTime() + 1000 })).toString('base64url');
  assert.equal(openLink(`${other}.${sig}`, SECRET, NOW).ok, false);
  assert.equal(openLink(`${payload}.${'x'.repeat((sig as string).length)}`, SECRET, NOW).ok, false);
  assert.equal(openLink(mintLink(HASH, 'a different secret', NOW), SECRET, NOW).ok, false);
});

test('a link found in an old thread has expired', () => {
  const token = mintLink(HASH, SECRET, NOW);
  const muchLater = new Date(NOW.getTime() + 8 * 24 * 3600_000);
  const opened = openLink(token, SECRET, muchLater);
  assert.equal(opened.ok, false);
  assert.match((opened as { why: string }).why, /expired/);
});

test('it can only ever move a call', () => {
  const smuggled = Buffer.from(JSON.stringify({ phoneHash: HASH, purpose: 'delete_account', expiresAt: NOW.getTime() + 1000 })).toString('base64url');
  // Even correctly signed, a purpose this code does not serve is refused.
  const forged = `${smuggled}.${mintLink(HASH, SECRET, NOW).split('.')[1]}`;
  assert.equal(openLink(forged, SECRET, NOW).ok, false);
});

test('rubbish is refused rather than thrown on', () => {
  for (const t of ['', '.', 'a.b', 'not-a-token', '....']) {
    assert.equal(openLink(t, SECRET, NOW).ok, false, t);
  }
});
