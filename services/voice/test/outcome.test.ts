import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { settle, type CallTranscript } from '../src/call/outcome.ts';

const script = loadScript();

const call = (t: Partial<CallTranscript>): CallTranscript => ({
  providerCallId: 'conv_test',
  turns: [],
  durationMs: 900_000,
  ...t,
});

const readBack = (script.get('next.confirm') ?? '')
  .replace('{{commitment}}', 'run three times')
  .replace('{{day}}', 'Wednesday');

test('a call nobody could hear is caught, though it reported success', () => {
  const s = settle(
    call({
      durationMs: 15_000,
      endedReason: 'Caller hung up',
      turns: [{ speaker: 'agent', text: 'Hi — this is the 8 and 80 call. Is now still a good moment?' }],
    }),
    script,
  );
  assert.equal(s.status, 'silent');
  assert.equal(s.outcome, undefined, 'a week that did not happen must not be written down as one');
});

test('a call where our own side never spoke is a different failure', () => {
  const s = settle(call({ durationMs: 4_000, endedReason: 'no answer', turns: [] }), script);
  assert.equal(s.status, 'failed');
});

test('a real call yields the commitment from the read-back', () => {
  const s = settle(
    call({
      turns: [
        { speaker: 'agent', text: 'What happened?' },
        { speaker: 'caller', text: 'I got out on the Monday and then it fell apart.' },
        { speaker: 'agent', text: readBack },
      ],
    }),
    script,
  );
  assert.equal(s.status, 'completed');
  assert.equal(s.outcome?.commitment, 'run three times');
  assert.equal(s.outcome?.day, 'wednesday');
});

test('a call that reached no commitment is completed, not failed', () => {
  const s = settle(
    call({
      turns: [
        { speaker: 'agent', text: 'What happened?' },
        { speaker: 'caller', text: "I've not been sleeping much." },
        { speaker: 'agent', text: 'Mm.' },
      ],
    }),
    script,
  );
  // Most of what this call is for happens on weeks like this one.
  assert.equal(s.status, 'completed');
  assert.equal(s.outcome?.commitment, undefined);
  assert.equal(s.note, 'no commitment was reached');
});

test('a long call where the caller said nothing is not called silent', () => {
  // Fifteen minutes with no caller turn is a transcription failure, not a dead
  // line, and guessing "silent" would send someone a wrong apology.
  const s = settle(
    call({ durationMs: 900_000, turns: [{ speaker: 'agent', text: 'Hello again.' }] }),
    script,
  );
  assert.equal(s.status, 'completed');
});
