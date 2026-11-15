import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appointmentPrompt} from '../src/agent/appointment-prompt.ts';
import {buildInstructions} from '../src/prompt.ts';
import {weeklyFlow, weeklyFlowRoles} from '../src/agent/weekly-flow.ts';
import {promptPack, WEEKLY_RESPONSE_DELAY_SECONDS} from '../src/agent/prompt-pack.ts';
import {variablesFor} from '../src/loop/tick.ts';
import {loadScript} from '../src/script.ts';
import {settle} from '../src/call/outcome.ts';
import {appointmentPacingProbePlan, appointmentPacingReplyPasses} from '../src/quality/appointment-pacing-probes.ts';

const script = loadScript();
const nextSlot = 'Tuesday 24 November at 14:00 CET';
const bookedSlot = 'Thursday at 09:30';

test('a dated one-off move wins over the weekly slot even without service tools', () => {
  const caller = Object.freeze({callNumber: 2, onboarding: 'complete' as const, nextSlot, bookedSlot});
  const values = variablesFor(caller);
  assert.equal(values['next_appointment'], nextSlot);
  assert.equal(values['booked_slot'], bookedSlot);
  assert.equal(values['weekly_context'], '{"available":false}');
  const instructions = appointmentPrompt(script, caller);
  assert.ok(instructions.includes('Your next call is ' + nextSlot + '.'));
  assert.ok(instructions.includes('Your usual time is still ' + bookedSlot + '.'));
  assert.ok(!instructions.includes(script.get('close.unscheduled')!), 'known-time instructions must not offer the missing-time fallback');
  assert.match(instructions, /flag disables service tools, not the supplied booking information/);
  assert.equal(caller.nextSlot, nextSlot); assert.equal(caller.bookedSlot, bookedSlot);
});

test('an unavailable next time never turns a weekly slot into a dated booking or a cancellation', () => {
  for (const next of [undefined, '', '  ', '(nothing recorded)', ' (nothing recorded) ']) {
    const instructions = appointmentPrompt(script, {nextSlot: next, bookedSlot});
    assert.ok(instructions.includes(script.get('close.unscheduled')!));
    assert.ok(!instructions.includes('Your next call is'));
    assert.match(instructions, /Do not claim there is no booking or that it was cancelled/);
    assert.match(instructions, /do not promise the weekly slot as the next appointment/);
    assert.doesNotMatch(script.get('close.unscheduled')!, /isn't|is not|no (?:call|booking)|cancelled/);
  }
});

test('all four provider prompts carry both booking variables and keep the fallback conditional', () => {
  for (const role of weeklyFlowRoles) {
    const phases = weeklyFlow(role).nodes.filter(n => n.type === 'subagent');
    for (const phase of phases) {
      const prompt = String(phase.config?.system_prompt_override);
      assert.match(prompt, /NEXT APPOINTMENT: \{\{next_appointment\}\}/);
      assert.match(prompt, /USUAL WEEKLY TIME: \{\{booked_slot\}\}/);
      assert.match(prompt, /ONLY if NEXT APPOINTMENT is blank/);
      assert.match(prompt, /A completed answer needs a response, not skip_turn/);
    }
  }
  for (const callNumber of [1, 2]) {
    const text = buildInstructions(script, {callNumber, nextSlot, bookedSlot});
    assert.ok(text.includes('Your next call is ' + nextSlot));
    assert.ok(!text.includes('There isn\'t another call booked'));
  }
});

test('only weekly roles request no added response delay, with no shorter thinking or hangup timeout', () => {
  const specs = promptPack('all', {SPEECHIFY_FEMALE_VOICE_ID: 'synthetic'});
  for (const spec of specs) {
    assert.equal(spec.responseDelaySeconds, weeklyFlowRoles.includes(spec.role as typeof weeklyFlowRoles[number]) ? WEEKLY_RESPONSE_DELAY_SECONDS : undefined);
  }
  assert.equal(WEEKLY_RESPONSE_DELAY_SECONDS, 0);
  for (const role of weeklyFlowRoles) {
    const flow = weeklyFlow(role);
    assert.equal(flow.nodes.find(n => n.key === 'post_action')?.config?.max_turns, 0);
    assert.deepEqual(flow.nodes.find(n => n.key === 'farewell')?.config, {text: 'Take care.', allow_interruptions: false});
  }
});

test('the shorter booking-control wording and its predecessor both preserve the after-call link intent', () => {
  for (const text of [script.get('setup.change_slot')!, "I can't change your call time during this call. You can choose the new time on your call page. Your booking stays unchanged until you save it there."]) {
    const result = settle({providerCallId: 'synthetic', durationMs: 300_000, turns: [
      {speaker: 'caller', text: 'Please move my weekly call.'}, {speaker: 'agent', text},
    ]}, script);
    assert.equal(result.wantsSlotChange, true);
    assert.equal(result.outcome?.commitment, undefined);
    assert.equal(result.callAgain, undefined);
  }
});

test('provider regression probes render actual phase prompts for both voices and retain thinking-time guards', () => {
  const plan = appointmentPacingProbePlan('a'.repeat(40));
  assert.equal(plan.probes.length, 28); assert.equal(plan.audioTested, false); assert.equal(plan.voiceApproved, false);
  for (const probe of plan.probes) {
    assert.ok(!probe.prompt.includes('{{'));
    assert.match(probe.prompt, /MANAGED WEEKLY FLOW/);
    assert.equal(probe.definition.type, ['action_fragment', 'thinking_time'].includes(probe.case) ? 'tool' : 'reply');
  }
  assert.throws(() => appointmentPacingProbePlan('uncommitted'));
  assert.equal(appointmentPacingReplyPasses('known_times', 'Your next call is Tuesday 24 November at 14:00 CET. Your usual weekly time is still Thursday at 09:30.'), true);
  for (const bad of ['Your next call is Thursday at 09:30.', "There isn't another call booked at the moment.", 'Your usual time is Thursday at 09:30. Is that okay?']) assert.equal(appointmentPacingReplyPasses('known_times', bad), false);
  assert.equal(appointmentPacingReplyPasses('missing_next', 'You can check your next call on your call page.'), true);
  assert.equal(appointmentPacingReplyPasses('missing_next', 'Your next call is Thursday. Check your call page.'), false);
  assert.equal(appointmentPacingReplyPasses('delay_feedback', 'Take your time. Your next call is Tuesday at 14:00.'), false);
});
