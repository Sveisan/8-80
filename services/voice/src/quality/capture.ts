import {toTranscript} from '../webhook/speechify.ts';
import type {CallTranscript, Turn} from '../call/outcome.ts';

const object=(v:unknown):Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{};
const timestamp=(v:unknown):number|null=>typeof v==='string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))?Date.parse(v):null;
const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
const words=(s:string)=>s.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.length??0;
const sequence=(turns:Turn[])=>{
  const result:Turn[]=[];
  for(const t of turns){
    if(!t.text.trim())continue;
    const last=result.at(-1);
    if(last?.speaker===t.speaker)last.text=normalize(last.text+' '+t.text);
    else result.push({speaker:t.speaker,text:normalize(t.text)});
  }
  return result;
};
function gaps(values:number[]){
  const sorted=[...values].sort((a,b)=>a-b), n=sorted.length;
  return {pairs:n,medianMs:n?(sorted[Math.floor(n/2)]!+sorted[Math.floor((n-1)/2)]!)/2:null,
    minMs:n?sorted[0]!:null,maxMs:n?sorted.at(-1)!:null,overlapPairs:values.filter(v=>v<0).length};
}

/** Only counts, booleans and timing aggregates leave this function. Message
 * timestamps describe the provider's timeline, not measured acoustic latency. */
export function captureReport(input:unknown,retained:CallTranscript){
  const response=object(input), raw=response['messages'];
  if(!Array.isArray(raw) || response['has_more']!==false || response['next_cursor']!=null)throw Error('A complete provider message page is required.');
  if(raw.length>10_000 || JSON.stringify(raw).length>2_000_000)throw Error('Provider review limit exceeded.');
  // Reuse the settlement mapper so unknown roles cannot silently disappear.
  const provider=toTranscript({conversation_id:'review',duration_ms:0,messages:raw});
  const spoken=raw.flatMap(value=>{
    const m=object(value),role=String(m['role']??m['speaker']??'').toLowerCase();
    const speaker=['agent','assistant','bot'].includes(String(role))?'agent':['user','caller','human','customer'].includes(String(role))?'caller':null;
    const text=typeof m['content']==='string'?m['content']:typeof m['text']==='string'?m['text']:'';
    if(!speaker || !text.trim())return [];
    const start=timestamp(m['started_at']),end=timestamp(m['ended_at']);
    const valid=start!==null && end!==null && end>=start;
    return [{speaker,text,start:valid?start:null,end:valid?end:null}];
  });
  const callerToAgent:number[]=[],agentToCaller:number[]=[];
  let incompleteTransitions=0;
  for(let i=1;i<spoken.length;i++){
    const before=spoken[i-1]!,after=spoken[i]!;
    if(before.speaker===after.speaker)continue;
    if(before.end===null || after.start===null){incompleteTransitions++;continue;}
    (before.speaker==='caller'?callerToAgent:agentToCaller).push(after.start-before.end);
  }
  const tools=raw.map(object).filter(m=>m['role']==='tool' && m['tool_name']==='end_call');
  const toolTimes=tools.map(m=>timestamp(m['started_at']));
  const agents=spoken.filter(m=>m.speaker==='agent');
  const orderKnown=tools.length>0 && toolTimes.every(t=>t!==null) && agents.every(m=>m.start!==null && m.end!==null);
  const firstTool=orderKnown?Math.min(...toolTimes as number[]):null;
  const lastCaller=spoken.findLast(m=>m.speaker==='caller');
  const courtesy=lastCaller?/^(thank you|thanks|okay|ok|oh|mhm|takk)[.!?\s]*$/i.test(lastCaller.text.trim()):null;
  const probe='blue river bicycle'; // Public, neutral owner test; never an input value.
  const probeHeard=(turns:Turn[])=>sequence(turns).some(t=>t.speaker==='caller' && (' '+t.text.toLowerCase().replace(/[^a-z]+/g,' ').trim()+' ').includes(' '+probe+' '));
  return {
    version:1,source:'provider_message_timestamps',completePage:true,
    capture:{providerMatchesRetained:JSON.stringify(sequence(provider.turns))===JSON.stringify(sequence(retained.turns)),
      providerCallerTurns:spoken.filter(m=>m.speaker==='caller').length,providerCallerWords:spoken.filter(m=>m.speaker==='caller').reduce((n,m)=>n+words(m.text),0),
      neutralProbeInProvider:probeHeard(provider.turns),neutralProbeInRetained:probeHeard(retained.turns),
      actualSpokenCapture:'requires_owner_confirmation'},
    timing:{spokenMessages:spoken.length,completeSpeechIntervals:spoken.filter(m=>m.start!==null && m.end!==null).length,incompleteTransitions,
      callerToAgent:gaps(callerToAgent),agentToCaller:gaps(agentToCaller)},
    ending:{endCallCount:tools.length,lastCallerIsAcknowledgment:courtesy,
      agentTurnsStartingAfterFirstEndCall:firstTool===null?null:agents.filter(m=>m.start!>firstTool).length,
      agentTurnsSpanningFirstEndCall:firstTool===null?null:agents.filter(m=>m.start!<=firstTool && m.end!>firstTool).length,
      audibleGoodbye:'requires_owner_confirmation',appropriateness:'requires_context_review'},
    interpretation:'Matching copies cannot detect words missed before transcription. Negative gaps are reported overlaps, not proof of interruption. Tool ordering does not prove audio playout. No speech, identifiers or credentials are included.',
  } as const;
}
