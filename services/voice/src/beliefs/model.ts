import { randomUUID, createHash } from 'node:crypto';

export type BeliefStatus = 'queued' | 'preparing' | 'active' | 'retired';
export interface Evidence { text: string; at: string; }
export interface Review { week: number; score: number; at: string; reflection: string; }
export interface DecisionVersion {
  version: number; decision: string; evidence: Evidence[]; balance: string; opportunity: string; reviews: Review[];
}
export interface Belief {
  id: string; version: number; belief: string; trigger: string; status: BeliefStatus;
  decision: string; evidence: Evidence[]; balance: string; opportunity: string;
  confirmed: boolean; reviews: Review[];
  versions?: DecisionVersion[];
}
export interface Practice {
  schema: 1; revision: number; outcome: string; understood: boolean; cap: 2 | 3;
  state: 'onboarding' | 'active' | 'paused' | 'completed';
  beliefs: Belief[]; events: string[];
  eventDigests?: Record<string,string>;
  contact?: { name: string; email: string };
}
export type Command =
  | { type: 'outcome'; outcome: string }
  | { type: 'queue'; belief: string; trigger: string }
  | { type: 'prepare'; id: string; decision: string; evidence: string[]; balance: string; opportunity: string; confirmed: boolean }
  | { type: 'understood'; confirmed: boolean }
  | { type: 'practice'; id: string; evidence?: string; balance?: string; passed?: boolean }
  | { type: 'review'; id: string; week: number; score: number; reflection: string; confirmed: boolean }
  | { type: 'reactivate'; id: string }
  | { type: 'reorder'; ids: string[] }
  | { type: 'pause' | 'resume' };

export class PracticeError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new PracticeError(code); };
export function wording(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('wording_required');
  return (value as string).trim();
}
export const emptyPractice = (cap: 2 | 3 = 2): Practice => ({
  schema: 1, revision: 0, outcome: '', understood: false, cap, state: 'onboarding', beliefs: [], events: [],
});
export const activeBeliefs = (p: Practice): Belief[] => p.beliefs.filter(b => b.status === 'active');
/** A human-support address has no purpose in a voice prompt or tool response. */
export function voicePractice(p:Practice):Omit<Practice,'contact'> {
  const result=structuredClone(p);delete result.contact;return result;
}
export function nextPracticeAppointment(p:Practice, times:{daily?:Date|null;weekly?:Date|null;onboarding?:Date|null}, now=new Date()):{kind:'daily'|'weekly'|'onboarding';at:Date}|undefined {
  if(['paused','completed'].includes(p.state))return undefined;
  const candidates=p.understood?[...(activeBeliefs(p).length?[{kind:'daily' as const,at:times.daily}]:[]),{kind:'weekly' as const,at:times.weekly}]:[{kind:'onboarding' as const,at:times.onboarding}];
  return candidates.filter((item):item is {kind:'daily'|'weekly'|'onboarding';at:Date}=>!!item.at && item.at>now).sort((a,b)=>+a.at-+b.at)[0];
}
const prepared = (b: Belief): boolean => !!(b.confirmed && b.decision && b.evidence.length && b.balance && b.opportunity);
function archive(b: Belief): void {
  (b.versions ??= []).push(structuredClone({version:b.version,decision:b.decision,evidence:b.evidence,balance:b.balance,opportunity:b.opportunity,reviews:b.reviews}));
}

function fill(p: Practice, freshlyConfirmed: string[] = []): void {
  let vacancies = p.cap - activeBeliefs(p).length;
  for (const b of p.beliefs) if(b.status==='preparing')b.status='queued';
  for (const b of p.beliefs) {
    if (vacancies <= 0) break;
    if (b.status !== 'queued' && b.status !== 'preparing') continue;
    // Selection follows the caller's order; unprepared material is never activated.
    b.status = prepared(b) && freshlyConfirmed.includes(b.id) ? 'active' : 'preparing';
    vacancies--;
  }
  if (p.understood && activeBeliefs(p).length) p.state = 'active';
  if (p.beliefs.length && p.beliefs.every(b => b.status === 'retired')) p.state = 'completed';
}

