import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueCases } from '../src/quality/dialogue-cases.ts';
import { dialogueRoles, nativeDialogueDefinition, normalizeNativeDialogueRun } from '../src/quality/dialogue-native.ts';
import { nativeDialoguePlan } from '../src/quality/dialogue-native-plan.ts';

const toolRun = () => ({status:'completed',verdict:'passed',result:{test_type:'tool',passed:true,tool_call:{passed:true,tool_matched:true,tool_called:'skip_turn'}}});

test('the full matrix uses the native tool contract for silent actions, not reply judges', () => {
  let total = 0, tools = 0;
  for (const role of dialogueRoles) for (const c of dialogueCases) {
    if ('requiresTools' in c || c.kind !== 'both' && c.kind !== (role.endsWith('first') ? 'first' : 'return')) continue;
    const definition = nativeDialogueDefinition(role, c.id); total++;
    if ('expectedTool' in c) {
      tools++;
      assert.equal(definition.type, 'tool');
      assert.deepEqual(definition.config, {context:c.context,expected_tool:c.expectedTool});
    } else assert.equal(definition.type, 'reply');
  }
  assert.equal(total, 120); assert.equal(tools, 26);
});
test('a reproducible source plan includes all roles without routing identities or caller data',()=>{
  const plan=nativeDialoguePlan('a'.repeat(40));
  assert.deepEqual(plan.specs.map(s=>s.role),[...dialogueRoles]);
  assert.equal(plan.definitions.length,120);assert.equal(plan.definitions.filter(d=>d.definition.type==='tool').length,26);
  assert.equal(plan.voiceVerified,false);
  assert.ok(plan.specs.every(s=>!Object.hasOwn(s,'agent_id')&&s.prompt.includes('{{first_name}}')));
  assert.throws(()=>nativeDialoguePlan('not-a-complete-revision'));
});

test('a successful tool result proves selection without inventing spoken silence', () => {
  const r = normalizeNativeDialogueRun('first','thinking_fragments',toolRun());
  assert.equal(r.passed,true); assert.equal(r.toolCalled,'skip_turn');
  assert.equal(r.reply,undefined); assert.equal(r.spokenEvidence,'not_exposed');
  assert.equal(r.audibleBehavior,'requires_voice_verification');
});
test('contradictory spoken content on a tool result is preserved and rejected',()=>{
  const good=toolRun();
  const r=normalizeNativeDialogueRun('first','thinking_fragments',{...good,result:{...good.result,reply:{agent_response:'Mm.',passed:true}}});
  assert.equal(r.reply,'Mm.');assert.equal(r.spokenEvidence,'reply_text');assert.equal(r.passed,false);
  for(const reply of [{}, {passed:true}, {agent_response:null}]) {
    assert.equal(normalizeNativeDialogueRun('first','thinking_fragments',{...good,result:{...good.result,reply}}).passed,false);
  }
});

test('a valid reply cannot hide a simultaneous hangup or malformed tool result',()=>{
  const run={status:'completed',verdict:'passed',result:{test_type:'reply',passed:true,reply:{passed:true,agent_response:'Of course.'}}};
  for(const tool of [{}, {tool_called:'end_call',passed:true}]) {
    const r=normalizeNativeDialogueRun('first','caller_reopens_close',{...run,result:{...run.result,tool_call:tool}});
    assert.equal(r.passed,false);
  }
  assert.equal(normalizeNativeDialogueRun('first','caller_reopens_close',{...run,result:{...run.result,tool_call:{tool_called:'end_call'}}}).toolCalled,'end_call');
});

test('wrong variants, missing observations, errors and contradictory verdicts cannot pass', () => {
  const good = toolRun();
  for (const input of [undefined,{}, {...good,error:'failed',status:'failed'}, {...good,error:'execution failed'}, {...good,verdict:'failed'},
    {...good,result:{...good.result,test_type:'reply'}},
    {...good,result:{...good.result,tool_call:{...good.result.tool_call,tool_called:'end_call'}}},
    {...good,result:{...good.result,tool_call:{...good.result.tool_call,tool_matched:false}}},
    {...good,result:{...good.result,tool_call:undefined}}]) {
    const r=normalizeNativeDialogueRun('first','thinking_fragments',input);
    assert.equal(r.passed,false); assert.equal(r.reply,undefined);
  }
});

test('an ordinary spoken response is preserved for independent hard checks', () => {
  const run={status:'completed',verdict:'passed',result:{test_type:'reply',passed:true,reply:{passed:true,agent_response:'Take care.'},tool_call:null}};
  const r=normalizeNativeDialogueRun('first','explicit_stop',run);
  assert.equal(r.passed,true);assert.equal(r.reply,'Take care.');assert.equal(r.toolCalled,null);
  assert.equal(r.spokenEvidence,'reply_text');
  assert.equal(normalizeNativeDialogueRun('first','explicit_stop',{...run,result:{...run.result,reply:{passed:true}}}).passed,false);
  for(const text of ['', '  ', "Sorry, something went wrong on my end and I couldn't finish that reply. Please try again."]){
    assert.equal(normalizeNativeDialogueRun('first','explicit_stop',{...run,result:{...run.result,reply:{passed:true,agent_response:text}}}).passed,false);
  }
});

test('role, case and scope are validated without echoing untrusted input', () => {
  for (const [role,id] of [['private-secret','thinking_fragments'],['first','private-secret'],['first','visit_he'],['first','concrete_function']]) {
    assert.throws(()=>nativeDialogueDefinition(role!,id!),/^Error: Unknown dialogue scenario or role\.$/);
  }
});
