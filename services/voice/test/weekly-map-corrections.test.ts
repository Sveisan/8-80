import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, type Turn } from '../src/call/outcome.ts';
import { loadScript } from '../src/script.ts';
import { weeklyFlow } from '../src/agent/weekly-flow.ts';
import { weeklyMapCorrectionProbePlan } from '../src/quality/weekly-map-correction-probes.ts';

const script = loadScript();
const a = (text: string): Turn => ({ speaker: 'agent', text });
const c = (text: string): Turn => ({ speaker: 'caller', text });
const line = (id: string, key: string, value: string) => script.get(id)!.replace('{{' + key + '}}', value);
const map = script.get('read.first.keep')!.replace('{{eight}}', 'playing games').replace('{{eighty}}', 'time outdoors').replace('{{goals}}', 'learn to sail');
const result = (turns: Turn[]) => settle({ providerCallId: 'fictional-map-correction', durationMs: 160_000, turns }, script).outcome;
const kept = a(script.get('onboarding.confirmed')!);

test('an earlier yes followed by a map restatement cannot complete onboarding', () => {
  for (const response of ['Statue building.', 'Um, I mean...', 'I am still finishing that correction.']) {
    assert.equal(result([c('Yeah.'), a(map), c(response), kept])?.onboardingComplete, undefined);
  }
});

test('yes to a map-part clarification cannot approve the preceding map', () => {
  assert.equal(result([a(map), a(script.get('read.first.which_part')!), c('Yes.'), kept])?.onboardingComplete, undefined);
  assert.equal(result([a(map), a('Would you like me to explain that question?'), c('Yes.'), kept])?.onboardingComplete, undefined);
});

test('each corrected part requires a fresh answer after its complete correction question', () => {
  for (const [field, id, value] of [['eight', 'read.first.fix_eight', 'drawing'], ['eighty', 'read.first.fix_eighty', 'building a sculpture'], ['goals', 'read.first.fix', 'finish a drawing']] as const) {
    const fix = line(id, field, value);
    assert.match(fix, /Have I got that right\?$/);
    const prefix = [a(map), c('I want to change that part.'), a(script.get('read.first.which_part')!), c(field), a(fix)];
    for (const answer of [[], [c('Thanks.')], [c('Let me think.')]]) assert.equal(result([...prefix, ...answer, kept])?.onboardingComplete, undefined);
    const good = result([...prefix, c('Yes, that is right.'), kept]);
    assert.equal(good?.onboardingComplete, true);
    assert.equal(good?.[field], value);
  }
});

test('legacy goals corrections remain readable without manufacturing agreement', () => {
  const fix = a('So the next three months: finish a drawing. Got it.');
  assert.equal(result([a(map), c('Change the goals.'), fix, kept])?.onboardingComplete, undefined);
  const good = result([a(map), c('Change the goals.'), fix, c('Yes.'), kept]);
  assert.equal(good?.goals, 'finish a drawing');
  assert.equal(good?.onboardingComplete, true);
});

test('map correction gates retain the natural handoffs and silent confirmation entry', () => {
  for (const role of ['first', 'female-first'] as const) {
    const graph = weeklyFlow(role),phase = graph.nodes.find(n => n.key === 'map_answer')!;
    assert.equal(phase.config?.first_message, undefined);
    assert.match(String(phase.config?.system_prompt_override), /CORRECTION IS NOT AGREEMENT/);
    const agreed = (phase.config?.exit_conditions as {name: string; description: string}[]).find(c => c.name === 'map_agreed')!;
    assert.match(agreed.description, /LATEST completed caller contribution/);
    assert.equal(graph.nodes.find(n => n.key === 'conversation')?.config?.first_message, script.get('work.flow_entry'));
    assert.equal(graph.nodes.find(n => n.key === 'post_action')?.config?.first_message, script.get('close.flow_offer'));
  }
});

test('the provider plan adds sixteen correction probes without removing pacing or waiting coverage', () => {
  const plan = weeklyMapCorrectionProbePlan('a'.repeat(40));
  assert.equal(plan.probes.length, 68);
  assert.equal(plan.phaseExitsTested, false);
  assert.equal(plan.voiceApproved, false);
  assert.equal(new Set(plan.probes.map(p => p.role + ':' + p.case)).size, 68);
  assert.equal(plan.probes.filter(p => p.case === 'map_unfinished_restatement').length, 2);
  assert.equal(plan.probes.filter(p => p.case === 'redundant_invitation_already_answered').length, 4);
});
