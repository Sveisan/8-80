import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceRecorder, syntheticPartial } from '../src/turn/trace.ts';
import { endpointing } from '../src/config.ts';
import { replay, type Fixture } from '../src/turn/replay.ts';
import { silenceBudgetMs } from '../src/turn/endpointer.ts';

const cfg = endpointing(0.25);

test('a trace holds no words — only the shape of the speech', () => {
  const r = new TraceRecorder();
  r.speechStart(0);
  r.speechEnd(2000, "I didn't do the run because");
  const t = r.build(0.25, 9000);
  const dumped = JSON.stringify(t);
  for (const secret of ['run', 'because', 'didn', 'did']) {
    assert.ok(!dumped.includes(secret), `trace leaked the word "${secret}"`);
  }
  assert.equal(t.segments[0]?.words, 6); // i didnt do the run because
  assert.equal(t.segments[0]?.endsTrailing, true);
});

test('a rebuilt utterance produces the same budget as the real one', () => {
  const cases = [
    "I didn't do the run because",
    'Yes I went three times and it was fine',
    'Nothing',
    'mhm',
    "I've been",
  ];
  for (const real of cases) {
    const r = new TraceRecorder();
    r.speechStart(0);
    r.speechEnd(1000, real);
    const seg = r.build(0.25, 5000).segments[0];
    assert.ok(seg);
    const rebuilt = syntheticPartial(seg);
    assert.equal(
      silenceBudgetMs({ partial: rebuilt, lastTurnWasHard: false }, cfg),
      silenceBudgetMs({ partial: real, lastTurnWasHard: false }, cfg),
      `rebuilt utterance for "${real}" behaves differently`,
    );
  }
});

test('a recorded trace can be replayed as a fixture', () => {
  const recorded: Fixture = {
    id: 'recorded',
    description: 'from a call',
    lastTurnWasHard: true,
    trueEndMs: 8600,
    durationMs: 16000,
    segments: [
      { startMs: 0, endMs: 800, words: 3, endsTrailing: true, backchannel: false },
      { startMs: 3300, endMs: 4300, words: 3, endsTrailing: false, backchannel: false },
      { startMs: 7300, endMs: 8600, words: 5, endsTrailing: false, backchannel: false },
    ],
  };
  const r = replay(recorded, cfg);
  assert.equal(r.falseCut, false, 'a recorded fragmented turn must not be cut');
  assert.ok(r.endpointedAtMs !== null);
});

test('backchannel segments survive the round trip', () => {
  const r = new TraceRecorder();
  r.speechStart(0);
  r.speechEnd(300, 'mhm');
  const seg = r.build(0.25, 4000).segments[0];
  assert.ok(seg);
  assert.equal(seg.backchannel, true);
  assert.equal(syntheticPartial(seg), 'mhm');
});
