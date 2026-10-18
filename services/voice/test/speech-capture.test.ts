import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechifyAgent} from '../src/agent/speechify.ts';
import {captureReport} from '../src/quality/capture.ts';
import {toTranscript} from '../src/webhook/speechify.ts';

const at=(ms:number)=>new Date(Date.UTC(2026,9,18)+ms).toISOString();
const speech=(role:string,content:string,start:number,end:number)=>({role,content,started_at:at(start),ended_at:at(end)});
const endCall=(start:number)=>({role:'tool',tool_name:'end_call',content:'',started_at:at(start)});
const retained=(messages:unknown[])=>toTranscript({conversation_id:'private-id',duration_ms:89_000,messages});
const report=(messages:unknown[],stored=messages)=>captureReport({messages,has_more:false,next_cursor:null},retained(stored));

test('the read adapter uses the current read-only conversation routes and hides provider errors',async()=>{
  const calls:string[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    calls.push(String(url));assert.equal(init?.method??'GET','GET');assert.equal(init?.redirect,'error');
    assert.ok(init?.signal);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-private-key');
    return Response.json({messages:[],has_more:false,next_cursor:null});
  };
  const api=new SpeechifyAgent('synthetic-private-key','','','https://api.speechify.ai',undefined,fetcher);
  await api.conversation('private/id');await api.conversationMessages('private/id');
  assert.deepEqual(calls,['https://api.speechify.ai/v1/agents/conversations/private%2Fid','https://api.speechify.ai/v1/agents/conversations/private%2Fid/messages']);
  const bad=new SpeechifyAgent('key','','','https://api.speechify.ai',undefined,async()=>new Response('secret caller wording',{status:403}));
  await assert.rejects(bad.conversationMessages('id'),/^Error: Speechify refused the conversation read \(HTTP 403\)$/);
});

test('a courtesy hangup reports ordering without claiming that audio played or the ending was appropriate',()=>{
  const r=report([speech('assistant','What about your life would make that kid grin?',0,2000),speech('user','Thank you.',3000,3500),endCall(5000),speech('assistant','Goodbye for now.',5154,6562)]);
  assert.equal(r.ending.lastCallerIsAcknowledgment,true);assert.equal(r.ending.endCallCount,1);
  assert.equal(r.ending.agentTurnsStartingAfterFirstEndCall,1);assert.equal(r.ending.audibleGoodbye,'requires_owner_confirmation');
  assert.equal(r.ending.appropriateness,'requires_context_review');
  assert.equal(r.timing.callerToAgent.medianMs,1654);assert.equal(r.timing.agentToCaller.medianMs,1000);
  assert.equal(r.capture.providerCallerWords,2);assert.equal(r.capture.actualSpokenCapture,'requires_owner_confirmation');
});
test('farewell then tool, and a tool during speech, remain distinct observations',()=>{
  const r=report([speech('user','Thanks, goodbye.',0,700),speech('assistant','Take care.',1000,1600),endCall(1700)]);
  assert.equal(r.ending.lastCallerIsAcknowledgment,false);assert.equal(r.ending.agentTurnsStartingAfterFirstEndCall,0);assert.equal(r.ending.agentTurnsSpanningFirstEndCall,0);
  assert.equal(report([speech('assistant','Take care.',1000,2000),endCall(1700)]).ending.agentTurnsSpanningFirstEndCall,1);
});
test('overlaps are counted separately from positive gaps and missing speech timestamps stay unknown',()=>{
  const r=report([speech('assistant','One thing.',0,2000),speech('user','My answer.',1800,2500),speech('assistant','Go on.',3000,3400)]);
  assert.deepEqual(r.timing.agentToCaller,{pairs:1,medianMs:-200,minMs:-200,maxMs:-200,overlapPairs:1});
  assert.equal(r.timing.callerToAgent.medianMs,500);
  const noTiming=report([{role:'assistant',content:'Hello.',created_at:at(0)},{role:'user',content:'Yes.',created_at:at(1000)},endCall(3000)]);
  assert.equal(noTiming.timing.completeSpeechIntervals,0);assert.equal(noTiming.timing.incompleteTransitions,1);
  assert.equal(noTiming.timing.agentToCaller.medianMs,null);assert.equal(noTiming.ending.agentTurnsStartingAfterFirstEndCall,null);
  assert.equal(report([speech('user','Answer.',2000,1000)]).timing.completeSpeechIntervals,0);
});
test('comparison finds lost provider-to-webhook words but matching copies cannot establish microphone capture',()=>{
  const messages=[speech('assistant','Go on.',0,1000),speech('user','Blue, river, bicycle.',2000,3000)];
  const r=report(messages);assert.equal(r.capture.providerMatchesRetained,true);
  assert.equal(r.capture.neutralProbeInProvider,true);assert.equal(r.capture.neutralProbeInRetained,true);
  assert.equal(r.capture.actualSpokenCapture,'requires_owner_confirmation');
  const lost=report(messages,[messages[0],{role:'user',content:'Blue river.'}]);
  assert.equal(lost.capture.providerMatchesRetained,false);assert.equal(lost.capture.neutralProbeInProvider,true);assert.equal(lost.capture.neutralProbeInRetained,false);
  assert.equal(report([speech('user','Blue river bicycles.',0,500)]).capture.neutralProbeInProvider,false);
  const split=[speech('user','Blue river',0,500),speech('user','bicycle.',600,1000)];
  assert.equal(report(split,[{role:'user',content:'Blue river bicycle.'}]).capture.providerMatchesRetained,true);
});
test('partial pages, unknown roles and excessive input cannot silently produce a green report',()=>{
  for(const wrapper of [{messages:[],has_more:true,next_cursor:'opaque'},{messages:[],has_more:false,next_cursor:'opaque'},{messages:[]}])assert.throws(()=>captureReport(wrapper,retained([])));
  assert.throws(()=>report([{role:'new-speaker',content:'Something.'}]));
  assert.throws(()=>report(Array.from({length:10001},()=>({role:'user',content:'x'}))));
});
test('reports never print words, identifiers, timestamps, phone numbers or tool arguments',()=>{
  const privateText='Private words +4791234567 private@example.test';
  const messages=[speech('assistant',privateText,0,1000),speech('user',privateText,1500,2000),{...endCall(2500),tool_args:{secret:'private-tool-secret'}}];
  const json=JSON.stringify(report(messages));
  for(const value of [privateText,'private-id','91234567','example.test','private-tool-secret',at(0)])assert.ok(!json.includes(value));
});
