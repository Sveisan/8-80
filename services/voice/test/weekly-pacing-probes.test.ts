import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPacingProbePlan } from '../src/quality/weekly-pacing-probes.ts';
import { weeklyFlow } from '../src/agent/weekly-flow.ts';

test('pacing probes exercise volunteered answers and preserve every existing consent/thinking wait', () => {
  const plan = weeklyPacingProbePlan('a'.repeat(40));
  assert.equal(plan.probes.length, 52);
  assert.equal(plan.audioTested, false);
  assert.equal(plan.voiceApproved, false);
  assert.equal(plan.phaseExitsTested, false);
  assert.equal(new Set(plan.probes.map(p => p.role + ':' + p.case)).size, 52);
  for (const p of plan.probes) {
    assert.equal(p.prompt, weeklyFlow(p.role).nodes.find(n => n.key === p.phase)?.config?.system_prompt_override);
    if (p.definition.type === 'tool') {
      assert.ok('expected_tool' in p.definition.config);
      assert.equal(p.definition.config.expected_tool, 'skip_turn');
    }
  }
  assert.equal(plan.probes.filter(p => p.case === 'redundant_invitation_already_answered').length, 4);
  assert.equal(plan.probes.filter(p => p.case === 'post_entry_unanswered').length, 4);
  assert.throws(() => weeklyPacingProbePlan('unversioned'));
});
