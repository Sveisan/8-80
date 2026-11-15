import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { settle, type Turn } from '../src/call/outcome.ts';
import { composeRecap } from '../src/recap/compose.ts';
import { loadScript } from '../src/script.ts';

const script = loadScript();
const agent = (text: string): Turn => ({ speaker: 'agent', text });
const caller = (text: string): Turn => ({ speaker: 'caller', text });
const ask = (action: string) => agent(script.get('next.confirm')!.replace('{{commitment}}', action));
const call = (turns: Turn[], ordinary = false) => settle({ providerCallId: 'fictional-continuity', durationMs: 600_000, turns }, script, new Date('2026-11-15T12:00:00Z'), { strictActionAgreement: !ordinary });
const agreed = [caller('I want to visit the library.'), ask('visit the library'), caller('Yes, that is what I want you to remember.')];

test('November 9 pattern: proposed action plus more conversation is not a no-action choice', () => {
  const result = call([caller('Maybe just putting together the photos.'),
    agent("Right — putting together the photos. I'll ask how it went next time we talk."),
    caller('Can you ask me some more questions?'), agent('What mattered this week that we have not touched on?'),
    caller('A workshop.'), agent("What's one thing you'll do this week?"), caller('I answered that before.'), agent('Take care.')]);
  assert.equal(result.outcome?.commitment, undefined);
  assert.equal(result.outcome?.noAction, undefined);
  assert.equal(result.outcome?.actionState, 'unconfirmed');
  assert.equal(result.outcome?.proposedAction, 'putting together the photos');
  const recap = composeRecap(result.outcome!, script);
  assert.match(recap.body, /possible next step.*photos/i);
  assert.match(recap.body, /didn't confirm it as an agreement/);
  assert.doesNotMatch(recap.body, /no one thing|chose not|your action|I'll ask/i);
  assert.equal(recap.said, undefined);
});

test('explicit agreement survives more conversation, different questions and a reopened close', () => {
  const result = call([...agreed, agent('Take care.'), caller('Wait, can we talk a little more?'),
    agent('What was useful about the workshop?'), caller('Being with other people.'), agent('Take care.')]);
  assert.equal(result.outcome?.commitment, 'visit the library');
  assert.equal(result.outcome?.actionState, 'confirmed');
  assert.equal(result.outcome?.proposedAction, undefined);
  assert.equal(composeRecap(result.outcome!, script).said?.commitment, 'visit the library');
});

test('an unnecessary repeated read-back of the same action cannot erase its earlier agreement', () => {
  const result = call([...agreed, agent('Another topic?'), caller('A workshop.'), ask('visit the library'), caller('I already answered that.')]);
  assert.equal(result.outcome?.commitment, 'visit the library');
});

test('earlier agreement cannot approve a different proposal or a changed day', () => {
  const result = call([...agreed, caller('Actually I would rather read a book.'), ask('read a book'), caller('Can we talk about something else?')]);
  assert.equal(result.outcome?.commitment, undefined);
  assert.equal(result.outcome?.proposedAction, 'read a book');
  assert.equal(result.outcome?.actionState, 'unconfirmed');
  const changedDay = call([caller('Visit the library on Monday.'), ask('visit the library Monday'), caller('Yes.'),
    caller('Maybe Tuesday instead.'), ask('visit the library Tuesday'), caller('Let me think.')]);
  assert.equal(changedDay.outcome?.commitment, undefined);
});

test('a corrected action requires fresh agreement and then replaces the old one', () => {
  const result = call([...agreed, caller('Instead I want to read a book.'), ask('read a book'), caller('Yes, remember that.')]);
  assert.equal(result.outcome?.commitment, 'read a book');
  assert.equal(result.outcome?.actionState, 'confirmed');
});

test('explicit no-action choice and withdrawal do not resurrect an earlier agreement', () => {
  const declined = call([...agreed, caller('I do not want an action this week.'), agent('We can leave it there this week.')]);
  assert.equal(declined.outcome?.noAction, true);
  assert.equal(declined.outcome?.actionState, 'declined');
  assert.match(composeRecap(declined.outcome!, script).body, /chose not to set an action/);
  assert.equal(declined.outcome?.proposedAction, undefined);
  const withdrawn = call([...agreed, caller('Do not save that.'), ask('visit the library'), caller('I already answered.')]);
  // A withdrawal before a new proposal must not let an old yes confirm it.
  assert.equal(withdrawn.outcome?.commitment, undefined);
});

test('ordinary calls also require explicit agreement; courtesy and a time change cannot confirm', () => {
  for (const reply of ['Thanks.', 'Okay.', 'Yes, change my weekly call to Tuesday at half past four.']) {
    const result = call([caller('Do a game.'), ask('do a game'), caller(reply)], true);
    assert.equal(result.outcome?.commitment, undefined, reply);
    assert.equal(result.outcome?.actionState, 'unconfirmed');
  }
});

test('an agent-only no-action claim is not the caller declining an action', () => {
  const result = call([caller('I am still thinking.'), agent(script.get('next.none')!)], true);
  assert.equal(result.outcome?.noAction, undefined);
  assert.equal(result.outcome?.actionState, 'unconfirmed');
  assert.match(composeRecap(result.outcome!, script).body, /didn't confirm a new action/);
});

test('unconfirmed metadata never acquires the confirmed quotation or follow-up promise', () => {
  const recap = composeRecap({ at: '', durationMs: 300_000, actionState: 'unconfirmed', proposedAction: 'read a book', commitment: 'visit the library' }, script);
  assert.equal(recap.said, undefined);
  assert.doesNotMatch(recap.body, /visit the library|ask how it went/i);
  assert.match(recap.body, /possible next step.*read a book/i);
});

test('agent invention, caller refusal and unapproved corrections are omitted from proposals', () => {
  for (const [spoken, proposed, reply] of [
    ['I want to read a book.', 'redo an unchosen flyer', 'Thanks.'],
    ['I do not want to read a book.', 'read a book', 'Thanks.'],
    ['Read a book.', 'read a book', 'Yes, but not that action.'],
  ]) {
    const result = call([caller(spoken!), ask(proposed!), caller(reply!)]);
    assert.equal(result.outcome?.proposedAction, undefined);
    assert.equal(result.outcome?.commitment, undefined);
  }
});

test('latest complete read-back cannot swallow an earlier proposal and intervening conversation', () => {
  const result = call([caller('I want to apply for a job.'), agent("Right — apply for a job. I'll ask how it went next time we talk."),
    caller('Actually maybe putting together the photos.'), agent('Would you like to choose a smaller version?'),
    caller('Putting together the photos.'), agent("Right — putting together the photos. I'll ask how it went next time we talk."), caller('Can you ask more questions?')]);
  assert.equal(result.outcome?.proposedAction, 'putting together the photos');
  assert.ok(!result.outcome?.proposedAction?.includes('job'));
});

test('a repeated proposal cannot resurrect an agreement after a later withdrawal or decline', () => {
  for (const refusal of ['Do not save that.', 'I do not want an action this week.']) {
    const result = call([...agreed, agent('We can talk about the workshop.'), caller(refusal), ask('visit the library'), caller('I already answered.')]);
    assert.equal(result.outcome?.commitment, undefined);
    assert.equal(result.outcome?.proposedAction, undefined);
  }
});

test('native probe definitions use the actual reply/tool configuration contracts', () => {
  const plan = JSON.parse(readFileSync(new URL('./fixtures/weekly-continuity-probes.json', import.meta.url), 'utf8')) as { cases: { definition: { type: string; config: Record<string, unknown> } }[] };
  for (const item of plan.cases) {
    const allowed = item.definition.type === 'tool' ? ['context', 'expected_tool'] : ['context', 'success_criteria'];
    assert.deepEqual(Object.keys(item.definition.config).sort(), allowed.sort());
    if (item.definition.type === 'tool') assert.equal(item.definition.config.expected_tool, 'skip_turn');
  }
});
