import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DIALOGUE_POLICY,dialogueAgent,dialogueAgentKeys,dialoguePilotAllowed} from '../src/weekly/dialogue-policy.ts';
import {weeklyCallContext} from '../src/weekly/runtime.ts';
import {SpeechifyAgent} from '../src/agent/speechify.ts';
import {settle} from '../src/call/outcome.ts';
import {loadScript} from '../src/script.ts';
const hash='a'.repeat(64),other='b'.repeat(64);
const env:NodeJS.ProcessEnv={WEEKLY_DIALOGUE_PILOT:'1',WEEKLY_DIALOGUE_READY:'0',WEEKLY_TOOLS_READY:'0',WEEKLY_TOOLS_PILOT_HASH:hash,WEEKLY_TOOL_SECRET:'synthetic-weekly-secret-with-32-characters',SPEECHIFY_SEND_VARIABLES:'1',
  SPEECHIFY_FIRST_CALL_AGENT_ID:'live_first',SPEECHIFY_AGENT_ID:'live_return',SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID:'live_female_first',SPEECHIFY_FEMALE_AGENT_ID:'live_female_return',
  ...Object.fromEntries(Object.entries(dialogueAgentKeys).map(([role,key])=>[key,'pilot_'+role.replaceAll('-','_')]))};
test('dialogue policy remains scoped to the pilot even if feature tools are enabled globally',()=>{
  assert.equal(dialoguePilotAllowed(hash,env),true);assert.equal(dialoguePilotAllowed(other,env),false);
  assert.equal(dialoguePilotAllowed(other,{...env,WEEKLY_TOOLS_READY:'1'}),false);
  assert.equal(dialoguePilotAllowed(other,{...env,WEEKLY_TOOLS_READY:'1',WEEKLY_DIALOGUE_READY:'1'}),true);
});
test('all four dialogue routes require trusted versioned context and distinct private IDs',()=>{
  const context=JSON.stringify({available:true,dialogue_policy:DIALOGUE_POLICY});
  for(const [first,female,key]of [[true,false,'first'],[false,false,'return'],[true,true,'female-first'],[false,true,'female-return']] as const)assert.equal(dialogueAgent(context,first,female,env),env[dialogueAgentKeys[key]]);
  for(const input of [undefined,'{','null','[]','"text"',JSON.stringify({available:false,dialogue_policy:DIALOGUE_POLICY}),JSON.stringify({available:true})])assert.equal(dialogueAgent(input,false,false,env),undefined);
  assert.throws(()=>dialogueAgent(context,false,false,{...env,SPEECHIFY_DIALOGUE_AGENT_ID:'live_return'}),/distinct private/);
  assert.throws(()=>dialogueAgent(context,false,false,{...env,SPEECHIFY_DIALOGUE_AGENT_ID:undefined}),/distinct private/);
});
test('actual outbound requests use pilot agents only for the scoped server context',async()=>{
  const keys=Object.keys(env),before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  try{
    const wire:Record<string,unknown>[]=[];
    const api=new SpeechifyAgent('synthetic','live_return','live_first','https://speechify.invalid',{variables:true,amd:false,ringingTimeout:false,language:false},async(_url,init)=>{wire.push(JSON.parse(String(init?.body)));return Response.json({conversation_id:'synthetic',status:'pending'});});
    const context=weeklyCallContext('pilot-attempt','Europe/Oslo',new Date(),hash);
    assert.equal(JSON.parse(context).dialogue_policy,DIALOGUE_POLICY);
    await api.placeCall({to:'+4791000000',variables:{weekly_context:context},voice:'female',firstCall:true});
    await api.placeCall({to:'+4791000000',variables:{weekly_context:weeklyCallContext('ordinary','Europe/Oslo',new Date(),other)},voice:'male'});
    assert.equal(wire[0]!['agent_id'],'pilot_female_first');assert.equal(wire[1]!['agent_id'],'live_return');
    process.env['WEEKLY_TOOLS_READY']='1';assert.equal(JSON.parse(weeklyCallContext('ordinary','Europe/Oslo',new Date(),other)).dialogue_policy,undefined);
  }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
test('historical live read-backs retain their old policy while pilot calls require explicit agreement',()=>{
  const script=loadScript(),transcript={providerCallId:'synthetic',durationMs:300000,turns:[{speaker:'caller' as const,text:'Book a lesson.'},{speaker:'agent' as const,text:"Right — book a lesson. I'll ask how it went next time we talk."}]};
  assert.equal(settle(transcript,script,new Date(),{strictActionAgreement:false}).outcome?.commitment,'book a lesson');
  assert.equal(settle(transcript,script,new Date(),{strictActionAgreement:true}).outcome?.commitment,undefined);
});
