import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DIALOGUE_POLICY,dialogueAgent,dialogueAgentKeys,dialoguePilotAllowed} from '../src/weekly/dialogue-policy.ts';
import {weeklyCallContext,weeklyTool,weeklyToolsAllowed} from '../src/weekly/runtime.ts';
import type {LoopDeps} from '../src/loop/deps.ts';
import {SpeechifyAgent} from '../src/agent/speechify.ts';
import {settle} from '../src/call/outcome.ts';
import {loadScript} from '../src/script.ts';
const hash='a'.repeat(64),other='b'.repeat(64);
const env:NodeJS.ProcessEnv={WEEKLY_DIALOGUE_PILOT:'1',WEEKLY_DIALOGUE_READY:'0',WEEKLY_TOOLS_READY:'0',WEEKLY_TOOLS_PILOT_HASH:hash,WEEKLY_TOOL_SECRET:'synthetic-weekly-secret-with-32-characters',SPEECHIFY_SEND_VARIABLES:'1',
  SPEECHIFY_FIRST_CALL_AGENT_ID:'live_first',SPEECHIFY_AGENT_ID:'live_return',SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID:'live_female_first',SPEECHIFY_FEMALE_AGENT_ID:'live_female_return',
  ...Object.fromEntries(Object.entries(dialogueAgentKeys).map(([role,key])=>[key,'pilot_'+role.replaceAll('-','_')]))};
