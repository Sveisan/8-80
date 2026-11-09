import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNBLOCK_KINDS, readUnblockScript } from '../src/unblock/prompt-cli.ts';

// Guards the module's boundaries, not its wording. The copy is the owner's to
// rewrite; these are the lines a rewrite must not cross.

for (const kind of UNBLOCK_KINDS) {
  const script = readUnblockScript(kind);

  test(`unblock ${kind}: keeps the private tool arguments and the provisional-save rule`, () => {
    assert.match(script, /capture_unblock/);
    assert.match(script, /\{\{session_token\}\}/);
    assert.match(script, /never speak or reveal them/);
    assert.match(script, /never say "saved"/);
  });

  test(`unblock ${kind}: fits questions to any life and any call rhythm`, () => {
    assert.match(script, /FIT THE QUESTION TO THEIR LIFE/);
    const spoken = [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((line) => !/never|unless/i.test(line));
    for (const line of spoken) assert.doesNotMatch(line, /\b(this|next|past|coming) week\b|weekly call|free month/i, line);
  });

  test(`unblock ${kind}: stops on a safety hold`, () => {
    assert.match(script, /held:true/);
  });

  test(`unblock ${kind}: names no source author and uses no destiny vocabulary in spoken lines`, () => {
    const spoken = [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join('\n');
    assert.doesNotMatch(script, /Coelho|Alchemist|Bayer|Personal Legend|Maktub/i);
    assert.doesNotMatch(spoken, /manifest|destiny|universe|unlock your potential/i);
  });
}

test('unblock weekly: neither the close nor an ordinary call promises a time it does not have', () => {
  const script = readUnblockScript('weekly');
  assert.match(script, /If next_call_local is missing, name the chapter and say "I'll be in touch soon"; never promise a day or time you do not have/);
  assert.match(script, /If sign_off\.next_call_local is missing, say "Talk to you soon" and promise no time/);
});
