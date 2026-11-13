import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertGuidedPilot, guidedPilotVariables } from '../src/weekly/guided-pilot.ts';
import { dialogueAgent } from '../src/weekly/dialogue-policy.ts';
import { weeklyToken } from '../src/weekly/runtime.ts';
import { guidedReminderCases, guidedReminderNativePlan, guidedReminderRunReport, nativeGuidedObservation, NATIVE_WEEKLY_MOCK_NAME } from '../src/quality/guided-reminder.ts';
import { dialogueReplyFailures } from '../src/quality/dialogue-reply.ts';

const hash='a'.repeat(64),env={WEEKLY_TOOLS_READY:'0',WEEKLY_DIALOGUE_READY:'0',WEEKLY_DIALOGUE_PILOT:'1',WEEKLY_TOOLS_PILOT_HASH:hash,
  WEEKLY_TOOL_SECRET:'fictional-guided-secret-with-at-least-32-characters',SPEECHIFY_SEND_VARIABLES:'1',
  SPEECHIFY_AGENT_ID:'agent_live',SPEECHIFY_DIALOGUE_AGENT_ID:'agent_weekly_pilot'};

test('guided route refuses ordinary identities, global rollout and existing weekly agents',()=>{
  assert.doesNotThrow(()=>assertGuidedPilot('agent_guided',hash,env));
  for(const bad of [{...env,WEEKLY_TOOLS_READY:'1'},{...env,WEEKLY_DIALOGUE_READY:'1'},{...env,WEEKLY_DIALOGUE_PILOT:'0'},
    {...env,WEEKLY_TOOL_SECRET:''},{...env,SPEECHIFY_SEND_VARIABLES:'0'},{...env,WEEKLY_TOOLS_PILOT_HASH:'other'}]){
    assert.throws(()=>assertGuidedPilot('agent_guided',hash,bad));
  }
  assert.throws(()=>assertGuidedPilot('agent_guided','b'.repeat(64),env));
  for(const id of ['agent_live','agent_weekly_pilot','https://bad.example',''])assert.throws(()=>assertGuidedPilot(id,hash,env));
});

test('guided context preserves real attempt authority without selecting a weekly dialogue agent',()=>{
  const before={...process.env};Object.assign(process.env,env);
  try{
    const variables=guidedPilotVariables('agent_guided','synthetic-guide-attempt',hash,'Europe/Oslo',new Date('2030-11-13T12:00Z'));
    assert.deepEqual(Object.keys(variables),['weekly_context']);
    const c=JSON.parse(variables['weekly_context']!);
    assert.equal(c.attempt_id,'synthetic-guide-attempt');assert.equal(c.session_token,weeklyToken('synthetic-guide-attempt'));
    assert.equal(c.available,true);assert.equal(c.guided_test,'reminder-v1');assert.equal(c.dialogue_policy,undefined);
    assert.equal(dialogueAgent(variables['weekly_context'],false,false),undefined);
  }finally{for(const k of Object.keys(process.env))if(!Object.hasOwn(before,k))delete process.env[k];Object.assign(process.env,before);}
});

