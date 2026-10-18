import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { settle, type Turn } from '../src/call/outcome.ts';
import { readBackSpan } from '../src/call/readback.ts';

const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const line = (key: string, values: Record<string, string> = {}) => script.get(key)!.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key] ?? key);
const map = line('read.first.keep', { eight: 'football and friends', eighty: 'time with family', goals: 'learn to sail' });
const action = line('next.confirm', { commitment: 'book a sailing lesson' });
const outcome = (turns: Turn[]) => settle({ providerCallId: 'synthetic', turns, durationMs: 300_000 }, script).outcome!;

test('a later Right goodbye never replaces the agreed action', () => {
  assert.equal(outcome([c('Book a sailing lesson.'), a(action), c('Yes.'), a('Right. Goodbye.')]).commitment, 'book a sailing lesson');
  assert.equal(outcome([c('Nothing today.'), a('Right. Goodbye.')]).commitment, undefined);
});

test('a map split around backchannels can be confirmed at its true ending', () => {
  const split = map.indexOf('By eighty');
  const turns = [a(map.slice(0, split)), c('Mhm.'), a(map.slice(split)), c('Yes, that is right.'), a(line('onboarding.confirmed'))];
  const result = outcome(turns);
  assert.equal(result.goals, 'learn to sail');
  assert.equal(result.onboardingComplete, true);
  assert.equal(outcome([a(map.slice(0, split)), c('Yes.'), a(map.slice(split)), a(line('onboarding.confirmed'))]).onboardingComplete, undefined);
});

test('a later corrected action split across provider messages replaces the older read-back', () => {
  const corrected = line('next.confirm', { commitment: 'call the sailing school' });
  const split = corrected.indexOf("I'll ask");
  const result = outcome([c('Book a lesson.'), a(action), c('Actually, I need to call them first.'), a(corrected.slice(0, split)), c('Mhm.'), a(corrected.slice(split)), a('Right. Goodbye.')]);
  assert.equal(result.commitment, 'call the sailing school');
});

test('eight and eighty corrections replace only their part and need fresh agreement', () => {
  for (const [field, key, value] of [['eight', 'read.first.fix_eight', 'drawing and jokes'], ['eighty', 'read.first.fix_eighty', 'a house by the sea'], ['goals', 'read.first.fix', 'learn to dance']] as const) {
    const corrected = line(key, { [field]: value });
    const turns = [a(map), c('No, one correction.'), a(corrected), c('Yes, exactly.'), a(line('onboarding.confirmed'))];
    const result = outcome(turns);
    assert.equal(result[field], value);
    assert.equal(result.onboardingComplete, true);
    assert.equal(outcome(turns.filter(t => t.text !== 'Yes, exactly.')).onboardingComplete, undefined);
  }
});

test('a later complete map supersedes older single-part corrections', () => {
  const newer = line('read.first.keep', { eight: 'making things', eighty: 'a garden', goals: 'learn to cook' });
  const split = newer.indexOf('By eighty');
  const turns = [a(map), c('Change it.'), a(line('read.first.fix_eight', { eight: 'old correction' })), a(newer.slice(0, split)), c('Mhm.'), a(newer.slice(split)), c('Yes.'), a(line('onboarding.confirmed'))];
  assert.equal(outcome(turns).eight, 'making things');
  assert.equal(outcome(turns).goals, 'learn to cook');
  assert.equal(outcome(turns).onboardingComplete, true);
  const found = readBackSpan(['!!!', newer.slice(0, split), newer.slice(split)], script.get('read.first.keep'));
  assert.equal(found?.start, 1);
  assert.equal(found?.end, 2);
});

test('negative or ambiguous speech cannot confirm the first-call map', () => {
  for (const answer of ['No, none of that is correct.', 'Yes, but the goals are wrong.', 'I need to think about it.', 'Nei, det stemmer ikke.']) {
    assert.equal(outcome([a(map), c(answer), a(line('onboarding.confirmed'))]).onboardingComplete, undefined, answer);
  }
  assert.equal(outcome([a(map), c('Ja, det stemmer.'), a(line('onboarding.confirmed'))]).onboardingComplete, true);
});

test('an explicit no-action branch supersedes a proposal; a later chosen action can replace it', () => {
  const none = a(line('next.none'));
  const declined = outcome([c('Maybe a lesson.'), a(action), c('No, no action this week.'), none, a('Right. Goodbye.')]);
  assert.equal(declined.commitment, undefined);
  assert.equal(declined.noAction, true);
  const changedMind = outcome([c('No action.'), none, c('Actually, book the lesson.'), a(action)]);
  assert.equal(changedMind.commitment, 'book a sailing lesson');
  assert.equal(changedMind.noAction, undefined);
  assert.equal(outcome([a('Hello.'), c('How are you?')]).noAction, undefined, 'missing data cannot clear memory');
});

test('a returning call with no previous action cannot manufacture an undone week', () => {
  const result = outcome([a(line('open.return.no_action')), c('A quiet week.'), a(line('block.ask')), c('There was no action to do.'), a(line('next.none'))]);
  assert.equal(result.lastWeek, undefined);
});

test('a direct refusal rejects the proposed action even without the fixed no-action line', () => {
  assert.equal(outcome([c('Maybe a lesson.'), a(action), c('No, I refuse that action.'), a('Goodbye.')]).commitment, undefined);
  const none = outcome([c('Maybe a lesson.'), a(action), c('No action this week.'), a('Goodbye.')]);
  assert.equal(none.commitment, undefined);
  assert.equal(none.noAction, true);
  assert.equal(outcome([c('No action this week.'), a('Goodbye.')]).noAction, true);
  assert.equal(outcome([a(action), c('No problem.'), a('Goodbye.')]).commitment, 'book a sailing lesson');
  const completed = outcome([a(action), c('Yes.'), a('Anything else?'), c('No.'), a('Goodbye.')]);
  assert.equal(completed.commitment, 'book a sailing lesson', 'a no to an unrelated later question is not an action refusal');
});

test('historical read-backs and current read-backs follow chronology, including after a refusal', () => {
  const legacy = 'Right. Call my sister, Thursday. Will you?';
  const chosen = outcome([c('No action.'), a(line('next.none')), c('Actually, call my sister.'), a(legacy)]);
  assert.equal(chosen.commitment, 'call my sister');
  assert.equal(chosen.day, 'thursday');
  assert.equal(chosen.noAction, undefined);
  assert.equal(outcome([c('A lesson.'), a(action), c('Actually, my sister.'), a(legacy)]).commitment, 'call my sister');
  assert.equal(outcome([c('My sister.'), a(legacy), c('Actually, the lesson.'), a(action)]).commitment, 'book a sailing lesson');
});
