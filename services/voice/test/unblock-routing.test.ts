import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceRouting, CURRENT_COUNTRY_QUESTION, routingFor } from '../src/unblock/routing.ts';
import { closedSnapshot, type Snapshot } from '../src/unblock/protocol.ts';
import { emptyProgramme } from '../src/unblock/model.ts';

test('routing waits for the support answer, asks the current country once and only then exposes Norwegian numbers', () => {
  const first = advanceRouting(undefined, 'I need help', true, 'first');
  assert.equal(routingFor(first)['medical_emergency'], undefined);
  assert.equal(routingFor(first)['country_question'], undefined);
  const question = advanceRouting(first, 'My brother could be with me', true, 'answer');
  assert.equal(routingFor(question)['country_question'], CURRENT_COUNTRY_QUESTION);
  assert.deepEqual(advanceRouting(question, 'My brother could be with me', true, 'answer'), question, 'retry cannot consume the question');
  const confirmed = advanceRouting(question, 'Norway', true, 'country');
  assert.deepEqual(routingFor(confirmed)['medical_emergency'], { number: '113', instruction: 'For immediate medical danger. Emergency direction does not wait for operator acknowledgement.' });
  assert.equal((routingFor(confirmed)['urgent_medical_help'] as { number: string }).number, '116 117');
  const changed = advanceRouting(confirmed, "I'm abroad", true, 'changed');
  assert.equal(routingFor(changed)['medical_emergency'], undefined);
});
for (const text of ['Norway', 'I want to visit Norway', 'I used to live in Norway', 'My brother is in Norway', "I'm not in Norway", "I'm in Oslo", "I'm in Norway. I'm in Sweden.", "I'm in Norway, but I'm actually in France", "I'm in Norway but I'm in Sweden", "I'm in Norway if I can get there"]) {
  test(`country is not inferred from non-current or ambiguous context: ${text}`, () => {
    const state = advanceRouting(undefined, text, false);
    assert.notEqual(state?.country, 'NO'); assert.equal(routingFor(state)['medical_emergency'], undefined);
  });
}
test('an explicit current-country statement earlier in this same call is reused without asking again', () => {
  const stated = advanceRouting(undefined, "I'm in Norway right now.", false, 'earlier');
  const held = advanceRouting(stated, 'I need help', true, 'held');
  const answer = advanceRouting(held, 'Yes, my brother', true, 'support');
  assert.equal(answer!.country, 'NO'); assert.equal(routingFor(answer)['country_question'], undefined);
});
test('unknown/declined country uses the neutral fallback without guessing or repeatedly asking', () => {
  let state = advanceRouting(undefined, 'I need help', true, 'held');
  state = advanceRouting(state, 'No one nearby', true, 'support');
  state = advanceRouting(state, "I'd rather not say", true, 'decline');
  assert.equal(routingFor(state)['medical_emergency'], undefined); assert.equal(routingFor(state)['country_question'], undefined);
  const p = emptyProgramme();
  const snapshot: Snapshot = { revision: 0, initial: p, programme: p, receipts: [], coverage: {}, routing: state! };
  assert.equal(closedSnapshot(snapshot, 'opening', 0).includes('routing'), false, 'country/hash metadata is scrubbed at completion');
});
test('a conflicting replay cannot retain a previously eligible local number', () => {
  const state = advanceRouting(undefined, "I'm in Norway", true, 'same');
  const conflict = advanceRouting(state, "I'm outside Norway", true, 'same');
  assert.equal(routingFor(conflict)['medical_emergency'], undefined);
});
