import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { buildInstructions } from '../src/prompt.ts';
import { promptPack } from '../src/agent/prompt-pack.ts';
import { settle, type Turn } from '../src/call/outcome.ts';

const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const line = (id: string, values: Record<string, string> = {}) => script.get(id)!.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key] ?? key);
const outcome = (turns: Turn[]) => settle({ providerCallId: 'synthetic-phrasing', durationMs: 300_000, turns }, script).outcome!;

test('the disclosure flows straight into the frame while availability and memory still get answers', () => {
  for (const id of ['open.first.disclosure', 'open.first.continue.disclosure']) {
    const disclosure = script.get(id)!;
    assert.match(disclosure, /AI/);
    assert.match(disclosure, /written note/);
    assert.match(disclosure, /stop me any time/);
    assert.doesNotMatch(disclosure, /\?/);
  }
  const prompt = buildInstructions(script, { callNumber: 1 });
  assert.match(prompt, /Continue directly.*SAME spoken turn/);
  assert.match(prompt, /Honour any objection or request to stop/);
  assert.match(script.get('open.first.greet')!, /Is now still a good time\?/);
  assert.match(script.get('read.first.keep')!, /Have I got that right\?/);
  assert.match(script.get('next.confirm')!, /Is that the action you want me to remember\?/);
});

test('both voices have a familiar returning opening, with no duplicate younger-self question', () => {
  for (const spec of promptPack('weekly', { SPEECHIFY_FEMALE_VOICE_ID: 'synthetic' })) {
    assert.equal(spec.firstMessage, spec.role.endsWith('first') ? "Hello — it's your 8 and 80 call. Is now still a good time?" : 'Hello again.');
  }
  const prompt = buildInstructions(script, { callNumber: 2, eight: 'games', eighty: 'family' });
  assert.match(prompt, /These are alternatives; never ask both/);
  assert.match(prompt, /Skip a follow-up they have already answered/);
  assert.match(prompt, /Default on a pause is to wait|When they stop mid-sentence.*WAIT/);
  assert.equal(script.get('silence.patience'), 'Take your time.');
  assert.equal(script.get('nothing.c'), 'Mm.');
});

test('a situation check, personalised goodbye and pronoun variants cannot record caller facts', () => {
  const result = outcome([
    a(line('open.return.situation')), c('I am at home.'),
    a(line('eight.door.he')), c('Playing football.'),
    a(line('eight.door.she')), c('Seeing friends.'),
    a(line('work.year.clarify')), c('I am still thinking.'),
    a(line('close.end', { name: 'Synthetic' })), c('Bye.'),
  ]);
  for (const key of ['eight', 'eighty', 'goals', 'commitment', 'lastWeek', 'onboardingComplete'] as const) {
    assert.equal(result[key], undefined, `${key} needs its own confirmation or result marker`);
  }
});

test('the new map and a corrected action keep their exact content after clear agreement', () => {
  const result = outcome([
    a("Let me say it back. Your eight-year-old self would love football and jokes. By eighty, you'd like time with family. And in the next three months, learn to sail. Have I got that right?"),
    c('No, change the long-term part.'), a(line('read.first.fix_eighty', { eighty: 'a home by the sea' })), c('Yes, exactly.'), a(line('onboarding.confirmed')),
    c('Book a lesson.'), a(line('next.confirm', { commitment: 'book a lesson' })), c('No, call the school first.'),
    a(line('next.confirm', { commitment: 'call the sailing school' })), c('Yes.'), a(line('next.agreed')),
  ]);
  assert.equal(result.eight, 'football and jokes');
  assert.equal(result.eighty, 'a home by the sea');
  assert.equal(result.goals, 'learn to sail');
  assert.equal(result.onboardingComplete, true);
  assert.equal(result.commitment, 'call the sailing school');
  assert.equal(result.lastWeek, undefined);
});

