import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../src/preflight.ts';

const base = {
  TELEPHONY_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'secret',
  XAI_API_KEY: 'xai-x',
  OUTBOUND_CALLER_NUMBER: '+15551234567',
  STRESS_TEST_TARGET_NUMBER: '+4790008800',
  VOICE_WS_PUBLIC_URL: 'wss://voice.example.com',
} as NodeJS.ProcessEnv;

const fails = (env: NodeJS.ProcessEnv) => preflight(env).filter((c) => !c.ok).map((c) => c.label);

test('a complete twilio setup passes', () => {
  assert.deepEqual(fails(base), []);
});

test('a phone-number SID pasted as the account SID is caught', () => {
  const f = fails({ ...base, TWILIO_ACCOUNT_SID: 'PN0808d0ad' });
  assert.ok(f.some((l) => l.includes('ACCOUNT_SID looks wrong')));
});

test('numbers must be E.164 — the commonest way a dial fails', () => {
  for (const bad of ['90008800', '+47 900 08 800', '0047-90008800']) {
    assert.ok(fails({ ...base, STRESS_TEST_TARGET_NUMBER: bad }).some((l) => l.includes('not E.164')), bad);
  }
});

test('a localhost websocket URL is rejected — the carrier cannot reach it', () => {
  assert.ok(fails({ ...base, VOICE_WS_PUBLIC_URL: 'wss://localhost:8080' }).some((l) => l.includes('is local')));
});

test('http and ws schemes are rejected', () => {
  assert.ok(fails({ ...base, VOICE_WS_PUBLIC_URL: 'https://voice.example.com' }).some((l) => l.includes('must be wss')));
});

test('an international pair surfaces the geo-permissions trap', () => {
  const notes = preflight(base).filter((c) => c.label === 'international call');
  assert.equal(notes.length, 1);
  assert.match(notes[0]?.detail ?? '', /geo permissions/i);
});

test('missing keys are named individually, not as one failure', () => {
  const f = fails({ TELEPHONY_PROVIDER: 'twilio', VOICE_WS_PUBLIC_URL: 'wss://x.example.com' } as NodeJS.ProcessEnv);
  assert.ok(f.includes('TWILIO_ACCOUNT_SID'));
  assert.ok(f.includes('XAI_API_KEY'));
});
