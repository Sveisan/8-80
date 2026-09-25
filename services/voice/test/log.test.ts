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

test('a vendor request id survives the phone-number rule', () => {
  // `81e3d461be9037461c73342` has a digit run long enough to look like a
  // telephone number, so it was logged as `81e3d461be[number]c73342` —
  // destroying the only identifier their support can look up, in the very
  // line written to make a failure escalatable.
  const id = '81e3d461be9037461c73342';
  assert.equal(scrub(`request ${id} failed`), `request ${id} failed`);
  assert.equal(scrub('fa47e118d45cf1b8c87752bd'), 'fa47e118d45cf1b8c87752bd');
  assert.equal(scrub('MG3cf87ebf584ad7ab575f8c586507f0cd'), 'MG3cf87ebf584ad7ab575f8c586507f0cd');
});

test('and protecting ids does not let a number through', () => {
  // The exemption is 16+ hex characters with a letter among them. No phone
  // number is that long and none contains an a-f.
  assert.equal(scrub('+47 900 33 575'), '[number]');
  assert.equal(scrub('ring 4790033575 now'), 'ring [number] now');
  assert.equal(scrub('To=%2B4790033575'), 'To=%2B[number]');
  assert.equal(scrub('e@eirikn.com'), '[email]');
  // A long run of digits alone is still a number, not an id.
  assert.equal(scrub('123456789012345678'), '[number]');
  // Both in one string, each treated correctly.
  assert.equal(
    scrub('call +4790033575 request fa47e118d45cf1b8c87752bd'),
    'call [number] request fa47e118d45cf1b8c87752bd',
  );
});
