import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { weeklyPrompt } from '../src/agent/prompt-pack.ts';
import { settle, type Turn } from '../src/call/outcome.ts';

const script = loadScript();
const examples = ['joke', 'short', 'feedback'] as const;

test('both weekly console prompts illustrate listening without an added question or closing marker', () => {
  for (const first of [true, false]) {
    const prompt = weeklyPrompt(first);
    const start = prompt.indexOf('SHORT DIALOGUE EXAMPLES');
    assert.ok(start >= 0);
    if (first) assert.ok(start > prompt.indexOf('TURN 2. The disclosure'));
    assert.match(prompt, /fictional illustrations.*not facts about this caller/);
    assert.match(prompt, /same once-per-call allowance as the patience line/);
    for (const example of examples) {
      const caller = script.get(`example.${example}.caller`)!;
      const reply = script.get(`example.${example}.reply`)!;
      assert.ok(caller && reply);
      assert.ok(prompt.includes(`Caller: "${caller}" Mentor: "${reply}"`));
      assert.ok(reply.split(/\s+/).length <= 12, 'a reaction should leave room');
      assert.doesNotMatch(reply, /\?|\{\{|end_call|goodbye/i);
    }
    assert.doesNotMatch(prompt, /Never move to a new stage in the same breath|Assume you caused it|When did that stop/);
  }
});

test('listening examples and simpler questions cannot mark an action, map or undone week', () => {
  // This checks extraction boundaries, not whether a provider model will follow
  // the examples or whether its spoken delivery sounds warm.
  const turns: Turn[] = examples.flatMap(example => [
    { speaker: 'caller', text: script.get(`example.${example}.caller`)! },
    { speaker: 'agent', text: script.get(`example.${example}.reply`)! },
  ]);
  for (const id of ['eight.out', 'thin.smaller', 'next.ask.c', 'next.ask.c.calibrate']) {
    turns.push({ speaker: 'agent', text: script.get(id)! }, { speaker: 'caller', text: 'Still thinking.' });
  }
  const result = settle({ providerCallId: 'synthetic-dialogue', durationMs: 300_000, turns }, script);
  assert.equal(result.outcome?.commitment, undefined);
  assert.equal(result.outcome?.eight, undefined);
  assert.equal(result.outcome?.eighty, undefined);
  assert.equal(result.outcome?.goals, undefined);
  assert.equal(result.outcome?.onboardingComplete, undefined);
  assert.equal(result.outcome?.lastWeek, undefined);
});
