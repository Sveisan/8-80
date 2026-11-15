import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, confirmsAction, type Turn } from '../src/call/outcome.ts';
import { loadScript } from '../src/script.ts';
const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const map = script.get('read.first.keep')!.replace('{{eight}}', 'playing games').replace('{{eighty}}', 'time outdoors').replace('{{goals}}', 'enjoy life');
const action = script.get('next.confirm')!.replace('{{commitment}}', 'read a book');
const outcome = (turns: Turn[]) => settle({ providerCallId: 'fictional-spoken-agreement', durationMs: 180_000, turns }, script).outcome;

test('leading speech fillers do not change a fresh map approval after complete read-back', () => {
  for (const answer of ['Yes.', 'Uh, yes.', 'Um, yeah, that is right.', 'Uh, yeah, I guess so.']) {
    assert.equal(outcome([a(map), c(answer), a(script.get('onboarding.confirmed')!)])?.onboardingComplete, true, answer);
  }
});
test('filler-only, unfinished and correction replies remain unconfirmed maps', () => {
  for (const answer of ['Uh.', 'Um, I...', 'Uh, can you repeat that?', 'Um, no.', 'Uh, yes, but change the last part.']) {
    assert.notEqual(outcome([a(map), c(answer), a(script.get('onboarding.confirmed')!)])?.onboardingComplete, true, answer);
  }
});
test('fresh action approval tolerates speech fillers without accepting courtesy or booking changes', () => {
  assert.equal(outcome([a(action), c('Um, yes, that is the action.')])?.commitment, 'read a book');
  for (const answer of ['Uh, okay.', 'Um, thanks.', 'Uh, maybe.', 'Um, yes, but not that action.', 'Uh, yes, change my weekly call to Tuesday at four.']) {
    assert.equal(outcome([a(action), c(answer)])?.commitment, undefined, answer);
  }
});
test('exact activity repetition and no-action choices retain the same meaning after fillers', () => {
  assert.equal(confirmsAction([c('Uh, yes, move the exercise class to Friday.')], 'move the exercise class to Friday'), true);
  const none = outcome([c('Um, I do not want an action this week.'), a(script.get('next.none')!)]);
  assert.equal(none?.noAction, true);
  assert.equal(none?.actionState, 'declined');
});
test('a filled negative answer cannot leak the rejected proposal into the recap', () => {
  const result = outcome([c('Read a book.'), a(action), c('Um, no thanks.')]);
  assert.equal(result?.commitment, undefined);
  assert.equal(result?.proposedAction, undefined);
});
