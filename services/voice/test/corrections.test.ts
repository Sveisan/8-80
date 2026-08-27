import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CorrectionBuffer, classifyOverlap, detectCorrectionPhrase } from '../src/call/corrections.ts';

test('correction phrases are caught', () => {
  for (const s of ['let me finish', 'no, I meant Wednesday', "that's not what I said", 'hold on']) {
    assert.ok(detectCorrectionPhrase(s), `missed: ${s}`);
  }
  assert.equal(detectCorrectionPhrase('I went for a run'), null);
});

test('"mhm" over the agent is a backchannel, not an interruption', () => {
  assert.equal(classifyOverlap('mhm', 400, 700).type, 'backchannel');
  assert.equal(classifyOverlap('mhm', 2000, 700).type, 'backchannel');
});

test('a real overlap is an interruption and produces a patience note', () => {
  const v = classifyOverlap('no wait, that is not what I meant at all', 1500, 700);
  assert.equal(v.type, 'interruption');
  if (v.type === 'interruption') assert.match(v.correction.note, /wait longer/i);
});

test('the buffer keeps one note per kind — no apology pile-up', () => {
  const b = new CorrectionBuffer();
  b.add({ kind: 'correction_phrase', note: 'a', at: 1 });
  b.add({ kind: 'correction_phrase', note: 'b', at: 2 });
  assert.equal(b.all.length, 1);
  assert.match(b.render(), /Adjustments for the rest of this call/);
});

test('an empty buffer renders nothing', () => {
  assert.equal(new CorrectionBuffer().render(), '');
});