/** Pure transitions; the repository serialises them under the account lock. */
export function applyCommand(current: Practice, command: Command, eventId: string, now = new Date()): Practice {
  wording(eventId, 200);
  const digest=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  if (current.events.includes(eventId)) {
    if(current.eventDigests?.[eventId]!==digest)fail('event_conflict');
    return current;
  }
  const p = structuredClone(current);
  if (p.state === 'paused' && !['resume', 'reorder', 'outcome'].includes(command.type)) fail('practice_paused');
  const item = (id: string): Belief => p.beliefs.find(b => b.id === id) ?? fail('belief_unknown');
  switch (command.type) {
    case 'outcome': p.outcome = wording(command.outcome); break;
    case 'queue': {
      if (p.understood) fail('discovery_complete');
      if (p.beliefs.length >= 50) fail('backlog_full');
      p.beliefs.push({ id: randomUUID(), version: 1, belief: wording(command.belief), trigger: wording(command.trigger),
        status: 'queued', decision: '', evidence: [], balance: '', opportunity: '', confirmed: false, reviews: [] });
      if (p.state === 'completed') p.state = 'onboarding';
      fill(p); break;
    }
    case 'prepare': {
      const b = item(command.id);
      if (b.status === 'retired') fail('reactivation_required');
      if (b.status === 'queued') fail('preparation_not_due');
      if (command.confirmed !== true) fail('caller_confirmation_required');
      if (!Array.isArray(command.evidence) || !command.evidence.length || command.evidence.length > 20) fail('evidence_required');
      const decision = wording(command.decision);
      if (b.decision && b.decision !== decision) { archive(b); b.version++; b.reviews = []; }
      b.decision = decision; b.balance = wording(command.balance); b.opportunity = wording(command.opportunity);
      b.evidence = command.evidence.map(text => ({ text: wording(text), at: now.toISOString() }));
      b.confirmed = true; fill(p,[b.id]); break;
    }
    case 'understood':
      if (command.confirmed !== true || !p.outcome || activeBeliefs(p).length < 2 || p.beliefs.length <= p.cap) fail('onboarding_incomplete');
      p.understood = true; fill(p); break;
    case 'practice': {
      const b = item(command.id);
      if (p.state !== 'active' || b.status !== 'active') fail('belief_inactive');
      if (!command.passed) {
        if (command.evidence?.trim()) {
          b.evidence.push({ text: wording(command.evidence), at: now.toISOString() });
          if (b.evidence.length > 1000) fail('evidence_bank_full');
        }
        if (command.balance?.trim()) b.balance = wording(command.balance);
      }
      break;
    }
    case 'review': {
      const b = item(command.id);
      if (p.state !== 'active' || b.status !== 'active') fail('belief_inactive');
      if (command.confirmed !== true) fail('caller_confirmation_required');
      if (!Number.isInteger(command.score) || command.score < 0 || command.score > 10) fail('score_invalid');
      if (!Number.isInteger(command.week) || command.week < 0) fail('week_invalid');
      const previous = b.reviews.at(-1);
      if (previous && command.week <= previous.week) fail('review_already_recorded');
      b.reviews.push({ week: command.week, score: command.score, at: now.toISOString(), reflection: wording(command.reflection) });
      if (command.score <= 1 && previous && previous.score <= 1 && previous.week + 1 === command.week) b.status = 'retired';
      fill(p); break;
    }
    case 'reactivate': {
      if (p.state === 'completed') fail('programme_complete');
      const b = item(command.id);
      if (b.status !== 'retired') fail('belief_not_retired');
      archive(b); b.status = 'queued'; b.version++; b.reviews = [];
      fill(p,[b.id]); break;
    }
    case 'reorder': {
      if (command.ids.length !== p.beliefs.length || new Set(command.ids).size !== p.beliefs.length) fail('order_invalid');
      p.beliefs = command.ids.map(item);
      if(!p.understood)for(const b of p.beliefs)if(b.status==='active')b.status='queued';
      fill(p,p.understood?[]:p.beliefs.filter(prepared).map(b=>b.id)); break;
    }
    case 'pause': if(p.state==='completed')fail('programme_complete');p.state = 'paused'; break;
    case 'resume': if(p.state==='completed')fail('programme_complete');p.state = p.understood ? 'active' : 'onboarding'; fill(p); break;
    default: fail('command_unknown');
  }
  if (activeBeliefs(p).length > p.cap) fail('active_cap_exceeded');
  p.revision++; p.events.push(eventId);
  Object.defineProperty(p.eventDigests ??= {},eventId,{value:digest,enumerable:true,writable:true,configurable:true});
  if (p.events.length > 5000) fail('event_history_full');
  return p;
}
