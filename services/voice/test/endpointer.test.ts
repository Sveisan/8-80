import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointing } from '../src/config.ts';
import { isBackchannel, silenceBudgetMs } from '../src/turn/endpointer.ts';

const cfg = endpointing(0.25);

test('a trailing conjunction buys much more patience than a finished sentence', () => {
  const finished = silenceBudgetMs({ partial: 'I went for the run on Tuesday', lastTurnWasHard: false }, cfg);
  const trailing = silenceBudgetMs({ partial: 'I didn\'t do the run because', lastTurnWasHard: false }, cfg);
  assert.ok(trailing > finished, `${trailing} should exceed ${finished}`);
  assert.ok(trailing >= 3000, 'must hold a mid-clause pause for at least 3s');
});

test('a one-word answer is waited out, not filled', () => {
  const oneWord = silenceBudgetMs({ partial: 'Nothing', lastTurnWasHard: false }, cfg);
  assert.ok(oneWord >= 3000, `one-word answers need room, got ${oneWord}`);
});

test('silence after a hard question is the most patient case of all', () => {
  const soft = silenceBudgetMs({ partial: 'Nothing', lastTurnWasHard: false }, cfg);
  const hard = silenceBudgetMs({ partial: 'Nothing', lastTurnWasHard: true }, cfg);
  assert.ok(hard > soft);
});

test('a 5-second thinking pause survives at default sensitivity', () => {
  const budget = silenceBudgetMs({ partial: 'I think I was', lastTurnWasHard: true }, cfg);
  assert.ok(budget >= 5000, `stress-test item 2 would be cut off: budget ${budget}ms`);
});

test('patience is bounded so a dead line cannot hang the call', () => {
  const budget = silenceBudgetMs({ partial: '', lastTurnWasHard: true, userPatienceOffsetMs: 60_000 }, cfg);
  assert.ok(budget <= cfg.maxWaitMs);
});

test('eager sensitivity is less patient than the default', () => {
  const eager = endpointing(1);
  const a = silenceBudgetMs({ partial: 'because', lastTurnWasHard: false }, cfg);
  const b = silenceBudgetMs({ partial: 'because', lastTurnWasHard: false }, eager);
  assert.ok(b < a);
});

test('backchannels are recognised and never treated as a turn', () => {
  for (const s of ['mhm', 'Mm', 'yeah', 'right', 'okay', 'uh huh']) {
    assert.ok(isBackchannel(s), `${s} should be a backchannel`);
  }
  assert.ok(!isBackchannel('no I did nothing'));
  assert.ok(!isBackchannel('Nothing'), 'a real one-word answer is not a backchannel');
});
