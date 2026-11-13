import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueReplyFailures as check, dialogueBatchReport } from '../src/quality/dialogue-reply.ts';
import { dialogueCases } from '../src/quality/dialogue-cases.ts';
import { dialogueRoles } from '../src/quality/dialogue-native.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('thinking fragments and a returned goodbye reject the spoken failures from the owner test', () => {
  for (const id of ['acknowledgement', 'caller_continues', 'thinking_fragments', 'thinking_after_patience', 'quiet_after_sound_feedback', 'unclear_fragment_wait', 'returned_goodbye', 'after_end_tool']) {
    assert.deepEqual(check(id, ''), []);
    for (const words of ['Mm.', 'Take your time.', 'Sorry, please go ahead.', '[silence]', 'Take care.']) assert.deepEqual(check(id, words), ['speech_in_quiet_turn']);
    assert.deepEqual(check(id, undefined), ['missing_reply']);
  }
});
test('empty wording and a generic provider fallback cannot pass any wording scenario',()=>{
  const fallback="Sorry, something went wrong on my end and I couldn't finish that reply. Please try again.";
  assert.deepEqual(check('explicit_stop',''),['empty_reply']);
  assert.deepEqual(check('explicit_stop','   '),['empty_reply']);
  for(const id of ['explicit_stop','acknowledgement','new_goal_acknowledged'])assert.deepEqual(check(id,fallback),['provider_error_fallback']);
});
test('criticism of listening sounds cannot pass as criticism of questions', () => {
  assert.deepEqual(check('listening_sound_feedback', "You're right. I'll stop adding those sounds."), []);
  assert.ok(check('listening_sound_feedback', "Fair point. I'll ease off the questions.").includes('wrong_feedback_response'));
  assert.ok(check('listening_sound_feedback', "I'll stop interrupting. What were you saying?").includes('feedback_floor_taken'));
});
test('a caller can reopen the close without losing the floor', () => {
  assert.deepEqual(check('caller_reopens_close','Of course.'),[]);
  for(const reply of ['Take care.','What is it?','Of course. Go ahead.','See you next time.','end_call']) {
    assert.deepEqual(check('caller_reopens_close',reply),['caller_floor_or_reopened_close_ignored']);
  }
});
test('a second clarification gets a concrete anchor rather than a third broad question or invented action', () => {
  assert.deepEqual(check('clarification_twice','Would you like to choose a small step about sailing, or leave it for now?'),[]);
  assert.deepEqual(check('clarification_twice','What would move that forward?'),['clarification_repeated_or_action_invented']);
  assert.deepEqual(check('clarification_twice','Call the sailing school.'),['clarification_repeated_or_action_invented']);
  assert.deepEqual(check('clarification_twice','Would you like a step about sailing? What could you try?'),['stacked_clarification_questions']);
});
test('a resumed caller choice is acknowledged without an instruction or unconfirmed memory claim',()=>{
  assert.deepEqual(check('feedback_resumed',"You've chosen to phone the sailing school."),[]);
  assert.deepEqual(check('feedback_resumed','Phone the sailing school.'),['chosen_action_sounds_like_instruction']);
  assert.deepEqual(check('feedback_resumed','I will ask how it went next time we talk.'),['unconfirmed_action_or_map_claim']);
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
  assert.deepEqual(report.failures[0]?.failures,['speech_in_quiet_turn','wrong_native_test_type','expected_tool_not_observed']);
  assert.equal(dialogueBatchReport([{...input[0],reply:''}]).passed,0,'empty text alone cannot prove skip_turn');
  assert.equal(dialogueBatchReport([{...input[0],reply:'',toolCalled:'skip_turn'}]).passed,0,'a reply-only result cannot prove function selection');
  const tool = {...input[0],testType:'tool',reply:undefined,toolCalled:'skip_turn'};
  const intent=dialogueBatchReport([tool]);
  assert.equal(intent.passed,1);assert.equal(intent.approved,false);assert.equal(intent.voiceVerification,'required');
  assert.equal(intent.quietTurnVoiceChecks.length,1);
  assert.equal(dialogueBatchReport([{...tool,reply:''}]).passed,0,'do not substitute empty speech into a tool-only variant');
  const mixed=dialogueBatchReport([{role:'first',case:'caller_reopens_close',testType:'reply',reply:'Of course.',toolCalled:'end_call',status:'completed',verdict:'passed',passed:true}]);
  assert.equal(mixed.passed,0);assert.deepEqual(mixed.failures[0]?.failures,['unexpected_tool_in_reply']);
  assert.equal(dialogueBatchReport([{...input[0],reply:'',verdict:'failed',passed:false}]).passed,0);
  assert.equal(dialogueBatchReport([]).approved,false);
  assert.equal(dialogueBatchReport([input[0],input[0]]).complete,false);
});
test('a complete positive intent matrix permits only a phone pilot, never automatic rollout',()=>{
  const full="Let me say it back. Your eight-year-old self would love playing games. By eighty, you'd like time with family. And in the next three months, learn to sail. Have I got that right?";
  const rows=dialogueRoles.flatMap(role=>dialogueCases.filter(c=>!('requiresTools'in c)&&(c.kind==='both'||c.kind===(role.endsWith('first')?'first':'return'))).map(c=>({
    role,case:c.id,status:'completed',verdict:'passed',passed:true,
    ...('expectedTool'in c?{testType:'tool',toolCalled:c.expectedTool}:{testType:'reply',reply:['complete_short_reply','full_map_before_confirmation','partial_map_repair'].includes(c.id)?full:c.id==='listening_sound_feedback'?"I'll stop adding those sounds.":c.id==='caller_reopens_close'?'Of course.':'You want more money.'}),
  })));
  const r=dialogueBatchReport(rows);
  assert.equal(r.total,116);assert.equal(r.complete,true);assert.equal(r.approvedForPhonePilot,true);
  assert.equal(r.approved,false);assert.equal(r.quietTurnVoiceChecks.length,26);
  assert.deepEqual(r.checks,{wording:{total:90,passed:90},toolIntent:{total:26,passed:26}});
});
test('untrusted roles, case names and malformed review files cannot leak private values', () => {
  const secret='private-synthetic-input-never-print';
  for(const row of [{role:secret,case:'acknowledgement'},{role:'first',case:secret}])assert.throws(()=>dialogueBatchReport([row]),/^Error: Unknown dialogue scenario or role\.$/);
  const dir=mkdtempSync(join(tmpdir(),'8and80-dialogue-privacy-'));
  try {
    const file=join(dir,'private.json');
    const cli=resolve(import.meta.dirname,'../src/quality/dialogue-reply-cli.ts');
    for(const value of [secret,JSON.stringify([{role:secret,case:'acknowledgement'}])]){
      writeFileSync(file,value,{mode:0o600});
      const r=spawnSync(process.execPath,['--import','tsx',cli,file],{encoding:'utf8',timeout:15000});
      assert.equal(r.status,1);assert.equal(r.stdout,'');
      assert.ok(!r.stderr.includes(secret));assert.ok(!r.stderr.includes(file));
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