async function withEnvironment(values:NodeJS.ProcessEnv,run:()=>void|Promise<void>):Promise<void>{
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  for(const[key,value]of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  try{await run();}finally{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
test('dialogue policy remains scoped to the pilot even if feature tools are enabled globally',()=>{
  assert.equal(dialoguePilotAllowed(hash,env),true);assert.equal(dialoguePilotAllowed(other,env),false);
  assert.equal(dialoguePilotAllowed(other,{...env,WEEKLY_TOOLS_READY:'1'}),false);
  assert.equal(dialoguePilotAllowed(other,{...env,WEEKLY_TOOLS_READY:'1',WEEKLY_DIALOGUE_READY:'1'}),true);
  const dialogueRollout={...env,WEEKLY_DIALOGUE_READY:'1'};
  assert.equal(dialoguePilotAllowed(other,dialogueRollout),true);
  assert.equal(weeklyToolsAllowed(other,dialogueRollout),false,'global dialogue cannot widen the existing owner-only feature pilot');
  assert.equal(weeklyToolsAllowed(hash,dialogueRollout),true,'the independently authorized feature pilot keeps its capability');
});
test('all four dialogue routes require trusted versioned context and distinct private IDs',()=>{
  const context=JSON.stringify({available:true,dialogue_policy:DIALOGUE_POLICY});
  for(const available of [true,false])for(const [first,female,key]of [[true,false,'first'],[false,false,'return'],[true,true,'female-first'],[false,true,'female-return']] as const)assert.equal(dialogueAgent(JSON.stringify({available,dialogue_policy:DIALOGUE_POLICY}),first,female,env),env[dialogueAgentKeys[key]]);
  for(const input of [undefined,'{','null','[]','"text"',JSON.stringify({dialogue_policy:DIALOGUE_POLICY}),JSON.stringify({available:'false',dialogue_policy:DIALOGUE_POLICY}),JSON.stringify({available:true})])assert.equal(dialogueAgent(input,false,false,env),undefined);
  assert.throws(()=>dialogueAgent(context,false,false,{...env,SPEECHIFY_DIALOGUE_AGENT_ID:'live_return'}),/distinct private/);
  assert.throws(()=>dialogueAgent(context,false,false,{...env,SPEECHIFY_DIALOGUE_AGENT_ID:undefined}),/distinct private/);
  assert.throws(()=>dialogueAgent(context,false,false,{...env,SPEECHIFY_DIALOGUE_AGENT_ID:env['SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID']}),/distinct private/);
});
test('dialogue-only rollout needs variables but no feature secret, and rollback removes the policy',async()=>{
  const dialogueOnly={...env,WEEKLY_DIALOGUE_READY:'1',WEEKLY_DIALOGUE_PILOT:'0',WEEKLY_TOOLS_PILOT_HASH:undefined,WEEKLY_TOOL_SECRET:undefined};
  assert.equal(dialoguePilotAllowed(other,dialogueOnly),true);
  assert.equal(weeklyToolsAllowed(other,dialogueOnly),false);
  assert.equal(dialoguePilotAllowed(other,{...dialogueOnly,SPEECHIFY_SEND_VARIABLES:'0'}),false);
  assert.equal(dialogueAgent(JSON.stringify({available:false,dialogue_policy:DIALOGUE_POLICY}),false,false,{...dialogueOnly,SPEECHIFY_SEND_VARIABLES:'0'}),undefined);
  await withEnvironment(dialogueOnly,async()=>{
    const wire:Record<string,unknown>[]=[];
    const api=new SpeechifyAgent('synthetic','live_return','live_first','https://speechify.invalid',{variables:true,amd:false,ringingTimeout:false,language:false},async(_url,init)=>{wire.push(JSON.parse(String(init?.body)));return Response.json({conversation_id:'synthetic',status:'pending'});});
    const context=weeklyCallContext('ordinary','Europe/Oslo',new Date(),other);
    assert.deepEqual(JSON.parse(context),{available:false,dialogue_policy:DIALOGUE_POLICY});
    for(const[first,voice]of [[true,'male'],[false,'male'],[true,'female'],[false,'female']] as const)await api.placeCall({to:'+4791000000',variables:{weekly_context:context},voice,firstCall:first});
    assert.deepEqual(wire.map(body=>body['agent_id']),['pilot_first','pilot_return','pilot_female_first','pilot_female_return']);
    await assert.rejects(weeklyTool({} as LoopDeps,{attempt_id:'ordinary',session_token:'forged',command:'status'}),{code:'unauthorized'});
    process.env['WEEKLY_DIALOGUE_READY']='0';
    const rolledBack=weeklyCallContext('ordinary','Europe/Oslo',new Date(),other);
    assert.deepEqual(JSON.parse(rolledBack),{available:false});
    assert.equal(dialoguePilotAllowed(other),false);
    assert.equal(dialogueAgent(context,false,false),undefined,'stale policy cannot bypass the rollback flag');
    await api.placeCall({to:'+4791000000',variables:{weekly_context:rolledBack}});
    assert.equal(wire.at(-1)!['agent_id'],'live_return');
  });
});
test('dialogue-only pilot accepts only the exact valid pilot hash, independent of feature access',async()=>{
  const pilotOnly={...env,WEEKLY_TOOL_SECRET:undefined};
  assert.equal(dialoguePilotAllowed(hash,pilotOnly),true);
  assert.equal(dialoguePilotAllowed(other,pilotOnly),false);
  assert.equal(dialoguePilotAllowed(undefined,pilotOnly),false);
  for(const invalid of ['', 'not-a-hash', 'A'.repeat(64)]){
    const invalidEnv={...pilotOnly,WEEKLY_TOOLS_PILOT_HASH:invalid};
    assert.equal(dialoguePilotAllowed(invalid,invalidEnv),false);
    assert.equal(dialogueAgent(JSON.stringify({available:false,dialogue_policy:DIALOGUE_POLICY}),true,false,invalidEnv),undefined);
  }
  await withEnvironment(pilotOnly,()=>{
    assert.deepEqual(JSON.parse(weeklyCallContext('pilot','Europe/Oslo',new Date(),hash)),{available:false,dialogue_policy:DIALOGUE_POLICY});
    assert.deepEqual(JSON.parse(weeklyCallContext('ordinary','Europe/Oslo',new Date(),other)),{available:false});
  });
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
  const dialogueOnly={...env,WEEKLY_DIALOGUE_READY:'1',WEEKLY_TOOLS_PILOT_HASH:undefined,WEEKLY_TOOL_SECRET:undefined};
  assert.equal(settle(transcript,script,new Date(),{strictActionAgreement:dialoguePilotAllowed(other,dialogueOnly)}).outcome?.commitment,undefined,'global dialogue-only callers retain the strict action policy');
});
