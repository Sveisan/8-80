import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../src/log.ts';

/**
 * Proves the scrubbing requirement: transcript content, phone numbers and
 * email addresses never reach stdout or an error tracker.
 */
test('phone numbers never survive scrubbing', () => {
  const out = JSON.stringify(scrub({ msg: 'calling +47 900 08 800 now', to: '+4790008800' }));
  assert.ok(!out.includes('90008800'));
  assert.ok(!out.includes('900 08 800'));
  assert.match(out, /\[number\]/);
});

test('email addresses never survive scrubbing', () => {
  const out = JSON.stringify(scrub({ recap: 'sent to someone@example.com' }));
  assert.ok(!out.includes('example.com'));
  assert.match(out, /\[email\]/);
});

test('transcript-bearing keys are redacted wholesale, at any depth', () => {
  const out = JSON.stringify(
    scrub({ call: { turn: { transcript: 'I think I was avoiding it', delta: 'raw audio text' } }, summary: 'x' }),
  );
  assert.ok(!out.includes('avoiding'));
  assert.ok(!out.includes('raw audio text'));
  assert.match(out, /\[redacted:transcript\]/);
  assert.match(out, /\[redacted:summary\]/);
});

test('arrays and non-strings pass through without leaking', () => {
  const out = JSON.stringify(scrub({ nums: [1, 2, 3], ok: true, notes: ['ring +4790008800'] }));
  assert.ok(!out.includes('90008800'));
  assert.match(out, /\[number\]/);
});
