import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyFlow, weeklyFlowRoles } from '../src/agent/weekly-flow.ts';
import { settle } from '../src/call/outcome.ts';
import { loadScript } from '../src/script.ts';
import type { Turn } from '../src/call/outcome.ts';
import { weeklyFlowProbePlan } from '../src/quality/weekly-flow-probes.ts';
import { CONSOLE_VARIABLES } from '../src/prompt.ts';

const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const fullMap = script.get('read.first.keep')!.replace('{{eight}}', 'playing games').replace('{{eighty}}', 'time with family').replace('{{goals}}', 'learn to sail');
const outcome = (turns: Turn[]) => settle({ providerCallId: 'fictional', durationMs: 160_000, turns }, script).outcome;

test('provider pause probes carry each actual phase prompt without claiming exit or audio evidence', () => {
  const plan = weeklyFlowProbePlan('a'.repeat(40));
  assert.equal(plan.probes.length, 16);
  assert.equal(plan.phaseExitsTested, false); assert.equal(plan.voiceApproved, false);
  for (const p of plan.probes) {
    assert.equal(p.prompt, weeklyFlow(p.role).nodes.find(n => n.key === p.phase)?.config?.system_prompt_override);
    assert.equal(p.definition.config.expected_tool, 'skip_turn');
  }
  assert.throws(() => weeklyFlowProbePlan('not-a-revision'));
});

test('the observed premature kept-map marker never completes onboarding', () => {
  for (const gap of [[], [c('Mhm.')], [c('Um, I...')]]) {
    const result = outcome([c('Yes.'), a(fullMap), ...gap, a(script.get('onboarding.confirmed')!), c('Goodbye.')]);
    assert.equal(result?.onboardingComplete, undefined);
    assert.equal(result?.commitment, undefined);
  }
  assert.equal(outcome([a(fullMap), c('Yes.'), a(script.get('onboarding.confirmed')!)])?.onboardingComplete, true);
});

test('a corrected map still needs a fresh answer after that correction', () => {
  const fix = script.get('read.first.fix_eighty')!.replace('{{eighty}}', 'time outdoors');
  const prefix = [a(fullMap), c('No, time outdoors at eighty.'), a(fix)];
  assert.equal(outcome([...prefix, a(script.get('onboarding.confirmed')!)])?.onboardingComplete, undefined);
  const good = outcome([...prefix, c('Yes, exactly.'), a(script.get('onboarding.confirmed')!)]);
  assert.equal(good?.onboardingComplete, true);
  assert.equal(good?.eighty, 'time outdoors');
});

test('every weekly route removes model hangup and puts one non-interruptible farewell before end', () => {
  for (const role of weeklyFlowRoles) {
    const flow = weeklyFlow(role);
    for (const m of JSON.stringify(flow).matchAll(/\{\{([^}]+)\}\}/g)) assert.ok(CONSOLE_VARIABLES.includes(m[1]!), 'model-filled read-back slots must not become provider variables');
    const phases = flow.nodes.filter(n => n.type === 'subagent');
    assert.ok(phases.length);
    for (const phase of phases) {
      assert.deepEqual(phase.config?.tools_filter, ['skip_turn', 'weekly_assist']);
      assert.equal(phase.config?.max_turns, 0, 'no silent turn-ceiling shortcut to the end');
      assert.match(String(phase.config?.system_prompt_override), /no new caller answer has arrived/);
      assert.match(String(phase.config?.system_prompt_override), /Do not say goodbye/);
      assert.ok(!flow.edges.some(e => e.from === phase.key && e.type === 'default'));
    }
    const end = flow.nodes.find(n => n.type === 'end')!;
    const intoEnd = flow.edges.filter(e => e.to === end.key);
    assert.deepEqual(intoEnd, [{ from: 'farewell', to: 'end', type: 'default' }]);
    assert.deepEqual(flow.nodes.find(n => n.key === 'farewell'), {
      key: 'farewell', type: 'say', config: { text: 'Take care.', allow_interruptions: false },
    });
    assert.equal(end.config, undefined, 'no second farewell queued by the end node');
    for (const edge of flow.edges.filter(e => e.to === 'farewell')) assert.equal(edge.condition, 'caller_done');
    assert.equal(flow.nodes.filter(n => n.key === 'greeting').length, 1);
    for (const edge of flow.edges) {
      assert.ok(flow.nodes.some(n => n.key === edge.from));
      assert.ok(flow.nodes.some(n => n.key === edge.to));
    }
  }
});

test('a first-call map can only reach its kept marker through the answer phase', () => {
  for (const role of ['first', 'female-first'] as const) {
    const flow = weeklyFlow(role);
    assert.deepEqual(flow.edges.filter(e => e.to === 'map_kept'), [
      { from: 'map_answer', to: 'map_kept', type: 'llm_condition', condition: 'map_agreed' },
    ]);
    assert.ok(!flow.edges.some(e => e.from === 'introduction' && e.to === 'conversation'));
    const wait = flow.nodes.find(n => n.key === 'map_answer')!;
    assert.match(String(wait.config?.system_prompt_override), /yes given BEFORE the read-back/);
    assert.match(String(wait.config?.system_prompt_override), /correction.*NEW explicit agreement/s);
    assert.ok(flow.edges.some(e => e.from === 'map_answer' && e.condition === 'caller_done' && e.to === 'farewell'));
    assert.ok(flow.edges.some(e => e.from === 'map_answer' && e.condition === 'map_declined' && e.to === 'conversation'));
  }
  assert.ok(weeklyFlow('return').nodes.every(n => !n.key.startsWith('map_')));
});
