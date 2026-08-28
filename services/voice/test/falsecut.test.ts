import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FalseCutEstimator } from '../src/call/falsecut.ts';

test('resuming straight after we ended the turn counts as a cut', () => {
  const e = new FalseCutEstimator({ resumeWindowMs: 1500 });
  e.noteTurnEnd(1000);
  assert.equal(e.noteUserSpeech(1600, 'and the other thing was'), true);
  assert.equal(e.count, 1);
});

test('answering the next question normally does not count', () => {
  const e = new FalseCutEstimator({ resumeWindowMs: 1500 });
  e.noteTurnEnd(1000);
  assert.equal(e.noteUserSpeech(9000, 'yes that is right'), false);
  assert.equal(e.count, 0);
});

test('a backchannel after the endpoint is agreement, not a resumption', () => {
  const e = new FalseCutEstimator({ resumeWindowMs: 1500 });
  e.noteTurnEnd(1000);
  assert.equal(e.noteUserSpeech(1200, 'mhm'), false);
  assert.equal(e.count, 0);
});

test('one endpoint can only be blamed once', () => {
  const e = new FalseCutEstimator({ resumeWindowMs: 1500 });
  e.noteTurnEnd(1000);
  e.noteUserSpeech(1100, 'no I meant');
  e.noteUserSpeech(1200, 'the other one');
  assert.equal(e.count, 1);
});

test('a correction phrase is independent confirmation', () => {
  const e = new FalseCutEstimator();
  e.noteCorrectionPhrase();
  assert.equal(e.count, 1);
});
