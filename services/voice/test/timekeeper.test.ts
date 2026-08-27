import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timekeeper } from '../src/call/timekeeper.ts';
import { parseScript } from '../src/script.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = parseScript(readFileSync(resolve(import.meta.dirname, '../../../SCRIPT.md'), 'utf8'));
const HOUR = 60 * 60_000;

test('the five-minute courtesy fires once, at a natural break', () => {
  const t = new Timekeeper(script, { limitMs: HOUR });
  assert.equal(t.due(HOUR - 4 * 60_000, true)?.mention, 'five_left');
  assert.equal(t.due(HOUR - 3 * 60_000, true), null, 'must never repeat');
});

test('it never fires mid-turn', () => {
  const t = new Timekeeper(script, { limitMs: HOUR });
  assert.equal(t.due(HOUR - 60_000, false), null);
});

test('it is suppressed after something difficult and waits for a later break', () => {
  const t = new Timekeeper(script, { limitMs: HOUR, suppressAfterSensitiveMs: 120_000 });
  const now = 1_000_000;
  t.markSensitive(now);
  assert.equal(t.due(HOUR - 60_000, true, now + 30_000), null, 'must not land on a disclosure');
  assert.ok(t.due(HOUR - 60_000, true, now + 200_000), 'should resume at a later natural break');
});

test('the limit line is the last thing said about time, ever', () => {
  const t = new Timekeeper(script, { limitMs: HOUR });
  t.due(HOUR - 60_000, true);
  assert.equal(t.due(HOUR + 1000, true)?.mention, 'limit');
  assert.equal(t.due(HOUR + 600_000, true), null);
  assert.ok(t.finished);
});

test('both lines come from SCRIPT.md, not from code', () => {
  const t = new Timekeeper(script, { limitMs: HOUR });
  assert.equal(t.due(HOUR - 60_000, true)?.text, script.get('time.five_left'));
});
