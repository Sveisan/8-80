import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointing } from '../src/config.ts';
import { replay, type Fixture } from '../src/turn/replay.ts';
import fixtures from './fixtures/pauses.json' with { type: 'json' };

const corpus = fixtures as Fixture[];
const cfg = endpointing(0.25);

test('no false cuts anywhere in the corpus at the shipping default', () => {
  const cuts = corpus
    .filter((f) => !f.expectNoTurn)
    .map((f) => replay(f, cfg))
    .filter((r) => r.falseCut);
  assert.deepEqual(
    cuts.map((c) => `${c.id} @${c.endpointedAtMs}ms`),
    [],
    'cutting someone off is the one failure this product cannot ship',
  );
});

test('the fragmented disclosure survives all three of its pauses', () => {
  const f = corpus.find((x) => x.id === 'quiet-disclosure-fragmented');
  assert.ok(f);
  const r = replay(f, cfg);
  assert.equal(r.falseCut, false);
  assert.ok(r.endpointedAtMs !== null && r.endpointedAtMs >= f.trueEndMs);
});

test('a backchannel never produces a turn, however long the line stays quiet', () => {
  const f = corpus.find((x) => x.id === 'backchannel-only');
  assert.ok(f);
  const r = replay(f, cfg);
  assert.equal(r.endpointedAtMs, null);
  assert.equal(r.sawBackchannelOnly, true);
});

test('patience has a price, and the price stays inside the ceiling', () => {
  for (const f of corpus.filter((x) => !x.expectNoTurn)) {
    const r = replay(f, cfg);
    assert.ok(r.latenessMs !== null, `${f.id} never endpointed`);
    assert.ok(
      r.latenessMs <= cfg.maxWaitMs,
      `${f.id} waited ${r.latenessMs}ms past the end, over the ${cfg.maxWaitMs}ms ceiling`,
    );
  }
});

test('an ordinary finished sentence is not made to wait absurdly', () => {
  const f = corpus.find((x) => x.id === 'ordinary-finished-sentence');
  assert.ok(f);
  const r = replay(f, cfg);
  assert.ok((r.latenessMs ?? 0) <= 2500, `common case waited ${r.latenessMs}ms — too slow to feel like a conversation`);
});

/**
 * A corpus that cannot fail proves nothing. At maximum eagerness the same
 * traces must break, which is what shows the harness has teeth — and is also
 * the demonstration that provider-style silence timing would cut these people
 * off.
 */
test('the corpus has teeth: at maximum eagerness it fails', () => {
  const eager = endpointing(1);
  const cuts = corpus.filter((f) => !f.expectNoTurn).map((f) => replay(f, eager)).filter((r) => r.falseCut);
  assert.ok(cuts.length > 0, 'if nothing fails at sensitivity 1.0 the harness is not measuring anything');
});

test('sensitivity is monotonic — more eager is never more patient', () => {
  const f = corpus.find((x) => x.id === 'pause-5s-midsentence');
  assert.ok(f);
  let previous = Infinity;
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    const r = replay(f, endpointing(s));
    const waited = r.budgetMs ?? 0;
    assert.ok(waited <= previous, `sensitivity ${s} was more patient than the step before it`);
    previous = waited;
  }
});
