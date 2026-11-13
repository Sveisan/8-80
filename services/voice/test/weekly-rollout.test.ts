import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {dialogueAgentKeys} from '../src/weekly/dialogue-policy.ts';
import {dialogueFlagSource,ROLLOUT_PIPELINE_FILES,rolloutHash,rolloutProviderHash,rolloutTextHash,verifyDialogueRollout} from '../src/weekly/rollout.ts';
import type {PromptSpec} from '../src/agent/prompt-pack.ts';

const now=new Date('2026-11-13T15:00:00Z'),release='a'.repeat(40),tested='b'.repeat(40);
function fixture(){
  const env:NodeJS.ProcessEnv={WEEKLY_DIALOGUE_READY:'0',WEEKLY_TOOLS_READY:'0',SPEECHIFY_SEND_VARIABLES:'1'};
  const specs:PromptSpec[]=Object.keys(dialogueAgentKeys).map(role=>({role:role as PromptSpec['role'],name:role,prompt:'Synthetic source '+role,firstMessage:'Hello.',variables:['call_number']}));
  const agents:Record<string,Record<string,unknown>>={},roles:Record<string,Record<string,unknown>>={};
  for(const s of specs){
    const id='pilot_'+s.role.replaceAll('-','_');env[dialogueAgentKeys[s.role as keyof typeof dialogueAgentKeys]]=id;
    const agent={id,prompt:s.prompt,first_message:s.firstMessage,is_public:false,memory:{enabled:false},save_audio_recording:false,amd:{enabled:true,on_voicemail:{action:'hangup'}},llm:{temperature:1},tts:{voice_id:'synthetic-'+s.role},tools:['end_call','skip_turn'].map(name=>({name,kind:'builtin',enabled:true,config:{builtin:name}})),verified_variables:[{key:'call_number',type:'string',default:''}],verified_flow:{current:{},versions:{versions:[],next_cursor:null,has_more:false}}};
    agents[s.role]=agent;roles[s.role]={id,prompt:rolloutTextHash(s.prompt),greeting:rolloutHash(agent.first_message),llm:rolloutHash(agent.llm),tts:rolloutHash(agent.tts),tools:rolloutHash(agent.tools),amd:rolloutHash(agent.amd),memory:rolloutHash(agent.memory),variables:rolloutHash(agent.verified_variables),providerSettings:rolloutProviderHash(agent),flow:rolloutHash(agent.verified_flow)};
  }
  const pipeline=Object.fromEntries(ROLLOUT_PIPELINE_FILES.map(p=>[p,rolloutTextHash('synthetic '+p)]));
  const approval={version:1,releaseCommit:release,testedPromptCommit:tested,approvedAt:now.toISOString(),native:{sourceCommit:tested,total:120,passed:120,approvedForPhonePilot:true},ownerPilot:{sourceCommit:tested,firstMemoryVerified:true,returnMemoryMatched:true,storedActionSpoken:true,bothGoodbyesNatural:true},aftercare:{verified:true,automaticHttpSettlement:true,deliveryStatus:'delivered',counterIncrement:1,recapIntentCount:1,recapProviderReceiptCount:1,recapTransportAttempts:1,duplicateWebhooksCompleted:true,normalOwnerUnchanged:true,memoryMatches:{commitment:true,eight:true,eighty:true,goals:true}},roles,pipeline};
  const check=(overrides:{approval?:unknown;release?:string;specs?:PromptSpec[];agents?:Record<string,Record<string,unknown>>;env?:NodeJS.ProcessEnv;pipeline?:Record<string,string>;now?:Date}={})=>verifyDialogueRollout(overrides.approval??approval,overrides.release??release,overrides.specs??specs,overrides.agents??agents,overrides.env??env,overrides.pipeline??pipeline,overrides.now??now);
  return{env,specs,agents,roles,pipeline,approval,check};
}
test('an exact release with human and delivered-aftercare evidence allows dialogue only',()=>{
  const f=fixture();assert.deepEqual(f.check(),{ready:true,roles:4,featureToolsEnabled:false,sourceVerified:true,ownerPilotVerified:true,automaticAftercareVerified:true});
  assert.equal(f.env['WEEKLY_DIALOGUE_READY'],'0','verification does not activate anything');
});
test('wrong revisions, stale evidence, incomplete native results and unconfirmed delivery remain blocked',()=>{
  const f=fixture();
  for(const a of [undefined,{}, {...f.approval,releaseCommit:'c'.repeat(40)}, {...f.approval,testedPromptCommit:'bad'},
    {...f.approval,approvedAt:new Date(+now-49*3600_000).toISOString()}, {...f.approval,approvedAt:new Date(+now+1).toISOString()},
    {...f.approval,native:{...f.approval.native,passed:119}}, {...f.approval,ownerPilot:{...f.approval.ownerPilot,bothGoodbyesNatural:false}},
    {...f.approval,aftercare:{...f.approval.aftercare,deliveryStatus:'pending'}}, {...f.approval,aftercare:{...f.approval.aftercare,recapIntentCount:2}},
    {...f.approval,aftercare:{...f.approval.aftercare,counterIncrement:2}}, {...f.approval,aftercare:{...f.approval.aftercare,normalOwnerUnchanged:false}}]){
    assert.throws(()=>verifyDialogueRollout(a,release,f.specs,f.agents,f.env,f.pipeline,now));
  }
});
test('configuration drift, client substitutes, missing variables and ordinary agent collisions cannot pass',()=>{
  const f=fixture(),base=f.agents['first']!;
  for(const changed of [{...base,prompt:'Different source'}, {...base,llm:{temperature:.1}}, {...base,tts:{voice_id:'different'}},
    {...base,amd:{enabled:false}}, {...base,memory:{enabled:true}}, {...base,is_public:true}, {...base,save_audio_recording:true},
    {...base,verified_variables:[]}, {...base,tools:[{name:'end_call',kind:'client'},{name:'skip_turn',kind:'client'}]},
    {...base,language:'other'}, {...base,stt:{provider:'other'}}, {...base,duplex:{enabled:false}}, {...base,turn_handling:{endpointing:1}}, {...base,max_call_duration_seconds:1},
    {...base,verified_flow:{current:{nodes:[{type:'subagent'}]},versions:{versions:[],has_more:false,next_cursor:null}}}]){
    assert.throws(()=>f.check({agents:{...f.agents,first:changed}}));
  }
  assert.throws(()=>f.check({env:{...f.env,WEEKLY_TOOLS_READY:'1'}}));
  assert.throws(()=>f.check({env:{...f.env,SPEECHIFY_SEND_VARIABLES:'0'}}));
  assert.throws(()=>f.check({env:{...f.env,SPEECHIFY_FIRST_CALL_AGENT_ID:f.env['SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID']}}));
  assert.throws(()=>f.check({pipeline:{...f.pipeline,'store/postgres.ts':'f'.repeat(64)}}));
  const flow={current:{nodes:[{type:'subagent'}]},versions:{versions:[],has_more:false,next_cursor:null}};
  assert.throws(()=>f.check({agents:{...f.agents,first:{...base,verified_flow:flow}},approval:{...f.approval,roles:{...f.roles,first:{...f.roles['first'],flow:rolloutHash(flow)}}}}),'even a pinned flow override cannot substitute the tested single-prompt behavior');
});
test('flag activation and rollback preserve every other setting and private multiline value',()=>{
  const source='# Synthetic config\nWEEKLY_TOOLS_READY=0\nSECRET="synthetic\nmultiline"\n export WEEKLY_DIALOGUE_READY = 0 # old\nOTHER="literal $value"\n';
  const enabled=dialogueFlagSource(source,true),disabled=dialogueFlagSource(enabled,false);
  assert.equal(parse(enabled)['WEEKLY_DIALOGUE_READY'],'1');assert.equal(parse(disabled)['WEEKLY_DIALOGUE_READY'],'0');
  const other=(value:string)=>{const parsed=parse(value);delete parsed['WEEKLY_DIALOGUE_READY'];return parsed};
  assert.deepEqual(other(enabled),other(source));assert.deepEqual(other(disabled),other(source));
  assert.equal(dialogueFlagSource(enabled,true),enabled);
  assert.equal(parse(dialogueFlagSource('WEEKLY_TOOLS_READY=0',true))['WEEKLY_TOOLS_READY'],'0');
  for(const bad of ['WEEKLY_DIALOGUE_READY=0\nWEEKLY_DIALOGUE_READY=1\n','WEEKLY_DIALOGUE_READY="unexpected"'])assert.throws(()=>dialogueFlagSource(bad,true));
  assert.equal(rolloutHash({a:1,b:{x:2,y:3}}),rolloutHash({b:{y:3,x:2},a:1}));
});