function toolRun(name:string,args:Record<string,unknown>={}){
  return {status:'completed',verdict:'passed',result:{test_type:'tool',passed:true,tool_call:{passed:true,tool_matched:true,tool_called:name,tool_args:args}}};
}
const credentials={attempt_id:'fictional-guided-attempt',session_token:'fictional-invalid-credential',request_id:'synthetic-effect-1'};
test('guided evidence rejects wrong timing modes, stale revision, wrong draft and absent consent',()=>{
  const initial={...credentials,command:'reminder_prepare',text:'Take a five-minute break.',after_minutes:10};
  assert.equal(guidedReminderRunReport('prepare_initial',toolRun('weekly_assist',initial)).passed,true);
  assert.equal(guidedReminderRunReport('prepare_initial',toolRun('weekly_assist',{...initial,date:'',time:null,shift_minutes:0,revision:0,confirmed:false,draft_id:''})).passed,true,'empty provider defaults use the same canonicalization as the real webhook');
  for(const extra of [{date:'2030-11-13'},{time:'14:00'},{shift_minutes:2},{confirmed:true},{session_token:'another-context'}]){
    assert.equal(guidedReminderRunReport('prepare_initial',toolRun('weekly_assist',{...initial,...extra})).passed,false);
  }
  const move={...credentials,command:'reminder_prepare',text:'Take a five-minute break.',shift_minutes:2,revision:3};
  assert.equal(guidedReminderRunReport('prepare_move',toolRun('weekly_assist',move)).passed,true);
  assert.equal(guidedReminderRunReport('prepare_move',toolRun('weekly_assist',{...move,revision:2})).passed,false);
  const confirm={...credentials,command:'reminder_confirm',draft_id:'fictional-draft-2',confirmed:true};
  assert.equal(guidedReminderRunReport('confirm_move',toolRun('weekly_assist',confirm)).passed,true);
  for(const extra of [{draft_id:'fictional-draft-1'},{confirmed:false},{request_id:''}])assert.equal(guidedReminderRunReport('confirm_move',toolRun('weekly_assist',{...confirm,...extra})).passed,false);
  assert.equal(guidedReminderRunReport('thinking_fragments',toolRun('weekly_assist',confirm)).passed,false);
  assert.equal(guidedReminderRunReport('thinking_fragments',toolRun('skip_turn')).passed,true);
});
test('a missing observation or speech cannot be manufactured into a passed guide test',()=>{
  for(const result of [null,{},toolRun('skip_turn'),{status:'completed',verdict:'passed',result:{test_type:'reply',passed:true,reply:{passed:true}}}]){
    assert.equal(guidedReminderRunReport('proposal_waits',result).passed,false);
  }
  const mixed=toolRun('skip_turn');Object.assign(mixed.result,{reply:{agent_response:'Take your time.'}});
  assert.equal(guidedReminderRunReport('thinking_fragments',mixed).passed,false);
  const plan=guidedReminderNativePlan('a'.repeat(40));
  assert.equal(plan.definitions.length,guidedReminderCases.length);assert.equal(plan.voiceVerified,false);
  assert.ok(plan.definitions.some(d=>d.definition.type==='tool')&&plan.definitions.some(d=>d.definition.type==='reply'));
});
test('the declared native alias cannot repair a failed verdict, wrong arguments or a different expected tool',()=>{
  const run=toolRun(NATIVE_WEEKLY_MOCK_NAME,{...credentials,command:'status'});Object.assign(run.result.tool_call,{expected_tool:NATIVE_WEEKLY_MOCK_NAME});
  assert.equal(guidedReminderRunReport('ready_reads_status',run).passed,true);
  assert.equal(guidedReminderRunReport('ready_reads_status',{...run,verdict:'failed'}).passed,false);
  assert.equal(guidedReminderRunReport('prepare_initial',run).passed,false);
  const other={...run,result:{...run.result,tool_call:{...run.result.tool_call,expected_tool:'skip_turn'}}};
  assert.equal(nativeGuidedObservation(other),other);
  assert.equal(guidedReminderRunReport('ready_reads_status',other).passed,false);
});
test('observed missing-data and unsupported-followup replies cannot pass even with a positive model judge',()=>{
  assert.ok(dialogueReplyFailures('missing_older_profile',"By eighty, you'd like (nothing recorded). Was there anything this week that connected with that?").includes('internal_missing_data_spoken'));
  assert.ok(dialogueReplyFailures('confirmed_action_no_appointment',"I'll ask how it went next time we talk.").includes('unsupported_future_followup'));
  assert.ok(dialogueReplyFailures('action_courtesy',"I've got that.").includes('unconfirmed_action_claim'));
  assert.deepEqual(dialogueReplyFailures('confirmed_action_no_appointment',"I've got that."),[]);
});
