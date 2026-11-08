import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueReplyFailures as check } from '../src/quality/dialogue-reply.ts';

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
