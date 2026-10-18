import type { CallTranscript, Turn } from '../call/outcome.ts';

export interface QualityContext { kind: 'first'|'return'|'unknown'; priorCommitment?: string; }
const words=(s:string)=>s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const questionParts=(s:string)=>s.match(/[^.!?]*\?/g)??[];

/** Text signals for human review, never a judgement of benefit, rapport or safety. */
export function weeklyQuality(t:CallTranscript,context:QualityContext={kind:'unknown'}) {
  if(t.turns.length>10_000 || t.turns.reduce((n,x)=>n+x.text.length,0)>2_000_000)throw Error('Transcript exceeds the local review limit.');
  // Providers can split one utterance into consecutive messages. Merge only
  // adjacent same-speaker chunks; otherwise stacking looks artificially good.
  const turns:Turn[]=[];
  for(const turn of t.turns){
    if(!turn.text.trim())continue;
    const last=turns.at(-1);
    if(last?.speaker===turn.speaker)last.text+=' '+turn.text.trim();
    else turns.push({...turn,text:turn.text.trim()});
  }
  const stacked:{agentTurn:number;questions:number}[]=[];
  const repeated:{firstAgentTurn:number;agentTurn:number}[]=[];
  const long:{agentTurn:number;words:number}[]=[];
  const seen=new Map<string,number>();
  let agentTurns=0,questionRun=0,maxQuestionRun=0,questionTurns=0,maxAgentWords=0;
  for(const turn of turns){
    if(turn.speaker!=='agent')continue;
    agentTurns++;
    const questions=questionParts(turn.text);
    const n=words(turn.text).split(' ').filter(Boolean).length;
    maxAgentWords=Math.max(maxAgentWords,n);
    if(n>=80)long.push({agentTurn:agentTurns,words:n});
    if(questions.length){questionTurns++;questionRun++;maxQuestionRun=Math.max(maxQuestionRun,questionRun);}
    else questionRun=0;
    if(questions.length>1)stacked.push({agentTurn:agentTurns,questions:questions.length});
    for(const q of questions){
      const key=words(q);if(key.split(' ').length<3)continue;
      const first=seen.get(key);
      if(first!==undefined)repeated.push({firstAgentTurn:first,agentTurn:agentTurns});
      else seen.set(key,agentTurns);
    }
  }
  const prior=words(context.priorCommitment??'');
  const meaningful=!!prior && prior!=='nothing recorded';
  const mentioned=meaningful?turns.some(x=>x.speaker==='agent' && (' '+words(x.text)+' ').includes(' '+prior+' ')):null;
  // Deliberately no transcript, excerpts, hashes, name, phone or commitment in
  // the report. Turn numbers let the authorized listener find the evidence.
  return {
    version:1,kind:context.kind,
    structural:{agentTurns,callerTurns:turns.filter(x=>x.speaker==='caller').length,questionTurns,maxQuestionTurnRun:maxQuestionRun,maxAgentWords,
      stackedQuestionTurns:stacked.slice(0,50),stackedQuestionTurnCount:stacked.length,
      repeatedQuestionCandidates:repeated.slice(0,50),repeatedQuestionCandidateCount:repeated.length,
      longAgentTurns:long.slice(0,50),longAgentTurnCount:long.length},
    memory:{priorContext:context.priorCommitment===undefined?'unknown':meaningful?'provided':'none',verbatimPriorCommitmentReference:mentioned},
    humanReview:{followupRelevance:'unrated',repeatedFollowups:'unrated',warmth:'unrated',pressure:'unrated',endingAppropriate:'unrated',
      interruptions:'requires_audio_or_timing',responseLatency:'requires_audio_or_timing'},
    interpretation:'Punctuation and exact repetition are review signals. A question run is not proof of excessive followups. No question is required in a natural closing turn.',
  } as const;
}
