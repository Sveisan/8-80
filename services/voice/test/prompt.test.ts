import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions, renderForConsole, CONSOLE_VARIABLES, END_CALL_TOOL } from '../src/prompt.ts';
import { loadScript } from '../src/script.ts';

test('nothing rendered for the console can be mistaken for a console variable', () => {
  // A surviving {{x}} is either flagged as undeclared or silently substituted
  // with nothing, and the one that would be emptied is the read-back.
  const rendered = renderForConsole(buildInstructions(loadScript(), { callNumber: 1 }));
  assert.ok(!rendered.includes('{{'), 'a double brace survived into the console prompt');
  assert.match(rendered, /<commitment>/, 'the slot itself must still be there to fill');
  assert.ok(!rendered.includes('double braces'), 'the note must describe the notation actually used');
});

test('the boundary that keeps this off the therapist\'s ground is in every prompt', () => {
  // The first long call spent ten minutes on past relationships and loneliness
  // because nothing forbade going looking. These are the rules that stop it.
  for (const callNumber of [1, 2, 4]) {
    const p = buildInstructions(loadScript(), { callNumber });
    assert.match(p, /never ask about the past/i, `call ${callNumber}`);
    assert.match(p, /second question about a feeling/i, `call ${callNumber}`);
    assert.match(p, /therapist/i, `call ${callNumber}`);
    assert.match(p, /two turns off the spine/i, `call ${callNumber}`);
  }
});

test('the read questions are never softened into self-care', () => {
  const p = buildInstructions(loadScript(), { callNumber: 2 });
  assert.match(p, /do not paraphrase them into a question about self-care/i);
});

test('the prompt tells the mentor how to move a call so it actually moves', () => {
  // The read-back is the mechanism: settle() takes the time from that sentence
  // and nowhere else, so a prompt that omits it produces an agreement the
  // scheduler never hears about — which is exactly what happened.
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(p, /ring you back at/i);
  assert.match(p, /digits/i);
});

test('a first call is given a shape and a returning call is not', () => {
  // The first call has no last week to organise it, so it needs a spine. A
  // returning call already has one and would only be made stiffer by this.
  const firstCall = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(firstCall, /THE SHAPE OF THIS CALL/);
  assert.match(firstCall, /never cut the map or the one thing/i);

  for (const n of [2, 4]) {
    assert.ok(
      !buildInstructions(loadScript(), { callNumber: n }).includes('THE SHAPE OF THIS CALL'),
      `call ${n} was given the first-call shape`,
    );
  }
});

test('the shape is never something the caller hears about', () => {
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(p, /never announce it/i);
});

test('only the names the loop actually sends survive as console variables', () => {
  // A brace the console does not know about gets flagged; a brace it does know
  // about gets substituted. Both are wrong for a note meant for the model, and
  // the substitution is the dangerous one because it is silent.
  const rendered = renderForConsole(
    buildInstructions(loadScript(), { callNumber: 2, lastCommitment: '{{last_commitment}}', callDay: '{{last_day}}' }),
    CONSOLE_VARIABLES,
  );
  const left = [...new Set([...rendered.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1] ?? ''))];
  for (const name of left) {
    assert.ok(
      (CONSOLE_VARIABLES as readonly string[]).includes(name),
      `{{${name}}} would be substituted with nothing, or refused as undeclared`,
    );
  }
  assert.ok(left.length > 0, 'a returning prompt with no variables cannot remember anything');
});

test('the console prompt does not tell every caller which call this is', () => {
  // One prompt serves every returning caller, so anything true of only one of
  // them has to be a variable. This was baked in as the literal "2", which told
  // somebody on their twelfth call that it was their second — and told them so
  // in the same breath as "you have spoken before", which is why it read as
  // plausible and survived.
  const rendered = renderForConsole(
    buildInstructions(loadScript(), { callNumber: '{{call_number}}' }),
    CONSOLE_VARIABLES,
  );
  assert.ok(rendered.includes('{{call_number}}'), 'the call number is not a variable');
  assert.doesNotMatch(rendered, /call number \d/, 'a literal call number reached the console prompt');
  // And it is still the returning prompt, not the first-call one: the guard
  // that decides which is a numeric comparison, and a string must not pass it.
  assert.match(rendered, /THIS IS NOT THE FIRST CALL/);
});

test('the prompt knows what to do when nothing was recorded', () => {
  const p = buildInstructions(loadScript(), { callNumber: 2, lastCommitment: '{{last_commitment}}' });
  assert.match(p, /\(nothing recorded\)/);
  assert.match(p, /do not pretend to remember/i);
});

test('the first call is curious about goals and never audits or schedules them', () => {
  // Two failures, one each way: eight minutes auditing a goal, then a call so
  // careful not to that it went from three words to "which day".
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(p, /CURIOUS, NOT AUDITING/);
  assert.match(p, /whether it is realistic, why that one/);
  assert.match(p, /A goal is not a schedule/);
  assert.match(p, /line of genuine reaction/);
});

