import { randomUUID, createHash } from 'node:crypto';
import { PracticeError, wording } from '../beliefs/model.ts';
import { describeAppointment, localDate, nextSlotAfter, parseLocalTime, parseWeekday, zonedTimeToUtc } from '../schedule/time.ts';
import { CHAPTER_WEEKS, MAX_CALLS, MIN_CALLS, chapterOfMonth, chapterPos, chapterTheme, type Chapter } from './chapters.ts';

/**
 * The programme follows a monthly subscription, one chapter per month. Inside a chapter the calls are numbered 1..n
 * (n = calls per month, 1-8, default 4) and call n is always the chapter close. Month 1 also has an opening call that is not counted.
 */
export const DEFAULT_CALLS = CHAPTER_WEEKS;
export { MAX_CALLS, MIN_CALLS };
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
/** `month` scopes an entry to its chapter (1 when absent: entries from before chapters existed). `week` is the call number inside that chapter. */
export interface Block { id: string; wishVersion: number; text: string; kind: BlockKind; week: number; at: string; month?: number; }
export interface Step { week: number; text: string; outcome: Outcome | null; outcomeText: string; at: string; outcomeAt?: string; month?: number; }
export interface LedgerEntry { id: string; week: number; occurredOn: string; text: string; source: LightSource; at: string; month?: number; }
export interface Closing { text: string; carryText: string; at: string; month?: number; }
export interface Programme {
  schema: 1; revision: number; state: 'active' | 'paused' | 'completed';
  /** Verified held calls in the current chapter (not counting the opening call). */
  openingHeld: boolean; weeksHeld: number;
  /** Chapter sequence number: month 1 is chapter 1, month 13 is chapter 2 of year 2 (see chapterPos). Absent = 1. */
  month?: number;
  /** Calls in the current chapter including the close, frozen at chapter start. Absent = 4. */
  chapterCalls?: number;
  chapterStartedAt?: string;
  /** Closings of finished chapters; `closing` is the current chapter's. */
  closings?: Closing[];
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

export const monthOf = (p: Programme): number => p.month ?? 1;
export const chapterOfMonthOf = (p: Programme): Chapter => chapterOfMonth(monthOf(p));
export const callsOf = (p: Programme): number => p.chapterCalls ?? DEFAULT_CALLS;
/** True when every call of the current chapter, including the close, has been held. The next chapter starts with the next billing month. */
export const chapterComplete = (p: Programme): boolean => p.openingHeld && p.weeksHeld >= callsOf(p);
export const isCloseWeek = (p: Programme, week: number): boolean => week >= callsOf(p);
export const monthEntries = <T extends { month?: number }>(p: Programme, list: readonly T[], month = monthOf(p)): T[] => list.filter(e => (e.month ?? 1) === month);

/** Where the caller is. Derived only from verified held calls, never from the calendar. The programme only completes when the subscription ends. */
export type Arc = { stage: 'opening' } | { stage: 'week'; week: number } | { stage: 'complete' };
export function arc(p: Programme): Arc {
  if (p.state === 'completed') return { stage: 'complete' };
  if (!p.openingHeld) return { stage: 'opening' };
  return { stage: 'week', week: Math.min(p.weeksHeld + 1, callsOf(p)) };
}
/** What the single recurring weekly slot delivers next. A missed call is not made up: the same stage is offered at the next slot. */
export function slotKind(p: Programme): CallKind | undefined {
  const a = arc(p);
  return a.stage === 'opening' ? 'opening' : a.stage === 'week' ? 'weekly' : undefined;
}
/** The value of {{week}}: 0 for the opening call, otherwise the call number inside the chapter (1..calls). */
export function callWeek(p: Programme, kind: CallKind): number {
  if (kind === 'opening') return 0;
  const a = arc(p);
  return a.stage === 'week' ? a.week : callsOf(p);
}

/** A new chapter after the previous one's close: step 1 of the next chapter, calls frozen for the month. Pure. */
export function rollChapter(current: Programme, calls: number, startedAt: Date): Programme {
  const p = structuredClone(current);
  if (p.closing) (p.closings ??= []).push({ ...p.closing, month: p.closing.month ?? monthOf(p) });
  p.closing = null; p.month = monthOf(p) + 1; p.weeksHeld = 0; p.chapterCalls = parseCalls(calls); p.chapterStartedAt = startedAt.toISOString(); p.revision++;
  return p;
}
/** First activation of the subscription (or a return after it ended with no chapter in progress): the chapter clock starts. Pure. */
export function startChapter(current: Programme, calls: number, startedAt: Date): Programme {
  const p = structuredClone(current);
  p.month = monthOf(p); p.weeksHeld = p.weeksHeld ?? 0; p.chapterCalls = parseCalls(calls); p.chapterStartedAt = startedAt.toISOString(); p.revision++;
  return p;
}
/** Shorten the current chapter so the call being claimed is its close (the period is ending or no later slot remains). Pure. */
export function closeAt(current: Programme, week: number): Programme {
  if (week >= callsOf(current)) return current;
  const p = structuredClone(current); p.chapterCalls = week; p.revision++;
  return p;
}
export function parseCalls(value: unknown): number {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_CALLS && n <= MAX_CALLS ? n : fail('calls_invalid');
}

export interface Schedule { timezone: string; weeklyWeekday: number | null; weeklyMinute: number | null; lightWeekdays: number[]; lightMinute: number | null; }
export function lightEnabled(p: Programme, s: Pick<Schedule, 'lightWeekdays' | 'lightMinute'>): boolean {
  return p.state === 'active' && p.openingHeld && s.lightWeekdays.length > 0 && s.lightMinute !== null;
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
 * Up to `max` entries for the closing call, verbatim and never ranked by content.
 * Newest entry of each group in turn (latest group first), so the read-back is both recent and spread;
 * output is chronological. Groups are the call number inside a chapter, or the chapter itself for the year read-back.
 */
export function selectLedgerReadback(ledger: readonly LedgerEntry[], max = LEDGER_READBACK_MAX, group: (e: LedgerEntry) => number = e => e.week): LedgerEntry[] {
  const keys = [...new Set(ledger.map(group))].sort((a, b) => b - a);
  const queues = new Map(keys.map(w => [w, ledger.filter(e => group(e) === w).sort((a, b) => b.at.localeCompare(a.at) || b.occurredOn.localeCompare(a.occurredOn))]));
  const picked: LedgerEntry[] = [];
  while (picked.length < Math.min(max, ledger.length)) {
    for (const w of keys) { const next = queues.get(w)!.shift(); if (next && picked.length < max) picked.push(next); }
  }
  return picked.sort((a, b) => a.at.localeCompare(b.at) || a.occurredOn.localeCompare(b.occurredOn));
}
/** What the close reads back: this chapter's ledger, or for the year chapter one-per-chapter across the year. */
export function closeReadback(p: Programme, chapter: Chapter): LedgerEntry[] {
  if (chapter.readback === 'chapter') return selectLedgerReadback(monthEntries(p, p.ledger));
  const year = chapterPos(monthOf(p)).year;
  return selectLedgerReadback(p.ledger.filter(e => chapterPos(e.month ?? 1).year === year), LEDGER_READBACK_MAX, e => e.month ?? 1);
}

export interface SignOffInput { cancelling: boolean; ended: boolean; nextCallAt: Date | null; }
export type SignOff = { mode: 'continue' | 'paused' | 'ending'; next_chapter_title?: string; next_call_local?: string; next_call_weekday?: string };
/**
 * What the guide may say at the end of a call. Facts only: never a price, an offer or a sales line.
 * continue: the real next call (and, after a close, the next chapter's title). paused: calls are paused until the caller resumes in the account.
 * ending: the subscription is ending, so this is the last call for now and everything stays in the private account.
 */
export function signOff(p: Programme, input: SignOffInput, timezone: string, close: boolean): SignOff {
  if (p.state === 'paused') return { mode: 'paused' };
  if (input.ended || p.state === 'completed' || (input.cancelling && close)) return { mode: 'ending' };
  const out: SignOff = { mode: 'continue' };
  if (close) out.next_chapter_title = chapterOfMonth(monthOf(p) + 1).title;
  if (input.nextCallAt) {
    out.next_call_local = describeAppointment(input.nextCallAt, timezone);
    out.next_call_weekday = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long' }).format(input.nextCallAt);
  }
  return out;
}

/** A human-support address has no purpose in a voice prompt or tool response. */
export function voiceProgramme(p: Programme, ctx: { kind: CallKind; week: number; preferredName: string; schedule?: Schedule; cancelling?: boolean; ended?: boolean; nextCallAt?: Date | null }): Record<string, unknown> {
  const wish = currentWish(p);
  const weekly = ctx.kind === 'weekly';
  const calls = callsOf(p), month = monthOf(p), pos = chapterPos(month), chapter = chapterOfMonth(month);
  const close = weekly && isCloseWeek(p, ctx.week);
  const slot = ctx.schedule && ctx.schedule.weeklyWeekday !== null && ctx.schedule.weeklyMinute !== null
    ? { weekday: ctx.schedule.weeklyWeekday, time: clock(ctx.schedule.weeklyMinute), timezone: ctx.schedule.timezone } : undefined;
  const lightOn = ctx.schedule ? lightEnabled(p, ctx.schedule) : false;
  const steps = monthEntries(p, p.steps);
  const moments = monthEntries(p, p.ledger);
  const tz = ctx.schedule?.timezone ?? 'Europe/Oslo';
  return {
    state: p.state,
    stage: ctx.kind === 'opening' ? 'opening' : ctx.kind === 'light' ? 'light' : `week_${ctx.week}`,
    chapter: { number: pos.number, year: pos.year, title: chapter.title, calls_this_month: calls, call: weekly ? ctx.week : 0 },
    ...(weekly ? { chapter_theme: chapterTheme(chapter, Math.min(ctx.week, calls), calls) } : {}),
    is_close: close,
    sign_off: signOff(p, { cancelling: !!ctx.cancelling, ended: !!ctx.ended, nextCallAt: ctx.nextCallAt ?? null }, tz, close),
    wish: wish ? { version: wish.version, text: wish.text, why_text: wish.why } : null,
    blocks: p.blocks.filter(b => !wish || b.wishVersion === wish.version).map(b => ({ text: b.text, kind: b.kind })),
    steps: steps.map(s => ({ week: s.week, text: s.text, outcome: s.outcome, outcome_text: s.outcomeText })),
    last_step: steps.find(s => s.week === ctx.week && s.outcome === null)?.text ?? null,
    light_calls: { enabled: lightOn, days: ctx.schedule?.lightWeekdays ?? [], time: ctx.schedule?.lightMinute != null ? clock(ctx.schedule.lightMinute) : null },
    ledger_count: p.ledger.length,
    ledger_readback: close ? closeReadback(p, chapter).map(e => ({ occurred_on: e.occurredOn, text: e.text })) : [],
    // The caller's own saved words for this month, only for the close: the guide builds the summary from these and nothing else.
    ...(close ? { month_words: { steps: steps.map(s => ({ text: s.text, outcome: s.outcome, outcome_text: s.outcomeText })),
      moments: selectLedgerReadback(moments, 10).map(e => ({ occurred_on: e.occurredOn, text: e.text })),
      blocks: monthEntries(p, p.blocks).map(b => ({ text: b.text, kind: b.kind })) } } : {}),
    call_context: { preferred_name: ctx.preferredName, call_kind: ctx.kind, week: ctx.week, ...(slot ? { weekly_slot: slot } : {}) },
  };
}
const clock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Capture kinds that count as a held call; interrupted calls keep their verified saves but do not advance the arc. */
export function callHeld(kind: CallKind, week: number, captured: readonly string[], calls = DEFAULT_CALLS): boolean {
  if (kind === 'light') return true;
  if (kind === 'weekly' && week >= calls) return captured.includes('closing');
  return captured.some(t => t !== 'pause');
}
/** Advance the arc after a verified held call. Runs on the canonical aggregate only. */
export function finishCall(current: Programme, kind: CallKind, week: number): Programme {
  const p = structuredClone(current);
  if (p.state === 'completed') return p;
  if (kind === 'opening' && !p.openingHeld) { p.openingHeld = true; p.revision++; }
  if (kind === 'weekly' && p.openingHeld && week === p.weeksHeld + 1) {
    p.weeksHeld = week; p.revision++;
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
      p.blocks.push({ id: randomUUID(), wishVersion: wish.version, text: wording(command.text), kind: parseBlockKind(command.kind), week: command.week, at, month: monthOf(p) });
      break;
    }
    case 'step': {
      if (!Number.isInteger(command.week) || command.week < 1 || command.week > callsOf(p)) fail('week_invalid');
      const text = wording(command.text), existing = p.steps.find(s => s.week === command.week && (s.month ?? 1) === monthOf(p));
      if (existing) { if (existing.outcome !== null) fail('step_locked'); existing.text = text; existing.at = at; }
      else p.steps.push({ week: command.week, text, outcome: null, outcomeText: '', at, month: monthOf(p) });
      p.steps.sort((a, b) => (a.month ?? 1) - (b.month ?? 1) || a.week - b.week);
      break;
    }
    case 'step_outcome': {
      const step = p.steps.find(s => s.week === command.week && (s.month ?? 1) === monthOf(p)) ?? fail('step_unknown');
      if (step.outcome !== null) fail('outcome_recorded');
      step.outcome = parseOutcome(command.outcome);
      step.outcomeText = typeof command.outcomeText === 'string' && command.outcomeText.trim() ? wording(command.outcomeText) : '';
      step.outcomeAt = at;
      break;
    }
    case 'light': {
      if (!DATE.test(command.occurredOn) || !['light_call', 'weekly_call'].includes(command.source)) fail('light_invalid');
      if (p.ledger.length >= 500) fail('ledger_full');
      p.ledger.push({ id: randomUUID(), week: command.week, occurredOn: command.occurredOn, text: wording(command.text), source: command.source, at, month: monthOf(p) });
      break;
    }
    case 'closing': {
      if (p.closing) fail('closing_recorded');
      p.closing = { text: wording(command.text), carryText: typeof command.carryText === 'string' && command.carryText.trim() ? wording(command.carryText) : '', at, month: monthOf(p) };
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
