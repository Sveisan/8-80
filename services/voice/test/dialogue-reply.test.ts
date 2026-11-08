import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueReplyFailures as check, dialogueBatchReport } from '../src/quality/dialogue-reply.ts';

test('thinking fragments and a returned goodbye reject the spoken failures from the owner test', () => {
  for (const id of ['acknowledgement', 'caller_continues', 'thinking_fragments', 'thinking_after_patience', 'quiet_after_sound_feedback', 'returned_goodbye', 'after_end_tool']) {
    assert.deepEqual(check(id, ''), []);
    for (const words of ['Mm.', 'Take your time.', 'Sorry, please go ahead.', '[silence]', 'Take care.']) assert.deepEqual(check(id, words), ['speech_in_quiet_turn']);
    assert.deepEqual(check(id, undefined), ['missing_reply']);
  }
});
test('criticism of listening sounds cannot pass as criticism of questions', () => {
  assert.deepEqual(check('listening_sound_feedback', "You're right. I'll stop adding those sounds."), []);
  assert.ok(check('listening_sound_feedback', "Fair point. I'll ease off the questions.").includes('wrong_feedback_response'));
  assert.ok(check('listening_sound_feedback', "I'll stop interrupting. What were you saying?").includes('feedback_floor_taken'));
});
test('a clear money goal gets a factual response before a follow-up', () => {
  assert.deepEqual(check('new_goal_acknowledged', "You'd like more money coming in. What else would you like to include?"), []);
  assert.deepEqual(check('ignored_answer_feedback', 'You want to earn more money.'), []);
  for (const words of ['What else would you like to include?', 'What else besides making money?']) assert.ok(check('new_goal_acknowledged', words).includes('goal_not_acknowledged_before_question'));
  assert.ok(check('ignored_answer_feedback', 'It does rather help with the rent and dinner.').includes('money_joke'));
  assert.ok(check('ignored_answer_feedback', 'You want more money. What else?').includes('feedback_floor_taken'));
});
test('the first map must carry all perspectives before the agreement marker', () => {
  const full = "Let me say it back. Your eight-year-old self would love playing games. By eighty, you'd like time with family. And in the next three months, learn to sail. Have I got that right?";
  for (const id of ['complete_short_reply', 'full_map_before_confirmation', 'partial_map_repair']) {
    assert.deepEqual(check(id, full), []);
    assert.ok(check(id, 'So, the next three months: learn to sail. Have I got that right?').includes('incomplete_or_changed_map'));
    assert.ok(check(id, full.replace('playing games', 'playing football')).includes('incomplete_or_changed_map'));
    assert.ok(check(id, full + " I'll keep that for next time.").includes('map_agreement_skipped'));
  }
});
test('complete short answers do not license a false interruption apology', () => {
  assert.deepEqual(check('agreed_action_okay', 'Take care.'), []);
  assert.deepEqual(check('agreed_action_okay', 'Sorry, please go ahead.'), ['false_interruption_repair']);
});
test('a completed opening update cannot be asked for again as a result follow-up',()=>{
  assert.ok(check('spontaneous_update','That feedback points to a real change in the product and the price. What did it change, if anything?').includes('completed_result_asked_again'));
  assert.ok(check('situation_known','So you did it. What did doing it change, if anything?').includes('completed_result_asked_again'));
  assert.deepEqual(check('situation_known','So you did it.'),[]);
});
test('a provider pass cannot override a spoken quiet turn or an incomplete matrix', () => {
  const input=[{role:'female-first',case:'thinking_fragments',status:'completed',verdict:'passed',passed:true,reply:'Mm.'}];
  const report=dialogueBatchReport(input);
  assert.equal(report.approved,false);assert.equal(report.complete,false);assert.equal(report.passed,0);
  assert.deepEqual(report.failures[0]?.failures,['speech_in_quiet_turn','expected_tool_not_observed']);
  assert.equal(dialogueBatchReport([{...input[0],reply:''}]).passed,0,'empty text alone cannot prove skip_turn');
  assert.equal(dialogueBatchReport([{...input[0],reply:'',toolCalled:'skip_turn'}]).passed,1);
  assert.equal(dialogueBatchReport([{...input[0],reply:'',verdict:'failed',passed:false}]).passed,0);
  assert.equal(dialogueBatchReport([]).approved,false);
  assert.equal(dialogueBatchReport([input[0],input[0]]).complete,false);
});