test('old in-flight maps and confirmations remain readable alongside new corrections', () => {
  const oldMap = 'Let me say it back. At eight, football. By eighty, family. And in the next three months, sailing. Have I got that right?';
  const oldResult = outcome([a(oldMap), c('Yes.'), a("That's the map I'll keep for next time.")]);
  assert.equal(oldResult.onboardingComplete, true);
  assert.equal(oldResult.eight, 'football');
  const corrected = outcome([a(oldMap), c('No, change eight.'), a(line('read.first.fix_eight', { eight: 'drawing' })), c('Yes.'), a(line('onboarding.confirmed'))]);
  assert.equal(corrected.eight, 'drawing');
  assert.equal(corrected.onboardingComplete, true);
  for (const response of ['Thanks.', 'Yes, but the goals are wrong.']) {
    assert.equal(outcome([a(line('read.first.keep', { eight: 'play', eighty: 'family', goals: 'sailing' })), c(response), a(line('onboarding.confirmed'))]).onboardingComplete, undefined);
  }
});

test('a later new map replaces the old wording without carrying obsolete corrections', () => {
  const result = outcome([
    a('Let me say it back. At eight, football. By eighty, family. And in the next three months, sailing. Have I got that right?'),
    a('So at eight: old correction. Have I got that right?'),
    a(line('read.first.keep', { eight: 'drawing', eighty: 'friends', goals: 'gardening' })), c('Yes.'), a(line('onboarding.confirmed')),
  ]);
  assert.equal(result.eight, 'drawing');
  assert.equal(result.goals, 'gardening');
  assert.equal(result.onboardingComplete, true);
});

test('separating a result from its optional follow-up keeps all three outcomes, including old calls', () => {
  for (const [id, expected] of [['last.did', 'done'], ['last.partial', 'partly'], ['nothing.c.follow', 'undone']] as const) {
    assert.equal(outcome([c('My update.'), a(line(id))]).lastWeek, expected);
  }
  assert.equal(outcome([c('I did it.'), a('Right. How was it — worth doing, or did it just get done?')]).lastWeek, 'done');
  assert.equal(outcome([c('Part of it.'), a("So some of it. Which part didn't survive the week?")]).lastWeek, 'partly');
  assert.equal(outcome([c('Done.'), a('Right. How was it — worth doing, or did it simply get done?')]).lastWeek, 'done', 'historical result markers retain their existing tolerance for a changed word');
  assert.equal(outcome([c('Nothing again.'), a('Mm.'), a('Third week running — is the goal wrong, or is something else going on?')]).lastWeek, 'undone', 'an in-flight ordinary call can still use the old repeated-undone marker');
  assert.equal(outcome([c('Still thinking.'), a('Mm.'), a(line('silence.patience'))]).lastWeek, undefined);
});

test('the previous pilot action question stays strict across a wording release', () => {
  const old = 'Let me check: call the sailing school. Is that the action you want me to remember for next week?';
  assert.equal(outcome([a(old), c('Yes.')]).commitment, 'call the sailing school');
  assert.equal(outcome([a(old), c('Thanks.')]).commitment, undefined);
});

test('courtesy followed by a fresh full read-back and explicit yes saves exactly the chosen action', () => {
  const readback = line('next.confirm', { commitment: 'phone the sailing school' });
  assert.equal(outcome([a(readback), c('Right, thank you.'), a(line('next.agreed'))]).commitment, undefined);
  const result = outcome([a(readback), c('Right, thank you.'), a(readback), c('Yes, exactly.'), a(line('next.agreed'))]);
  assert.equal(result.commitment, 'phone the sailing school');
});

test('old no-action wording keeps its historical policy without weakening pilot agreement', () => {
  const turns = [c("I'd rather skip choosing anything today."), a('We can leave it there this week.')];
  const transcript = { providerCallId: 'synthetic-old-no-action', durationMs: 300_000, turns };
  assert.equal(settle(transcript, script, new Date(), { strictActionAgreement: false }).outcome?.noAction, true);
  assert.equal(settle(transcript, script, new Date(), { strictActionAgreement: true }).outcome?.noAction, undefined);
});
