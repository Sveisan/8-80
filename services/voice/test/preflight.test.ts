import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../src/preflight.ts';

// The self-hosted Grok path, which is what `stress` runs. The Speechify path
// is a separate deployment with its own fixture below.
const base = {
  VOICE_PROVIDER: 'grok',
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
  const f = fails({
    VOICE_PROVIDER: 'grok',
    TELEPHONY_PROVIDER: 'twilio',
    VOICE_WS_PUBLIC_URL: 'wss://x.example.com',
  } as NodeJS.ProcessEnv);
  assert.ok(f.includes('TWILIO_ACCOUNT_SID'));
  assert.ok(f.includes('XAI_API_KEY'));
});

test('a text from a different number than the call is refused', () => {
  const f = fails({ ...base, SPEECHIFY_CALLER_ID_NUMBER: '+4790000001', SMS_FROM_NUMBER: '+4790000002' });
  assert.ok(f.some((l) => l.includes('different numbers')));
});

test('the same number for both passes', () => {
  const same = { ...base, SPEECHIFY_CALLER_ID_NUMBER: '+4790000001', SMS_FROM_NUMBER: '+4790000001' };
  assert.ok(!fails(same).some((l) => l.includes('different numbers')));
});

test('half a group is caught, because half is the dangerous state', () => {
  // Invisible in a per-variable list — each name reads as present or absent on
  // its own — and until recently it stopped the tick that places the calls.
  assert.ok(fails({ ...base, RESEND_API_KEY: 're_x' }).some((l) => l.includes('recap email is half configured')));
  const noToken = { ...base, SMS_FROM_NUMBER: '+4790000001', TWILIO_AUTH_TOKEN: '' };
  assert.ok(fails(noToken).some((l) => l.includes('missed-call text is half configured')));

  // All of it, or none of it, is fine.
  assert.ok(!fails({ ...base, SMS_FROM_NUMBER: '+4790000001' }).some((l) => l.includes('half configured')));
  assert.ok(!fails(base).some((l) => l.includes('half configured')));
});

test('Twilio credentials without an SMS number are not a fault', () => {
  // The account SID and auth token are shared with the telephony adapter.
  // Holding them and no SMS number is what using Twilio for voice looks like,
  // and reporting it would train somebody to ignore the whole report.
  assert.ok(!fails(base).some((l) => l.includes('half configured')));
});

const speechify = {
  VOICE_PROVIDER: 'speechify',
  SPEECHIFY_API_KEY: 'sk-x',
  SPEECHIFY_AGENT_ID: 'agent_returning',
  SPEECHIFY_FIRST_CALL_AGENT_ID: 'agent_first',
  SPEECHIFY_WEBHOOK_SECRET: 'whsec_a,whsec_b',
  DATABASE_URL: 'postgres://x',
  DATA_ENCRYPTION_KEY: 'k',
  PUBLIC_URL: 'https://8and80.me',
  // Part of a working deployment, not an extra. Unset, the platform picks a
  // caller ID per call and one not authorised on the trunk comes back as SIP
  // 403 on some calls and not others — which read as a flaky carrier for four
  // days. See the check in preflight.ts.
  SPEECHIFY_CALLER_ID_NUMBER: '+15074805619',
} as NodeJS.ProcessEnv;

test('the Speechify deployment is checked on its own terms', () => {
  // It shares no variables with the Grok path. Checking both at once reported
  // half a dozen failures for a stack nobody was running, and nothing about
  // the one they were.
  assert.deepEqual(fails(speechify), []);
  const grokOnly = ['XAI_API_KEY', 'VOICE_WS_PUBLIC_URL', 'TELNYX_API_KEY', 'OUTBOUND_CALLER_NUMBER'];
  for (const key of grokOnly) {
    assert.ok(!fails(speechify).some((l) => l.includes(key)), `${key} is not part of this deployment`);
  }
});

