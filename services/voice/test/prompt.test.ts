import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions, renderForConsole, CONSOLE_VARIABLES } from '../src/prompt.ts';
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
  assert.match(firstCall, /never cut the commitment, the day, or the slot/i);

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

test('the prompt knows what to do when nothing was recorded', () => {
  const p = buildInstructions(loadScript(), { callNumber: 2, lastCommitment: '{{last_commitment}}' });
  assert.match(p, /\(nothing recorded\)/);
  assert.match(p, /do not pretend to remember/i);
});
