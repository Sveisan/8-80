import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventOf, toTranscript, UnreadablePayload } from '../src/webhook/speechify.ts';
import { settle } from '../src/call/outcome.ts';
import { loadScript } from '../src/script.ts';

const script = loadScript();

const payload = {
  event: 'conversation.completed',
  conversation_id: 'conv_01m21by5nben2adjh1k10t2rh0',
  duration_ms: 742_000,
  recording_url: null,
  status: 'completed',
  messages: [
    { role: 'assistant', content: 'Hello again.' },
    { role: 'user', content: 'I got out on the Monday.' },
  ],
};

test('a completed conversation becomes a transcript', () => {
  const t = toTranscript(payload);
  assert.equal(t.providerCallId, 'conv_01m21by5nben2adjh1k10t2rh0');
  assert.equal(t.durationMs, 742_000);
  assert.deepEqual(
    t.turns.map((x) => x.speaker),
    ['agent', 'caller'],
  );
});

test('only the two events we act on are recognised', () => {
  assert.equal(eventOf(payload), 'conversation.completed');
  assert.equal(eventOf({ event: 'conversation.failed' }), 'conversation.failed');
  assert.equal(eventOf({ event: 'conversation.started' }), undefined);
  assert.equal(eventOf({}), undefined);
});

test('an unknown speaker throws rather than being dropped', () => {
  // Dropping it would remove caller turns, and a transcript with no caller
  // turns is how settle() recognises a call nobody could hear. The mapper
  // would be manufacturing that diagnosis out of its own confusion.
  assert.throws(
    () => toTranscript({ ...payload, messages: [{ role: 'operator', content: 'x' }] }),
    UnreadablePayload,
  );
});

test('a renamed or missing field throws rather than reading as an empty call', () => {
  for (const broken of [
    { ...payload, messages: undefined },
    { ...payload, duration_ms: undefined },
    { ...payload, conversation_id: undefined },
    { ...payload, messages: 'not an array' },
    null,
    'nope',
  ]) {
    assert.throws(() => toTranscript(broken), UnreadablePayload, JSON.stringify(broken));
  }
});

test('the silent call, as it would actually arrive', () => {
  // What the real failure looked like: agent spoke from the first second,
  // caller never did, fifteen seconds, and a status of Succeeded.
  const silent = {
    event: 'conversation.completed',
    conversation_id: 'conv_01m21by5nben2adjh1k10t2rh0',
    duration_ms: 15_000,
    status: 'completed',
    messages: [{ role: 'assistant', content: 'Hi — this is the 8 and 80 call. Is now still a good moment?' }],
  };
  const outcome = settle(toTranscript(silent), script);
  assert.equal(outcome.status, 'silent');
  assert.equal(outcome.outcome, undefined);
});
