import { randomUUID, createHash } from 'node:crypto';
import { PracticeError, wording } from '../beliefs/model.ts';
import { localDate, nextSlotAfter, parseLocalTime, parseWeekday, zonedTimeToUtc } from '../schedule/time.ts';

/** The programme is finite: one opening call, four weekly calls, the last of which is the closing call. */
export const ARC_WEEKS = 4;
export const LEDGER_READBACK_MAX = 5;
/** First weekly call is never sooner than this after a verified opening call. */
export const FIRST_WEEK_GAP_DAYS = 5;
export const DEFAULT_LIGHT_DAYS = [1, 3, 5];
export const DEFAULT_LIGHT_MINUTE = 19 * 60;

export type CallKind = 'opening' | 'weekly' | 'light';
export type BlockKind = 'limit' | 'prediction' | 'unsure';
export type Outcome = 'done' | 'partly' | 'not' | 'changed';
export type LightSource = 'light_call' | 'weekly_call';
export interface Wish { version: number; text: string; why: string; at: string; }
export interface Block { id: string; wishVersion: number; text: string; kind: BlockKind; week: number; at: string; }
export interface Step { week: number; text: string; outcome: Outcome | null; outcomeText: string; at: string; outcomeAt?: string; }
export interface LedgerEntry { id: string; week: number; occurredOn: string; text: string; source: LightSource; at: string; }
export interface Closing { text: string; carryText: string; at: string; }
export interface Programme {
  schema: 1; revision: number; state: 'active' | 'paused' | 'completed';
  openingHeld: boolean; weeksHeld: number;
  wishes: Wish[]; blocks: Block[]; steps: Step[]; ledger: LedgerEntry[]; closing: Closing | null;
  /** The caller's last spoken light-call choice. Empty days means "no light calls". */
  light?: { days: number[]; minute: number | null; seq: number };
  events: string[]; eventDigests?: Record<string, string>;
  contact?: { name: string; email: string };
}
export type Command =
  | { type: 'wish'; text: string; why: string }
  | { type: 'block'; text: string; kind: BlockKind; week: number }
  | { type: 'step'; week: number; text: string }
  | { type: 'step_outcome'; week: number; outcome: Outcome; outcomeText: string }
  | { type: 'light'; text: string; occurredOn: string; source: LightSource; week: number }
  | { type: 'closing'; text: string; carryText: string }
  | { type: 'light_schedule'; days: number[]; minute: number | null }
  | { type: 'pause' | 'resume' };
/** Commands the caller can give by voice. `resume` is a private-account action. */
export const VOICE_COMMANDS = ['wish', 'block', 'step', 'step_outcome', 'light', 'closing', 'light_schedule', 'pause'] as const;

const fail = (code: string): never => { throw new PracticeError(code); };
export const emptyProgramme = (): Programme => ({
  schema: 1, revision: 0, state: 'active', openingHeld: false, weeksHeld: 0,
  wishes: [], blocks: [], steps: [], ledger: [], closing: null, events: [],
});
export const currentWish = (p: Programme): Wish | undefined => p.wishes.at(-1);

/** Where the caller is in the arc. Derived only from verified calls, never from the calendar. */
export type Arc = { stage: 'opening' } | { stage: 'week'; week: number } | { stage: 'complete' };
export function arc(p: Programme): Arc {
  if (p.state === 'completed' || p.weeksHeld >= ARC_WEEKS) return { stage: 'complete' };
  if (!p.openingHeld) return { stage: 'opening' };
  return { stage: 'week', week: p.weeksHeld + 1 };
}
/** What the single recurring weekly slot delivers next. A missed call is not made up: the same stage is offered at the next slot. */
export function slotKind(p: Programme): CallKind | undefined {
  const a = arc(p);
  return a.stage === 'opening' ? 'opening' : a.stage === 'week' ? 'weekly' : undefined;
}
/** The value of {{week}}: 0 for the opening call, 1..4 otherwise. */
export function callWeek(p: Programme, kind: CallKind): number {
  if (kind === 'opening') return 0;
  const a = arc(p);
  return a.stage === 'week' ? a.week : ARC_WEEKS;
}