test('the first call runs from easy to real: eight, eighty, this year, then the one thing', () => {
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  const at = (s: string) => p.indexOf(s);
  const order = [
    "What did you love doing at eight",
    "You're eighty, looking back",
    'this year. What would you like to move?',
    'Let me say it back.',
    'Which one do you want to start with?',
    "What's one thing you'll do on it",
  ].map(at);
  assert.ok(order.every((n) => n >= 0), 'a stage is missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the stages are out of order');
});

test('the first call never asks for an email, and confirms the slot rather than asking', () => {
  const p = buildInstructions(loadScript(), { callNumber: 1, bookedSlot: 'Sunday at 13:00' });
  assert.match(p, /You picked Sunday at 13:00 for these/);
  assert.match(p, /Never ask for an email address/);
  assert.ok(!/which address\?/i.test(p), 'the email question is still in the prompt');
});

test('a stored value can never be substituted into a slot the model fills', () => {
  // belief.name is "So the assumption is: {{belief}}." — filled by the model
  // with what was just said. A console variable called "belief" would fill it
  // with last month's assumption instead, and say it aloud.
  const modelSlots = new Set(
    [...loadScript().values()].flatMap((line) => [...line.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1])),
  );
  for (const name of CONSOLE_VARIABLES) {
    assert.ok(!modelSlots.has(name), `console variable ${name} collides with a SCRIPT.md slot`);
  }
});

test('the first call reads their eight and eighty back, which is how they are kept', () => {
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(p, /At eight, \{\{eight\}\}/);
  assert.match(p, /By eighty, \{\{eighty\}\}/);
  assert.match(p, /this year, \{\{goals\}\}/);
});

test('a returning call reads against their own answers, and never repeats an assumption', () => {
  const p = buildInstructions(loadScript(), {
    callNumber: 3,
    lastCommitment: 'call two members',
    eight: 'building dens',
    eighty: 'a stand up set',
    belief: 'nobody will pay for this',
  });
  assert.match(p, /At eight it was building dens\./);
  assert.match(p, /a stand up set/);
  assert.match(p, /Never say the assumption itself out loud/);
  assert.ok(!/Will you\?/.test(p), 'the read-back is not a compliance test');
  assert.match(p, /never offer an example/i, 'their evidence, not the mentor\'s');
  assert.match(p, /belief about who they are/i);
});

test('a returning caller with no answers on file gets the read as it always was', () => {
  const p = buildInstructions(loadScript(), { callNumber: 3, lastCommitment: 'call two members' });
  assert.ok(!p.includes('At eight it was'), 'no own-answer read without their answers');
  assert.ok(!p.includes('Never say the assumption itself'), 'no test to ask about');
});

/**
 * The prompt names a tool; a CLI registers one. Nothing made them the same name.
 *
 * A mismatch is the worst kind of quiet: the call runs to its duration cap
 * every week, because the mentor is told to call something that does not exist
 * and there is no error anywhere — the model simply narrates, or stalls, and
 * the caller waits to find out who is hanging up. That is the exact failure
 * this tool was added to fix.
 */
test('the prompt names the tool the console actually has', () => {
  // `end_call` is what the Tools tab calls it, on both agents. A prompt naming
  // anything else fails silently: no error, the model narrating or stalling,
  // and the call running to its cap while somebody waits to find out who is
  // hanging up — which is the failure the tool was added to fix.
  assert.equal(END_CALL_TOOL, 'end_call', 'changed here, but was it changed on both agents?');
  for (const callNumber of [1, 2]) {
    const prompt = buildInstructions(loadScript(), { callNumber });
    assert.ok(
      prompt.includes(`\`${END_CALL_TOOL}\``),
      `call ${callNumber} is never told to call \`${END_CALL_TOOL}\`, so it cannot end itself`,
    );
  }
});

test('the first call may notice one connection, repairs on a ladder, and never says a name it heard once', () => {
  // From the third real first call: jokes at eight and comedy at eighty went
  // unremarked; one question was rephrased four times; a misheard "parents'
  // project" was said back three times.
  const p = buildInstructions(loadScript(), { callNumber: 1 });
  assert.match(p, /THE ONE THING YOU NOTICE/);
  assert.match(p, /never because it feels like interpretation/);
  assert.match(p, /Never ask a fourth version/);
  assert.match(p, /never say one back the first time you hear it/);
  assert.match(p, /You get ONE push/);
  assert.ok(!/"Which games\?"\)/.test(p), 'the example that got "Can\'t remember" is gone as a model');
});

test('no prompt asks for, pins or expects a day for the one thing', () => {
  // The day question was removed on 1 October, and three other lines kept
  // asking for it — "pinned to a day", "the day it lands on" — so each prompt
  // contradicted itself. The weekly slot's day is the only day that may appear.
  for (const callNumber of [1, 3]) {
    const p = buildInstructions(loadScript(), { callNumber, lastCommitment: 'x', bookedSlot: 'Sunday at 13:00' });
    for (const phrase of [/pinned to a day/i, /the day it lands on/i, /the one thing,? (and|or) the day/i, /move to the day/i, /"day" slot/i]) {
      assert.ok(!phrase.test(p), `call ${callNumber} still has ${phrase}`);
    }
    assert.match(p, /Never ask which day/);
  }
});
