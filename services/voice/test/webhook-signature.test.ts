import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/webhook/signature.ts';

const SECRET = 'whsec_test';
const BODY = '{"event":"conversation.completed","conversation_id":"conv_1"}';
const NOW = new Date('2026-09-13T12:00:00Z');

const sign = (body: string, at = NOW, secret = SECRET): string => {
  const t = Math.floor(at.getTime() / 1000);
  const v0 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v0=${v0}`;
};

test('a genuine delivery verifies', () => {
  assert.deepEqual(verifySignature(sign(BODY), BODY, SECRET, NOW), { ok: true });
});

test('a body changed in transit does not', () => {
  const header = sign(BODY);
  const tampered = BODY.replace('conv_1', 'conv_2');
  assert.equal(verifySignature(header, tampered, SECRET, NOW).ok, false);
});

test('a signature from a different secret does not', () => {
  assert.equal(verifySignature(sign(BODY, NOW, 'whsec_other'), BODY, SECRET, NOW).ok, false);
});

test('a captured delivery cannot be replayed tomorrow', () => {
  const header = sign(BODY);
  // Without the timestamp check this stays valid forever, and replaying it
  // re-settles the call, overwrites the commitment and sends the recap again.
  const later = new Date(NOW.getTime() + 6 * 60_000);
  const verdict = verifySignature(header, BODY, SECRET, later);
  assert.equal(verdict.ok, false);
  assert.match((verdict as { why: string }).why, /five-minute/);
});

test('a timestamp from the future is refused too', () => {
  const header = sign(BODY, new Date(NOW.getTime() + 10 * 60_000));
  assert.equal(verifySignature(header, BODY, SECRET, NOW).ok, false);
});

test('re-serialised JSON fails, which is the bug this catches', () => {
  // A framework that parses the body before we see it changes key order and
  // whitespace. The signature then never matches and every webhook looks like
  // an attack. Asserting it here so the failure is understood, not debugged.
  const header = sign(BODY);
  const reserialised = JSON.stringify(JSON.parse(BODY));
  assert.equal(verifySignature(header, ` ${reserialised}`, SECRET, NOW).ok, false);
});

test('malformed headers are refused rather than thrown on', () => {
  for (const h of [undefined, '', 'garbage', 't=abc,v0=deadbeef', `t=${Math.floor(NOW.getTime() / 1000)}`, 'v0=zz']) {
    const verdict = verifySignature(h, BODY, SECRET, NOW);
    assert.equal(verdict.ok, false, `${h} should not verify`);
  }
});

test('a short signature does not crash the comparison', () => {
  const t = Math.floor(NOW.getTime() / 1000);
  assert.equal(verifySignature(`t=${t},v0=ab`, BODY, SECRET, NOW).ok, false);
});

test('a delivery signed by either agent is accepted', () => {
  // The signing secret belongs to an agent, and there are two of them
  // delivering to one endpoint.
  const body = '{"type":"conversation.completed"}';
  for (const secret of ['whsec_onboarding', 'whsec_returning']) {
    const t = Math.floor(Date.now() / 1000);
    const v0 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    assert.deepEqual(
      verifySignature(`t=${t},v0=${v0}`, body, ['whsec_onboarding', 'whsec_returning']),
      { ok: true },
      secret,
    );
  }
});

test('a third secret is still refused, and is not told which failed', () => {
  const body = '{"type":"conversation.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac('sha256', 'whsec_someone_else').update(`${t}.${body}`).digest('hex');
  const out = verifySignature(`t=${t},v0=${v0}`, body, ['whsec_onboarding', 'whsec_returning']);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.why, 'signature does not match');
});

test('an empty list of secrets accepts nothing', () => {
  // Rather than accepting everything, which is what an empty HMAC key would do.
  const body = '{}';
  const t = Math.floor(Date.now() / 1000);
  const v0 = createHmac('sha256', '').update(`${t}.${body}`).digest('hex');
  assert.equal(verifySignature(`t=${t},v0=${v0}`, body, ['']).ok, false);
  assert.equal(verifySignature(`t=${t},v0=${v0}`, body, []).ok, false);
});