export interface Schedule { timezone: string; weeklyWeekday: number | null; weeklyMinute: number | null; lightWeekdays: number[]; lightMinute: number | null; }
export function lightEnabled(p: Programme, s: Pick<Schedule, 'lightWeekdays' | 'lightMinute'>): boolean {
  return p.state === 'active' && p.openingHeld && arc(p).stage === 'week' && s.lightWeekdays.length > 0 && s.lightMinute !== null;
}
export function nextLight(after: Date, days: readonly number[], minute: number, timezone: string): Date | null {
  return days.length ? new Date(Math.min(...days.map(weekday => +nextSlotAfter(after, { weekday, minute, timezone })))) : null;
}
export function firstWeekly(openingDone: Date, s: Pick<Schedule, 'weeklyWeekday' | 'weeklyMinute' | 'timezone'>): Date | null {
  return s.weeklyWeekday === null || s.weeklyMinute === null ? null
    : nextSlotAfter(new Date(+openingDone + FIRST_WEEK_GAP_DAYS * 86400_000), { weekday: s.weeklyWeekday, minute: s.weeklyMinute, timezone: s.timezone });
}
/** The caller's local calendar date for a ledger entry. */
export function localDay(at: Date, timezone: string): string {
  const d = localDate(at, timezone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}
export { zonedTimeToUtc };

/** "mon, wed and fri" / "" → weekday numbers (0 = Sunday). Unknown words fail rather than being guessed. */
export function parseDays(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string' || value.length > 200) return fail('days_invalid');
  const tokens = value.toLowerCase().split(/[\s,;/&+]+|\b(?:and|og)\b/u).map(t => t.trim()).filter(Boolean);
  const days = tokens.map(t => parseWeekday(NORWEGIAN_DAYS[t] ?? t) ?? fail('days_invalid'));
  return [...new Set(days)].sort((a, b) => a - b);
}
const NORWEGIAN_DAYS: Record<string, string> = { søndag: 'sunday', mandag: 'monday', tirsdag: 'tuesday', onsdag: 'wednesday', torsdag: 'thursday', fredag: 'friday', lørdag: 'saturday', søn: 'sun', man: 'mon', tir: 'tue', ons: 'wed', tor: 'thu', fre: 'fri', lør: 'sat' };
export function parseTime(value: unknown): number {
  const minute = typeof value === 'string' ? parseLocalTime(value) : undefined;
  return minute === undefined ? fail('time_invalid') : minute;
}
export function parseOutcome(value: unknown): Outcome {
  return typeof value === 'string' && ['done', 'partly', 'not', 'changed'].includes(value) ? value as Outcome : fail('outcome_invalid');
}
export function parseBlockKind(value: unknown): BlockKind {
  return value === undefined || value === '' ? 'unsure' : typeof value === 'string' && ['limit', 'prediction', 'unsure'].includes(value) ? value as BlockKind : fail('kind_invalid');
}

/**
 * Up to five entries for the closing call, verbatim and never ranked by content.
 * Newest entry of each programme week in turn (latest week first), so the read-back
 * is both recent and spread across the weeks; output is chronological.
 */
export function selectLedgerReadback(ledger: readonly LedgerEntry[], max = LEDGER_READBACK_MAX): LedgerEntry[] {
  const weeks = [...new Set(ledger.map(e => e.week))].sort((a, b) => b - a);
  const queues = new Map(weeks.map(w => [w, ledger.filter(e => e.week === w).sort((a, b) => b.at.localeCompare(a.at) || b.occurredOn.localeCompare(a.occurredOn))]));
  const picked: LedgerEntry[] = [];
  while (picked.length < Math.min(max, ledger.length)) {
    for (const w of weeks) { const next = queues.get(w)!.shift(); if (next && picked.length < max) picked.push(next); }
  }
  return picked.sort((a, b) => a.at.localeCompare(b.at) || a.occurredOn.localeCompare(b.occurredOn));
}

/** A human-support address has no purpose in a voice prompt or tool response. */
export function voiceProgramme(p: Programme, ctx: { kind: CallKind; week: number; preferredName: string; schedule?: Schedule }): Record<string, unknown> {
  const wish = currentWish(p);
  const week4 = ctx.kind === 'weekly' && ctx.week === ARC_WEEKS;
  const slot = ctx.schedule && ctx.schedule.weeklyWeekday !== null && ctx.schedule.weeklyMinute !== null
    ? { weekday: ctx.schedule.weeklyWeekday, time: clock(ctx.schedule.weeklyMinute), timezone: ctx.schedule.timezone } : undefined;
  const lightOn = ctx.schedule ? lightEnabled(p, ctx.schedule) : false;
  return {
    state: p.state,
    stage: ctx.kind === 'opening' ? 'opening' : ctx.kind === 'light' ? 'light' : `week_${ctx.week}`,
    wish: wish ? { version: wish.version, text: wish.text, why_text: wish.why } : null,
    blocks: p.blocks.filter(b => !wish || b.wishVersion === wish.version).map(b => ({ text: b.text, kind: b.kind })),
    steps: p.steps.map(s => ({ week: s.week, text: s.text, outcome: s.outcome, outcome_text: s.outcomeText })),
    last_step: p.steps.find(s => s.week === ctx.week && s.outcome === null)?.text ?? null,
    light_calls: { enabled: lightOn, days: ctx.schedule?.lightWeekdays ?? [], time: ctx.schedule?.lightMinute != null ? clock(ctx.schedule.lightMinute) : null },
    ledger_count: p.ledger.length,
    ledger_readback: week4 ? selectLedgerReadback(p.ledger).map(e => ({ occurred_on: e.occurredOn, text: e.text })) : [],
    call_context: { preferred_name: ctx.preferredName, call_kind: ctx.kind, week: ctx.week, ...(slot ? { weekly_slot: slot } : {}) },
  };
}
const clock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Capture kinds that count as a held call; interrupted calls keep their verified saves but do not advance the arc. */
export function callHeld(kind: CallKind, week: number, captured: readonly string[]): boolean {
  if (kind === 'light') return true;
  if (kind === 'weekly' && week === ARC_WEEKS) return captured.includes('closing');
  return captured.some(t => t !== 'pause');
}
/** Advance the arc after a verified held call. Runs on the canonical aggregate only. */
export function finishCall(current: Programme, kind: CallKind, week: number): Programme {
  const p = structuredClone(current);
  if (p.state === 'completed') return p;
  if (kind === 'opening' && !p.openingHeld) { p.openingHeld = true; p.revision++; }
  if (kind === 'weekly' && p.openingHeld && week === p.weeksHeld + 1) {
    p.weeksHeld = week; p.revision++;
    if (week >= ARC_WEEKS) p.state = 'completed';
  }
  return p;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Pure transitions; the repository serialises them under the account lock. */
export function applyCommand(current: Programme, command: Command, eventId: string, now = new Date()): Programme {
  wording(eventId, 200);
  const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  if (current.events.includes(eventId)) {
    if (current.eventDigests?.[eventId] !== digest) fail('event_conflict');
    return current;
  }
  const p = structuredClone(current);
  const at = now.toISOString();
  if (p.state === 'completed') fail('programme_complete');
  if (p.state === 'paused' && command.type !== 'resume') fail('programme_paused');
  switch (command.type) {
    case 'wish': {
      const text = wording(command.text), why = typeof command.why === 'string' && command.why.trim() ? wording(command.why) : '';
      const wish = currentWish(p);
      // A revision keeps the earlier version privately; an identical restatement changes nothing.
      if (!wish || wish.text !== text || (why && wish.why !== why)) p.wishes.push({ version: (wish?.version ?? 0) + 1, text, why: why || (wish?.text === text ? wish.why : ''), at });
      break;
    }
    case 'block': {
      const wish = currentWish(p) ?? fail('wish_required');
      if (p.blocks.length >= 100) fail('blocks_full');
      p.blocks.push({ id: randomUUID(), wishVersion: wish.version, text: wording(command.text), kind: parseBlockKind(command.kind), week: command.week, at });
      break;
    }
    case 'step': {
      if (!Number.isInteger(command.week) || command.week < 1 || command.week > ARC_WEEKS) fail('week_invalid');
      const text = wording(command.text), existing = p.steps.find(s => s.week === command.week);
      if (existing) { if (existing.outcome !== null) fail('step_locked'); existing.text = text; existing.at = at; }
      else p.steps.push({ week: command.week, text, outcome: null, outcomeText: '', at });
      p.steps.sort((a, b) => a.week - b.week);
      break;
    }
    case 'step_outcome': {
      const step = p.steps.find(s => s.week === command.week) ?? fail('step_unknown');
      if (step.outcome !== null) fail('outcome_recorded');
      step.outcome = parseOutcome(command.outcome);
      step.outcomeText = typeof command.outcomeText === 'string' && command.outcomeText.trim() ? wording(command.outcomeText) : '';
      step.outcomeAt = at;
      break;
    }
    case 'light': {
      if (!DATE.test(command.occurredOn) || !['light_call', 'weekly_call'].includes(command.source)) fail('light_invalid');
      if (p.ledger.length >= 500) fail('ledger_full');
      p.ledger.push({ id: randomUUID(), week: command.week, occurredOn: command.occurredOn, text: wording(command.text), source: command.source, at });
      break;
    }
    case 'closing': {
      if (p.closing) fail('closing_recorded');
      p.closing = { text: wording(command.text), carryText: typeof command.carryText === 'string' && command.carryText.trim() ? wording(command.carryText) : '', at };
      break;
    }
    case 'light_schedule': {
      const days = [...new Set(command.days)].sort((a, b) => a - b);
      if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail('days_invalid');
      if (days.length && (command.minute === null || !Number.isInteger(command.minute) || command.minute < 0 || command.minute > 1439)) fail('time_invalid');
      p.light = { days, minute: days.length ? command.minute : null, seq: (p.light?.seq ?? 0) + 1 };
      break;
    }
    case 'pause': p.state = 'paused'; break;
    case 'resume': p.state = 'active'; break;
    default: fail('command_unknown');
  }
  p.revision++; p.events.push(eventId);
  if (p.events.length > 5000) fail('event_history_full');
  Object.defineProperty(p.eventDigests ??= {}, eventId, { value: digest, enumerable: true, writable: true, configurable: true });
  return p;
}
