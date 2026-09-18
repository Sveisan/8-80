import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions, renderForConsole } from '../src/prompt.ts';
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
