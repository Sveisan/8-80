import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScript } from '../src/script.ts';
import { dayIn, extractCommitment } from '../src/call/commitment.ts';

const script = parseScript(readFileSync(resolve(import.meta.dirname, '../../../SCRIPT.md'), 'utf8'));

test('the commitment is taken from the line where the mentor reads it back', () => {
  const c = extractCommitment("Right. Run three times, Wednesday. That's what I'll ask you about.", script);
  assert.ok(c);
  assert.equal(c.text, 'run three times');
  assert.equal(c.day, 'wednesday');
});

test('a read-back without a day still yields the commitment', () => {
  const c = extractCommitment('Right. Call my sister. That is what I will ask you about.', script);
  assert.ok(c);
  assert.match(c.text, /call my sister/);
});

test('anything that is not the read-back yields nothing', () => {
  // Next week must not open by quoting something they never said.
  assert.equal(extractCommitment('So it was all eighty, then.', script), undefined);
  assert.equal(extractCommitment('', script), undefined);
});

test('the day can be read out of a phrase that ran the slots together', () => {
  assert.equal(dayIn('run three times on Wednesday'), 'wednesday');
  assert.equal(dayIn('run three times'), undefined);
});
