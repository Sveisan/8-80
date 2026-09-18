import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventOf, toTranscript, shapeOf, UnreadablePayload } from '../src/webhook/speechify.ts';
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

test('the event name is taken from the header Speechify actually sends', () => {
  // Three real calls were discarded because this read only payload.event while
  // the deliveries carried "Speechify-Event: conversation.completed".
  assert.equal(eventOf({ conversation_id: 'c' }, 'conversation.completed'), 'conversation.completed');
  assert.equal(eventOf({ conversation_id: 'c' }, 'conversation.failed'), 'conversation.failed');
  assert.equal(eventOf({}, 'conversation.started'), undefined);
});

test('the body is still read when no header arrives', () => {
  assert.equal(eventOf({ event: 'conversation.completed' }), 'conversation.completed');
  assert.equal(eventOf({ type: 'conversation.completed' }), 'conversation.completed');
  assert.equal(eventOf({ event_type: 'conversation.failed' }), 'conversation.failed');
});

test('the shape shows names and types and never a value', () => {
  const shape = shapeOf({
    data: { conversation_id: 'conv_secret', messages: [{ role: 'user', content: 'I am not sleeping' }] },
    duration_ms: 1200,
  });
  assert.ok(!shape.includes('conv_secret'), 'an id leaked');
  assert.ok(!shape.includes('not sleeping'), 'a transcript leaked');
  assert.ok(!shape.includes('user'), 'a value leaked');
  assert.match(shape, /conversation_id:string/);
  assert.match(shape, /messages:array\[1\]/);
  assert.match(shape, /duration_ms:number/);
});

test('the real delivery envelope is read', () => {
  // The shape a live conversation.completed delivery actually has:
  // { created_at, data: { evaluations, messages, object }, id, type, version }
  const t = toTranscript({
    created_at: '2026-09-18T20:38:00Z',
    id: 'evt_delivery_not_the_conversation',
    type: 'conversation.completed',
    version: '2026-09-28',
    data: {
      evaluations: [],
      messages: [
        { role: 'assistant', content: 'Hi — this is the 8 and 80 call.' },
        { role: 'user', content: 'Something funny.' },
      ],
      object: { id: 'conv_real', duration_seconds: 42, status: 'completed' },
    },
  });
  assert.equal(t.providerCallId, 'conv_real', 'the delivery id must never be used as the conversation id');
  assert.equal(t.durationMs, 42_000, 'seconds are scaled, not read as milliseconds');
  assert.equal(t.endedReason, 'completed');
  assert.deepEqual(t.turns.map((x) => x.speaker), ['agent', 'caller']);
});

test('a duration with no unit in its name is refused rather than guessed', () => {
  assert.throws(
    () => toTranscript({ data: { messages: [], object: { id: 'conv_x', duration: 42 } } }),
    UnreadablePayload,
  );
});

test('the system prompt is not a turn, and an unknown role still throws', () => {
  const t = toTranscript({
    data: {
      messages: [
        { role: 'system', content: 'You are the mentor on an 8&80 call.' },
        { role: 'assistant', content: 'Hi.' },
        { role: 'user', content: 'Something funny.' },
      ],
      object: { id: 'conv_x', duration_ms: 9000, end_reason: 'completed' },
    },
  });
  assert.deepEqual(t.turns.map((x) => x.speaker), ['agent', 'caller'], 'the prompt must not count as speech');

  assert.throws(
    () => toTranscript({ data: { messages: [{ role: 'oracle', content: 'x' }], object: { id: 'c', duration_ms: 1 } } }),
    UnreadablePayload,
    'a role nobody has seen might be a person, so it must not be dropped',
  );
});