test('an unpinned caller ID is a failure, because it is how calls die', () => {
  const without = { ...speechify };
  delete without['SPEECHIFY_CALLER_ID_NUMBER'];
  assert.ok(fails(without).some((l) => l.includes('SPEECHIFY_CALLER_ID_NUMBER')));
});

test('the variables that silently lose a call are required', () => {
  for (const key of ['SPEECHIFY_WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY', 'DATABASE_URL', 'PUBLIC_URL']) {
    const without = { ...speechify };
    delete without[key];
    assert.ok(fails(without).includes(key), key);
  }
});

test('a missing first-call agent is a note, not a failure', () => {
  // It falls back to the returning agent, so calls still happen — they just
  // open "Hello again" at somebody who has never been called.
  const without = { ...speechify };
  delete without['SPEECHIFY_FIRST_CALL_AGENT_ID'];
  assert.deepEqual(fails(without), []);
  assert.ok(preflight(without).some((c) => c.label.includes('no separate first-call agent')));
});

test('a caller id that is not E.164 is caught here rather than at 08:30', () => {
  assert.ok(
    fails({ ...speechify, SPEECHIFY_CALLER_ID_NUMBER: '90008800' }).some((l) => l.includes('not E.164')),
  );
});

test('the one-number rule and the half-configured groups apply to Speechify too', () => {
  assert.ok(
    fails({ ...speechify, SPEECHIFY_CALLER_ID_NUMBER: '+4790000001', SMS_FROM_NUMBER: '+4790000002' }).some((l) =>
      l.includes('different numbers'),
    ),
  );
  assert.ok(fails({ ...speechify, RESEND_API_KEY: 're_x' }).some((l) => l.includes('half configured')));
});

test('a text number with no caller id is still two numbers to the caller', () => {
  // The mismatch is as real when one side is the platform's default: they get
  // a call from one number and a text from another.
  const unpinned: NodeJS.ProcessEnv = { ...speechify, SMS_FROM_NUMBER: '+4790000001' };
  delete unpinned['SPEECHIFY_CALLER_ID_NUMBER'];
  assert.ok(fails(unpinned).some((l) => l.includes('the text has a number and the call does not')));
});

test('a non-Norwegian SMS sender is noted, not failed', () => {
  // It works well enough to test the plumbing with, and is wrong to ship.
  const usNumber = {
    ...speechify,
    TWILIO_ACCOUNT_SID: 'ACxxxx',
    TWILIO_AUTH_TOKEN: 'secret',
    SPEECHIFY_CALLER_ID_NUMBER: '+15074805619',
    SMS_FROM_NUMBER: '+15074805619',
  };
  assert.ok(preflight(usNumber).some((c) => c.label.includes('to Norwegian numbers')));
  assert.deepEqual(fails(usNumber), [], 'a note, not a failure — it is a real setup, just not the final one');
});

test('a key declared twice in .env is found, because the last one wins', async () => {
  // dotenv takes the last value, so an empty line further down silently
  // erases the one somebody filled in — and the file then behaves exactly as
  // though they had never set it. Three keys in .env.example were like this.
  const { duplicateKeys } = await import('../src/preflight.ts');
  assert.deepEqual(
    duplicateKeys(['A=1', '# a comment', 'B=2', '', 'A=', 'C=3'].join('\n')),
    ['A'],
  );
  assert.deepEqual(duplicateKeys('A=1\nB=2\n'), []);
  // Whitespace and export-style lines are still declarations.
  assert.deepEqual(duplicateKeys('  A=1\nA =2\n'), ['A']);
  // A value containing an = is not a second key.
  assert.deepEqual(duplicateKeys('A=b=c\nB=1\n'), []);
});

test('.env.example does not declare anything twice', async () => {
  // It is the file everybody copies. A duplicate here is a duplicate in
  // every deployment made from it.
  const { duplicateKeys } = await import('../src/preflight.ts');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repoRoot } = await import('../src/config.ts');
  assert.deepEqual(duplicateKeys(readFileSync(resolve(repoRoot, '.env.example'), 'utf8')), []);
});
