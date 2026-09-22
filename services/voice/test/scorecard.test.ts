import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { carries, parseConsoleExport, scoreCall, type TimedTurn } from '../src/call/scorecard.ts';

const script = loadScript();
const say = (id: string): string => {
  const text = script.get(id);
  assert.ok(text, `SCRIPT.md has no ${id}`);
  return text.replace(/\{\{[^}]*\}\}/g, 'Thursday');
};
const agent = (text: string): TimedTurn => ({ speaker: 'agent', text });
const caller = (text: string): TimedTurn => ({ speaker: 'caller', text });
const severity = (turns: TimedTurn[], check: string) =>
  scoreCall(script, turns).findings.find((f) => f.check === check)?.severity;

/** A first call that did everything it was meant to, in as few turns as it can. */
function goodFirstCall(): TimedTurn[] {
  return [
    agent(say('open.first.greet')),
    caller('Yes, fine.'),
    agent(say('open.first.disclosure')),
    caller('Okay.'),
    agent(`${say('open.first.frame')} ${say('open.first.first_question')}`),
    caller('The business, mostly.'),
    agent(say('work.enough')),
    caller('No, that is it.'),
    agent(say('next.ask.c')),
    caller('Two more conversations with members.'),
    agent(say('next.when')),
    caller('Thursday.'),
    agent(say('next.confirm')),
    caller('Yes.'),
    agent(say('setup.when')),
    caller('Tuesdays at nine.'),
    agent(say('close.end')),
  ];
}

test('a first call that kept its shape fails nothing', () => {
  const failed = scoreCall(script, goodFirstCall()).findings.filter((f) => f.severity === 'fail');
  assert.deepEqual(failed, [], failed.map((f) => `${f.check}: ${f.detail}`).join('\n'));
});

test('it is read as a first call because it opens on the first-call greeting', () => {
  assert.equal(scoreCall(script, goodFirstCall()).first, true);
  assert.equal(scoreCall(script, [agent(say('open.return.greet')), caller('Hi.')]).first, false);
});

test('a disclosure with a sentence missing is a failure, and says which', () => {
  const turns = goodFirstCall();
  const disclosure = say('open.first.disclosure');
  const withoutStates = disclosure.replace(/It goes through a service in the States[^.]*\./, '');
  assert.notEqual(withoutStates, disclosure, 'the test must actually remove the sentence');
  turns[2] = agent(withoutStates);
  const f = scoreCall(script, turns).findings.find((x) => x.check === 'disclosure.complete');
  assert.equal(f?.severity, 'fail');
  assert.match(f?.detail ?? '', /States/);
});

test('answering a misheard word before the disclosure is a failure; asking again is not', () => {
  // The last real call heard "Cancer." in reply to the greeting and asked about it.
  const answered = goodFirstCall();
  answered.splice(1, 0, caller('Cancer.'), agent("I'm sorry — is that what you're dealing with at the moment?"));
  assert.equal(severity(answered, 'disclosure.first'), 'fail');

  const reasked = goodFirstCall();
  reasked.splice(1, 0, caller('Cancer.'), agent(say('open.first.unclear')));
  assert.equal(severity(reasked, 'disclosure.first'), 'ok');
});

test('a frame that was skipped is a failure', () => {
  const turns = goodFirstCall();
  turns[4] = agent(say('open.first.first_question'));
  assert.equal(severity(turns, 'frame.complete'), 'fail');
});

test('drilling into the goal is counted and quoted', () => {
  const turns = goodFirstCall();
  turns.splice(
    6,
    0,
    agent('Which one has had your attention?'),
    caller('The company.'),
    agent('So the company. What happened with it this week?'),
    caller('New products.'),
    agent('You moved them forward. What, specifically, got further?'),
    caller('Validation.'),
    agent('Validation from users. Why that group?'),
    caller('They pay.'),
  );
  const card = scoreCall(script, turns);
  assert.equal(card.findings.find((f) => f.check === 'goal.exchanges')?.severity, 'fail');
  const probes = card.findings.find((f) => f.check === 'goal.probes');
  assert.equal(probes?.severity, 'fail');
  assert.match(probes?.detail ?? '', /What happened with it this week\?/);
  assert.match(probes?.detail ?? '', /Why that group\?/);
});

test('a call that never reached the slot or the close says so', () => {
  const turns = goodFirstCall().slice(0, 12);
  assert.equal(severity(turns, 'deliverable.slot'), 'fail');
  assert.equal(severity(turns, 'deliverable.close'), 'fail');
  assert.equal(severity(turns, 'deliverable.day'), 'ok');
});

test('two minutes of silence after a question is dead air; a pause to think is not', () => {
  const turns: TimedTurn[] = [
    { ...agent(say('open.first.greet')), atMs: 320_000 },
    { ...caller('Yes.'), atMs: 326_000 },
    { ...agent('Which day?'), atMs: 331_000 },
    { ...caller('Hello?'), atMs: 465_000 },
  ];
  const f = scoreCall(script, turns).findings.find((x) => x.check === 'dead_air');
  assert.equal(f?.severity, 'fail');
  assert.match(f?.detail ?? '', /Which day\?/);

  turns[3] = { ...caller('Thursday.'), atMs: 336_000 };
  assert.equal(severity(turns, 'dead_air'), 'ok');
});

test('without timestamps silence is reported as unmeasured, not as clean', () => {
  const f = scoreCall(script, goodFirstCall()).findings.find((x) => x.check === 'dead_air');
  assert.equal(f?.severity, 'warn');
  assert.match(f?.detail ?? '', /not measured/);
});

test('half a sentence abandoned under the caller is a cut-off', () => {
  const turns = goodFirstCall();
  turns.splice(6, 0, agent('The business'), caller('And the apartment.'));
  assert.equal(severity(turns, 'cut_off'), 'warn');
});

test('the console export is read, and the platform talking to itself is not', () => {
  const turns = parseConsoleExport(
    [
      '# Conversation conv_x',
      '[0:00] system: flow node entered: greeting (say)',
      '[0:00] Agent: Hi.',
      '[1:02] User: Hello?',
      '[1:02:03] Agent: Still there?',
      '[5:23] system: Backchannel ignored: "Yeah."',
    ].join('\n'),
  );
  assert.deepEqual(turns, [
    { speaker: 'agent', text: 'Hi.', atMs: 0 },
    { speaker: 'caller', text: 'Hello?', atMs: 62_000 },
    { speaker: 'agent', text: 'Still there?', atMs: 3_723_000 },
  ]);
});

test('a short line has to be said whole; a long one survives a changed word', () => {
  assert.equal(carries('Which one of those?', 'Which day?'), false);
  assert.equal(carries('Right. Which day?', 'Which day?'), true);
  assert.equal(
    carries("What are you working on right now — the thing you'd be annoyed with yourself about in a year if it stayed exactly as it is?", say('open.first.first_question')),
    true,
  );
});
