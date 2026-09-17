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
