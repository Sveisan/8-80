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

/** A first call that did everything it was meant to: warm-up, the map, then the one thing. */
function goodFirstCall(): TimedTurn[] {
  return [
    agent(say('open.first.greet')),
    caller('Yes, fine.'),
    agent(say('open.first.disclosure')),
    caller('Fine by me.'),
    agent(`${say('open.first.frame')} ${say('open.first.first_question')}`),
    caller('Football, mostly. And video games.'),
    agent('Football and games — so, competitive. Which position?'),
    caller('Striker.'),
    agent(say('read.first.eighty')),
    caller('A family. Kids.'),
    agent(say('work.more')),
    caller('Somewhere with room for them, and time to be around.'),
    agent(say('work.year')),
    caller('The apartment, a stand-up set, and the business.'),
    agent(say('work.matters')),
    caller('The stand-up would be for me, nobody else.'),
    agent(say('work.else')),
    caller('No, that is it.'),
    agent(say('read.first.keep')),
    caller('Yes.'),
    agent(say('work.start')),
    caller('The stand-up set.'),
    agent(say('next.ask.first')),
    caller('Write five minutes of material.'),
    agent(say('next.when')),
    caller('Thursday.'),
    agent(say('next.confirm')),
    caller('Yes.'),
    agent(say('setup.confirm_slot')),
    caller('It does.'),
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

test('auditing a goal, or scheduling it, is counted and quoted', () => {
  const turns = goodFirstCall();
  turns.splice(
    14,
    0,
    agent('So the apartment. What happened with it this week?'),
    caller('Looked at some.'),
    agent('Right. When will you view the next listings?'),
    caller('Soon.'),
    agent('Soon. Why that area?'),
    caller('Near work.'),
  );
  const probes = scoreCall(script, turns).findings.find((f) => f.check === 'goal.probes');
  assert.equal(probes?.severity, 'fail');
  assert.match(probes?.detail ?? '', /What happened with it this week\?/);
  assert.match(probes?.detail ?? '', /When will you view the next listings\?/);
  assert.match(probes?.detail ?? '', /Why that area\?/);
});

test('going straight from the first answer to the one thing is rushed, and says so', () => {
  // The second real call: three words about an apartment and on to the task.
  const turns = [
    ...goodFirstCall().slice(0, 6),
    agent(say('work.start')),
    caller('The apartment.'),
    ...goodFirstCall().slice(22),
  ];
  const card = scoreCall(script, turns);
  assert.equal(card.findings.find((f) => f.check === 'map.rushed')?.severity, 'fail');
  assert.equal(card.findings.find((f) => f.check === 'map.eighty')?.severity, 'fail');
  assert.equal(card.findings.find((f) => f.check === 'map.readback')?.severity, 'fail');
});

test('asking for an email address on the call is a failure', () => {
  const turns = goodFirstCall();
  turns.splice(28, 0, agent('And where should the recap go — which address?'), caller('E at P-I.'));
  assert.equal(severity(turns, 'no_email_asked'), 'fail');
  assert.equal(severity(goodFirstCall(), 'no_email_asked'), 'ok');
});

test('a call that never confirmed the slot or closed says so', () => {
  const turns = goodFirstCall().slice(0, 28);
  assert.equal(severity(turns, 'deliverable.slot'), 'warn', 'skipped correctly when none was on record');
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
    carries("Let's start somewhere easy. What did you love doing when you were eight — something you'd do for no reason at all?", say('open.first.first_question')),
    true,
  );
});

test('a returning call that drills into the work is counted, and one that does not is not', () => {
  const opening = [agent(say('open.return.greet')), caller('Hi.'), agent(say('open.return.callback')), caller('Did half of it.'), agent(say('last.partial')), caller('The invites.')];
  const drill = ['Which part first?', 'When will it be done?', 'What tells you it is done?', 'What will you check first?', 'Which one is usable first?'].flatMap((q) => [agent(q), caller('Hm.')]);
  const tail = [agent(say('next.ask.c')), caller('Send the invites.')];
  assert.equal(severity([...opening, ...drill, ...tail], 'return.work_questions'), 'fail');
  assert.equal(severity([...opening, ...drill.slice(0, 4), ...tail], 'return.work_questions'), 'ok');
});

test('a new question before the last was answered is flagged; the same one again after a silence is not', () => {
  const asked = [agent(say('open.return.greet')), caller('Hi.'), agent('Did this week go anywhere near it?'), agent("What's one thing you'll do next week?")];
  assert.equal(severity(asked, 'unanswered_question'), 'fail');
  const repeated = [agent(say('open.return.greet')), caller('Hi.'), agent('Did this week go anywhere near it?'), agent('Still with me? Did this week go anywhere near it?')];
  assert.equal(severity(repeated, 'unanswered_question'), 'ok');
});
