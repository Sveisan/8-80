import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TwilioProvider, type TwilioLike } from '../src/adapters/telephony/twilio.ts';

function spy() {
  const calls: Record<string, unknown>[] = [];
  const fn = () => ({ update: async () => undefined });
  (fn as unknown as { create: unknown }).create = async (params: Record<string, unknown>) => {
    calls.push(params);
    return { sid: 'CAtest' };
  };
  return { client: { calls: fn as unknown as TwilioLike['calls'] }, calls };
}

const place = async () => {
  const s = spy();
  await new TwilioProvider(s.client).placeCall({
    to: '+4790000000',
    from: '+15550000000',
    ringSeconds: 25,
    streamUrl: 'wss://example.com/media?key=abc',
  });
  return s.calls[0] as Record<string, unknown>;
};

test('answering machine detection runs asynchronously', async () => {
  const p = await place();
  assert.equal(
    p['asyncAmd'],
    'true',
    'without asyncAmd Twilio blocks the TwiML until detection finishes — the stream never starts and the caller hears silence',
  );
  assert.equal(p['machineDetection'], 'Enable');
});

test('the dial carries inline TwiML, so Twilio fetches nothing from us', async () => {
  const p = await place();
  const twiml = String(p['twiml'] ?? '');
  assert.match(twiml, /<Connect>/, 'Connect, not Start — Start is one-way audio');
  assert.match(twiml, /wss:\/\/example\.com\/media\?key=abc/);
  assert.ok(!('url' in p), 'a url parameter would make Twilio fetch a webhook we do not serve');
});

test('ring duration and numbers are passed through', async () => {
  const p = await place();
  assert.equal(p['timeout'], 25);
  assert.equal(p['to'], '+4790000000');
  assert.equal(p['from'], '+15550000000');
});
