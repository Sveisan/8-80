import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, type Turn } from '../src/call/outcome.ts';
import { weeklyPrompt } from '../src/agent/prompt-pack.ts';
import { loadScript } from '../src/script.ts';

const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const fill = (id: string, values: Record<string, string> = {}) => script.get(id)!.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key] ?? key);
const map = fill('read.first.keep', { eight: 'drawing', eighty: 'reading', goals: 'read more books' });
const action = fill('next.confirm', { commitment: 'read a book' });
const settleTurns = (turns: Turn[]) => settle({ providerCallId: 'fictional-listening', durationMs: 240_000, turns }, script);

// Fictional exchanges exercise the storage boundary. They are not a claim that
// a provider model followed its prompt, or that audio was heard on a phone.
for (const reply of [
  'Move my weekly call to Wednesday at six.',
  'Yes, move my weekly call to Wednesday at six.',
  'Yes. Can we change the time of my call',
  'Yes, Wednesday at six.',
  'Ja, flytt den ukentlige samtalen til onsdag klokken 18.',
  'Ja. Kan vi endre tidspunktet',
  'Yes, but change the action.',
  'Yes, are we done?',
]) test(`a diverted confirmation does not approve the action or the map: ${reply}`, () => {
  assert.equal(settleTurns([a(action), c(reply), a(fill('next.agreed'))]).outcome?.commitment, undefined);
  assert.equal(settle({ providerCallId: 'fictional-ordinary', durationMs: 240_000,
    turns: [a(action), c(reply), a(fill('next.agreed'))] }, script, new Date(), { strictActionAgreement: false }).outcome?.commitment, undefined);
  assert.equal(settleTurns([a(map), c(reply), a(fill('onboarding.confirmed'))]).outcome?.onboardingComplete, undefined);
});

for (const reconfirmed of [false, true]) test(`a booking clarification needs its own fresh action read-back: ${reconfirmed}`, () => {
  const turns = [a(map), c('Yes.'), a(fill('onboarding.confirmed')),
    c('Read a book.'), a(action), c('Change it to Wednesday at six.'),
    a('Do you mean your weekly call?'), c('Yes.'), a(fill('setup.change_slot')), c('Okay.')];
  if (reconfirmed) turns.push(a(action), c('Yes, that is right.'), a(fill('next.agreed')));
  turns.push(c('Goodbye.'), a('Take care.'));
  const result = settleTurns(turns);
  assert.equal(result.wantsSlotChange, true);
  assert.equal(result.callAgain, undefined);
  assert.equal(result.outcome?.commitment, reconfirmed ? 'read a book' : undefined);
  assert.equal(result.outcome?.day, undefined);
  assert.equal(result.outcome?.onboardingComplete, true);
  assert.equal(result.outcome?.eight, 'drawing');
});

test('answering a finish question can close a completed map without inventing an action or a refusal', () => {
  const result = settleTurns([a(map), c('Yes.'), a(fill('onboarding.confirmed')),
    c('Are we finished?'), a(fill('close.check')), c('Yes, goodbye.'), a('Take care.')]);
  assert.equal(result.outcome?.onboardingComplete, true);
  assert.equal(result.outcome?.commitment, undefined);
  assert.equal(result.outcome?.noAction, undefined);
});

test('current and previous slot-control explanations still request the after-call link', () => {
  for (const explanation of [fill('setup.change_slot'),
    'Your usual time stays the same for now. You can change it on your call page.',
    "I can't move it from the call yet, so it stays as it is for now. Sorry about that."]) {
    const result = settleTurns([c('Please move my weekly call.'), a(explanation)]);
    assert.equal(result.wantsSlotChange, true);
    assert.equal(result.callAgain, undefined);
    assert.equal(result.outcome?.commitment, undefined);
  }
});

test('both prompts contain the caller-choice repairs and honest booking route', () => {
  for (const first of [true, false]) {
    const prompt = weeklyPrompt(first);
    assert.ok(prompt.includes(script.get('close.check')!));
    assert.ok(prompt.includes(script.get('example.pace.reply')!));
    assert.ok(prompt.includes(script.get('setup.change_slot')!));
    assert.match(prompt, /a leading yes followed by a change request/);
    if (first) {
      assert.match(prompt, /do not ask them to choose between near-identical answers/);
      assert.match(prompt, /A short recognisable activity/);
    }
  }
});
