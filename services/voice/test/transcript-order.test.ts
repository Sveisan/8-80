import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toTranscript} from '../src/webhook/speechify.ts';
import {settle} from '../src/call/outcome.ts';
import {loadScript} from '../src/script.ts';
const time=(n:number)=>new Date(Date.UTC(2026,10,15)+n*1000).toISOString();
const m=(role:string,content:string,start:number,end:number|null)=>({role,content,started_at:time(start),ended_at:end===null?null:time(end)});
const script=loadScript(),map=script.get('read.first.keep')!.replace('{{eight}}','games').replace('{{eighty}}','friends').replace('{{goals}}','read a book');
const payload=(messages:unknown[])=>({conversation_id:'fictional-order',duration_ms:160000,messages});
test('streamed confirmations follow their questions and a later closing no cannot reject the action',()=>{
 const rows=[m('user','Read a book.',10,null),m('user','Yes.',10,30),m('assistant',map,11,29),m('assistant',script.get('onboarding.confirmed')!,31,32),
 m('assistant','Let me check: read a book. Is that the action you want me to remember?',33,39),m('user','Yes.',40,41),m('user','No.',41.5,49),
 m('assistant',script.get('next.agreed')!,42,43),m('assistant',script.get('close.flow_offer')!,44,47),m('assistant','Take care.',50,51)];
 const before=JSON.stringify(rows),t=toTranscript(payload(rows)),o=settle(t,script).outcome;
 assert.equal(o?.onboardingComplete,true);assert.equal(o?.commitment,'read a book');assert.equal(o?.noAction,undefined);assert.equal(JSON.stringify(rows),before);
 assert.equal(t.turns[1]?.speaker,'agent');assert.equal(t.turns[2]?.text,'Yes.');
});
test('an actual earlier yes still cannot confirm an unanswered map',()=>{
 const t=toTranscript(payload([m('user','Yes.',1,2),m('assistant',map,3,12),m('assistant',script.get('onboarding.confirmed')!,13,14)]));
 assert.equal(settle(t,script).outcome?.onboardingComplete,undefined);
});
test('unfinished thoughts remain present and timestamp ties preserve supplied order',()=>{
 const t=toTranscript(payload([m('user','I mean...',1,null),m('assistant','Wait.',2,3),m('user','Still thinking.',3,3)]));
 assert.deepEqual(t.turns.map(t=>t.text),['I mean...','Wait.','Still thinking.']);
});
test('missing, invalid, backwards and numeric timestamps preserve the entire legacy order',()=>{
 for(const extra of [{},{started_at:'bad'},{started_at:1,ended_at:2},{started_at:time(8),ended_at:time(7)}]){
 const rows=[{role:'user',content:'First',...extra},m('assistant','Second',1,2)];
 assert.deepEqual(toTranscript(payload(rows)).turns.map(t=>t.text),['First','Second']);
 }
});
