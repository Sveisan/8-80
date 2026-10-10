import { createHmac, timingSafeEqual } from 'node:crypto';
import { obj, str } from '../billing/types.ts';
import { applyCommand, activeBeliefs, wording, PracticeError, type Command, type Practice } from './model.ts';

export type Kind = 'onboarding' | 'daily' | 'weekly';
export interface Receipt { id: string; callerText: string; command: Command; }
export interface Snapshot { revision: number; initial: Practice; practice: Practice; receipts: Receipt[]; coverage: Record<string,'done'|'passed'>; }
export function sessionToken(id: string, secret: string): string {
  if (secret.length < 32) throw new PracticeError('tools_unavailable');
  return createHmac('sha256',secret).update('beliefs:session:'+id).digest('base64url');
}
export function verifySessionToken(id: string, token: string, secret: string): boolean {
  if (secret.length < 32) return false;
  const want=Buffer.from(sessionToken(id,secret)); const got=Buffer.from(token);
  return want.length===got.length && timingSafeEqual(want,got);
}
export const normalise = (text: string): string => text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function containsWords(haystack: string, needle: string): boolean {
  const n=normalise(needle); return !!n && (' '+normalise(haystack)+' ').includes(' '+n+' ');
}
function quoted(text: string, value: unknown): string {
  const words=wording(value); if(!containsWords(text,words))throw new PracticeError('caller_words_required'); return words;
}
/** Tool input is untrusted. Whitelist by call type; score/week never come from the model. */
export function capture(snapshot: Snapshot, kind: Kind, week: number|null, input: unknown, now=new Date()): Snapshot {
  const v=obj(input); const id=wording(v?.['event_id'],100); const callerText=wording(v?.['caller_text'],16000);
  const existing=snapshot.receipts.find(r=>r.id===id);
  const c=obj(v?.['command']); const type=str(c?.['type']); let command: Command;
  const confirmation=():true=>{if(c?.['confirmed']!==true || !/\b(yes|correct|agree|understand|ja|riktig|enig|forstår)\b/iu.test(callerText))throw new PracticeError('caller_confirmation_required');return true;};
  const target=()=>{const targetId=wording(c?.['id'],100);if(!snapshot.practice.beliefs.some(b=>b.id===targetId))throw new PracticeError('belief_unknown');return targetId;};
  switch(type) {
    case 'outcome': if(kind!=='onboarding')throw new PracticeError('command_not_allowed');command={type,outcome:quoted(callerText,c?.['outcome'])};break;
    case 'queue': if(kind!=='onboarding')throw new PracticeError('command_not_allowed');command={type,belief:quoted(callerText,c?.['belief']),trigger:quoted(callerText,c?.['trigger'])};break;
    case 'reorder': {
      if(kind!=='onboarding' || snapshot.practice.understood)throw new PracticeError('command_not_allowed');
      confirmation();
      if(!Array.isArray(c?.['ids']))throw new PracticeError('order_invalid');
      const ids=c['ids'].map(id=>wording(id,100));let rest=' '+normalise(callerText)+' ';
      for(const id of ids){
        const b=snapshot.practice.beliefs.find(b=>b.id===id);if(!b)throw new PracticeError('belief_unknown');
        const words=' '+normalise(b.belief)+' ';const at=rest.indexOf(words);
        if(at<0)throw new PracticeError('caller_words_required');rest=rest.slice(at+words.length-1);
      }
      command={type,ids};break;
    }
    case 'prepare': {
      if(kind==='daily')throw new PracticeError('command_not_allowed');
      const evidence=c?.['evidence'];if(!Array.isArray(evidence))throw new PracticeError('evidence_required');
      command={type,id:target(),decision:quoted(callerText,c?.['decision']),evidence:evidence.map(e=>quoted(callerText,e)),balance:quoted(callerText,c?.['balance']),opportunity:quoted(callerText,c?.['opportunity']),confirmed:confirmation()};break;
    }
    case 'understood': if(kind!=='onboarding')throw new PracticeError('command_not_allowed');command={type,confirmed:confirmation()};break;
    case 'practice': {
      if(kind!=='daily')throw new PracticeError('command_not_allowed');
      const targetId=target();const belief=snapshot.practice.beliefs.find(b=>b.id===targetId)!;
      const passed=c?.['passed']===true;
      if(!passed && !containsWords(callerText,belief.decision))throw new PracticeError('decision_not_spoken');
      command=passed?{type,id:targetId,passed:true}:{type,id:targetId,evidence:quoted(callerText,c?.['evidence']),balance:quoted(callerText,c?.['balance'])};break;
    }
    case 'review': {
      if(kind!=='weekly' || week===null)throw new PracticeError('command_not_allowed');
      if(!snapshot.initial.beliefs.some(b=>b.id===c?.['id'] && b.status==='active'))throw new PracticeError('review_not_due');
      if(typeof c?.['score']!=='number')throw new PracticeError('score_invalid');
      // Capture the caller's spoken numeric rating, separate from confirmation.
      const numberWords=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
      const norwegian=['null','en','to','tre','fire','fem','seks','sju','åtte','ni','ti'];
      const score=c['score'];
      if(!containsWords(callerText,String(score)) && !containsWords(callerText,numberWords[score]??'') && !containsWords(callerText,norwegian[score]??''))throw new PracticeError('caller_words_required');
      command={type,id:target(),week,score,reflection:quoted(callerText,c?.['reflection']),confirmed:confirmation()};break;
    }
    case 'pause':
      confirmation();
      if(!/\b(pause|stop|stopp|paus)\b/iu.test(callerText))throw new PracticeError('caller_confirmation_required');
      command={type};break;
    default: throw new PracticeError('command_not_allowed');
  }
  if(existing) {
    if(normalise(existing.callerText)!==normalise(callerText) || JSON.stringify(existing.command)!==JSON.stringify(command))throw new PracticeError('event_conflict');
    return snapshot;
  }
  const next=structuredClone(snapshot);
  next.practice=applyCommand(snapshot.practice,command,id,now);next.receipts.push({id,callerText,command});
  if(command.type==='practice')next.coverage[command.id]=command.passed?'passed':'done';
  if(command.type==='review')next.coverage[command.id]='done';
  if(next.receipts.length>100)throw new PracticeError('session_full');
  return next;
}
/** Reconcile against the signed caller transcript before canonical memory changes. */
export function verifiedPractice(snapshot: Snapshot, callerTranscript: string): Practice {
  if(snapshot.receipts.some(r=>!containsWords(callerTranscript,r.callerText)))throw new PracticeError('transcript_unconfirmed');
  return snapshot.practice;
}
export function fullCoverage(snapshot: Snapshot, kind: Kind): boolean {
  if(kind==='onboarding')return snapshot.practice.understood;
  return activeBeliefs(snapshot.initial).every(b=>snapshot.coverage[b.id]==='done') && activeBeliefs(snapshot.initial).length>0;
}

/** Closed sessions retain identifiers/coverage, not another copy of private words. */
export function closedSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({revision:snapshot.revision,beliefVersions:snapshot.initial.beliefs.map(b=>({id:b.id,version:b.version})),events:snapshot.receipts.map(r=>r.id),closed:true});
}
