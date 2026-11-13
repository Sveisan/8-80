import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { nextSlotAfter, parseLocalTime, parseWeekday } from '../schedule/time.ts';
import { PracticeError } from '../beliefs/model.ts';
import { appointmentInput } from '../beliefs/repository.ts';
import { withinCoverage } from './coverage.ts';
import { applyCommand, callsOf, chapterComplete, DEFAULT_CALLS, DEFAULT_LIGHT_DAYS, DEFAULT_LIGHT_MINUTE, emptyProgramme, FIRST_WEEK_GAP_DAYS, lightEnabled, monthOf, nextLight, parseCalls, parseDays, rollChapter, slotKind, startChapter, type Command, type Programme, type Schedule } from './model.ts';
import { chapterPos } from './chapters.ts';
import { nextOccurrence, periodEnd, periodStart, planNext, tooClose, weekdaysFor, type Cadence } from './cadence.ts';

export interface Enrollment {
  id: string; is_current: boolean; checkout_reference: string; phone_hash: string; programme_enc: string; revision: number; timezone: string;
  weekly_weekday: number | null; weekly_minute: number | null; light_weekdays: number[]; light_minute: number | null;
  opening_at: Date | null; next_weekly_at: Date | null; next_light_at: Date | null;
  standing: string; provider: string | null; purchase_id: string | null; payment_id: string | null; product_id: string | null;
  customer_id: string | null; paid_at: Date | null; amount_minor: number | null; currency: string | null; completed_at: Date | null;
  subscription_id: string | null; cancel_at_period_end: boolean; paid_until: Date | null; calls_per_month: number; pending_calls_per_month: number | null;
  chapter: number; year: number; chapter_started_at: Date | null; anchor_at: Date | null;
}
/**
 * Calls are placed only while the subscription allows them. Mirrors the weekly product: active and past_due both continue
 * (the provider's own dunning decides when it ends); a cancellation runs to the end of the paid period.
 */
export const callsAllowed = (e: Pick<Enrollment, 'standing' | 'cancel_at_period_end' | 'paid_until'>, now: Date): boolean =>
  (e.standing === 'active' || e.standing === 'past_due') && !(e.cancel_at_period_end && !!e.paid_until && e.paid_until <= now);

const cadenceOf = (e: Pick<Enrollment, 'timezone' | 'weekly_weekday' | 'weekly_minute'>, calls: number): Cadence | null =>
  e.weekly_weekday === null || e.weekly_minute === null ? null : { timezone: e.timezone, weekdays: weekdaysFor(e.weekly_weekday, calls), minute: e.weekly_minute };
/** The current chapter's billing month. When the subscription is set to end, the paid period end closes it. */
export function chapterWindow(e: Enrollment, p: Programme): { start: Date; end: Date } | null {
  if (!e.anchor_at || !p.chapterStartedAt) return null;
  const start = new Date(p.chapterStartedAt); let end = periodEnd(e.anchor_at, start);
  if (e.cancel_at_period_end && e.paid_until && e.paid_until < end) end = e.paid_until;
  return { start, end };
}
/**
 * When the next regular call should be, after `after`. Inside a chapter the remaining calls are spread over the rest of the
 * month so the close lands in the last part; once the close is held the answer is the first call of the next chapter.
 * `remaining` overrides the calls still to hold (the claim passes the count after the call it is placing).
 */
export function planWeekly(e: Enrollment, p: Programme, after: Date, remaining?: number): Date | null {
  const n = callsOf(p); const cad = cadenceOf(e, n); if (!cad) return null;
  const win = chapterWindow(e, p);
  if (!win) return nextOccurrence(cad, after);
  const left = remaining ?? n - p.weeksHeld;
  if (left <= 0) {
    if (e.cancel_at_period_end) return null;
    const calls = e.pending_calls_per_month ?? e.calls_per_month; const next = cadenceOf(e, calls)!;
    const start = after >= win.end ? periodStart(e.anchor_at!, after) : win.end;
    return planNext(next, new Date(Math.max(+after, +start - 1)), periodEnd(e.anchor_at!, start), calls) ?? nextOccurrence(next, after);
  }
  return planNext(cad, after, win.end, left) ?? (e.cancel_at_period_end ? null : nextOccurrence(cad, after));
}
/** The next weekly pointer for the programme as it stands: the opening conversation at its own date or the next usual slot, then the plan. */
export function weeklyPointer(e: Enrollment, p: Programme, now: Date): Date | null {
  if (!p.openingHeld) {
    const cad = cadenceOf(e, callsOf(p)); if (!cad) return null;
    return e.opening_at && e.opening_at > now ? planWeekly(e, p, new Date(+e.opening_at + FIRST_WEEK_GAP_DAYS * 86400_000)) : nextOccurrence(cad, now);
  }
  return planWeekly(e, p, now);
}

export interface ScheduleShape { timezone: string; weekday: number; weekly: number; calls: number[]; lightDays: readonly number[]; lightMinute: number | null; opening?: Date | null; }
/**
 * Every rule a set of usual times must keep, shared by the account and by what a caller says in a call: all calls inside the staffed
 * response hours, 45 minutes between a light call and any regular call (including the second day used by 5-8 calls a month and
 * the next month's choice), and 45 minutes from the weekly 8&80 call. Returns the error code, or undefined when fine.
 */
export function scheduleProblem(s: ScheduleShape, base: { weekday: number; minute: number; timezone: string } | null, now: Date): string | undefined {
  const weekdays = [...new Set(s.calls.flatMap(c => weekdaysFor(s.weekday, c)))];
  const weekly = weekdays.map(weekday => ({ weekday, minute: s.weekly }));
  const light = s.lightMinute === null ? [] : s.lightDays.map(weekday => ({ weekday, minute: s.lightMinute! }));
  if (tooClose(weekly, light)) return 'calls_too_close';
  const instants: Date[] = s.opening ? [s.opening] : [];
  const cad: Cadence = { timezone: s.timezone, weekdays, minute: s.weekly };
  for (let at = now, i = 0; i < 6 * weekdays.length; i++) { at = nextOccurrence(cad, at); instants.push(at); }
  if (s.lightMinute !== null) { let l = now; for (let i = 0; i < 21; i++) { l = nextLight(l, s.lightDays, s.lightMinute, s.timezone)!; instants.push(l); } }
  if (base && instants.some(at => Math.abs(+at - +nextSlotAfter(new Date(+at - 45 * 60_000), base)) < 45 * 60_000)) return 'base_calls_too_close';
  if (!instants.every(at => withinCoverage(at))) return 'outside_coverage';
  return undefined;
}

export const scheduleOf = (e: Enrollment): Schedule => ({ timezone: e.timezone, weeklyWeekday: e.weekly_weekday, weeklyMinute: e.weekly_minute, lightWeekdays: e.light_weekdays ?? [], lightMinute: e.light_minute });

/** Caller-chosen recurring times: weekly slot, optional light evenings (default three), IANA zone with Oslo fallback. */
export function scheduleInput(form: URLSearchParams, now = new Date()) {
  const timezone = (form.get('timezone') ?? '').trim() || 'Europe/Oslo';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now); } catch { throw new PracticeError('timezone_invalid'); }
  const weekly = parseLocalTime(form.get('weekly') ?? ''); const weekday = parseWeekday(form.get('weekday') ?? '');
  if (weekly === undefined || weekday === undefined) throw new PracticeError('schedule_invalid');
  const rawDays = form.get('light_days'); const rawLight = (form.get('light') ?? '').trim();
  const lightDays = rawDays === null || rawDays.trim() === '' ? DEFAULT_LIGHT_DAYS : /^(none|no)$/i.test(rawDays.trim()) ? [] : parseDays(rawDays);
  const lightMinute = rawLight ? parseLocalTime(rawLight) : DEFAULT_LIGHT_MINUTE;
  if (lightMinute === undefined) throw new PracticeError('schedule_invalid');
  const rawCalls = (form.get('calls') ?? '').trim(); const calls = rawCalls === '' ? undefined : parseCalls(rawCalls);
  if (lightDays.length && tooClose(weekdaysFor(weekday, calls ?? DEFAULT_CALLS).map(d => ({ weekday: d, minute: weekly })), lightDays.map(d => ({ weekday: d, minute: lightMinute })))) throw new PracticeError('calls_too_close');
  const opening = form.get('opening_local') || form.get('opening') ? appointmentInput(form, timezone, now, 'opening') : null;
  return { timezone, weekly, weekday, lightDays, lightMinute: lightDays.length ? lightMinute : null, opening, calls };
}

export class UnblockRepository {
  constructor(readonly sql: Database, readonly programmeId?: string) {}
  async load(hash: string): Promise<{ enrollment: Enrollment; programme: Programme } | undefined> {
    const [enrollment] = await this.sql<Enrollment[]>`select * from unblock_enrollments where phone_hash = ${hash} and (${this.programmeId ?? null}::text is not null and id=${this.programmeId ?? null} or ${this.programmeId ?? null}::text is null and is_current)`;
    return enrollment ? { enrollment, programme: JSON.parse(decrypt(enrollment.programme_enc)) as Programme } : undefined;
  }
  async enroll(hash: string, now = new Date(), contact?: { name: string; email: string }): Promise<string> {
    const programme = emptyProgramme();
    if (contact && (contact.name.trim() || contact.email.trim())) programme.contact = { name: contact.name.trim().slice(0, 80), email: contact.email.trim().slice(0, 254) };
    const id = randomUUID();
    await this.sql`insert into unblock_enrollments (id,checkout_reference,phone_hash,programme_enc,consent_version,consent_at)
      values (${id},${'unblock_' + id},${hash},${encrypt(JSON.stringify(programme))},'unblock-v1',${now}) on conflict do nothing`;
    return id;
  }
  /** Private-account actions (pause/resume) with the page's revision guard; voice uses `confirm` after a signed completion. */
  async command(hash: string, command: Command, eventId: string, expected?: number, now = new Date()): Promise<Programme> {
    return transaction(this.sql, async tx => {
      const row = await this.lock(tx, hash);
      const current = JSON.parse(decrypt(row.programme_enc)) as Programme;
      if (current.events.includes(eventId)) return applyCommand(current, command, eventId, now);
      if (expected !== undefined && expected !== current.revision) throw new PracticeError('page_changed');
      return this.write(tx, row, current, applyCommand(current, command, eventId, now), now);
    });
  }
  /** Commit the verified aggregate atomically. */
  async confirm(hash: string, expected: number, programme: Programme, now = new Date()): Promise<Programme> {
    return transaction(this.sql, async tx => {
      const row = await this.lock(tx, hash);
      const current = JSON.parse(decrypt(row.programme_enc)) as Programme;
      if (current.revision !== expected || programme.revision < expected) throw new PracticeError('page_changed');
      return this.write(tx, row, current, programme, now);
    });
  }
  private async lock(sql: Database, hash: string): Promise<Enrollment> {
    await sql`select phone_hash from callers where phone_hash = ${hash} for update`;
    const [row] = await sql<Enrollment[]>`select * from unblock_enrollments where phone_hash = ${hash} and (${this.programmeId ?? null}::text is not null and id=${this.programmeId ?? null} or ${this.programmeId ?? null}::text is null and is_current) for update`;
    if (!row) throw new PracticeError('enrollment_unknown');
    return row;
  }
  /** One place decides every future-call pointer. */
  private async write(sql: Database, row: Enrollment, current: Programme, next: Programme, now: Date): Promise<Programme> {
    const ended = next.state === 'completed';
    const opened = !current.openingHeld && next.openingHeld;
    const resumed = current.state === 'paused' && next.state === 'active';
    const closeHeld = !chapterComplete(current) && chapterComplete(next);
    const lightChanged = (current.light?.seq ?? 0) !== (next.light?.seq ?? 0);
    const days = lightChanged && next.light ? next.light.days : row.light_weekdays ?? [];
    const minute = lightChanged && next.light ? next.light.minute : row.light_minute;
    const moved: Enrollment = { ...row, light_weekdays: days, light_minute: minute };
    if (lightChanged && days.length) {
      const problem = await this.problem(sql, moved, [callsOf(next), row.pending_calls_per_month ?? callsOf(next)], now);
      if (problem) throw new PracticeError(problem);
    }
    const weekly = ended ? null : opened ? planWeekly(moved, next, new Date(+now + FIRST_WEEK_GAP_DAYS * 86400_000))
      : closeHeld ? planWeekly(moved, next, now)
        : resumed && (!row.next_weekly_at || row.next_weekly_at <= now) ? weeklyPointer(moved, next, now) : row.next_weekly_at;
    const enabled = !ended && lightEnabled(next, { lightWeekdays: days, lightMinute: minute });
    const light = !enabled ? null : opened ? nextLight(new Date(+now + 12 * 3600_000), days, minute!, row.timezone)
      : lightChanged || resumed || !row.next_light_at || row.next_light_at <= now ? nextLight(now, days, minute!, row.timezone) : row.next_light_at;
    const pos = chapterPos(monthOf(next));
    await sql`update unblock_enrollments set programme_enc = ${encrypt(JSON.stringify(next))}, revision = ${next.revision},
      light_weekdays = ${days}::integer[], light_minute = ${minute}, next_weekly_at = ${weekly}, next_light_at = ${light},
      chapter = ${pos.number}, year = ${pos.year}, chapter_started_at = ${next.chapterStartedAt ? new Date(next.chapterStartedAt) : null},
      opening_at = case when ${opened || ended} then null else opening_at end,
      completed_at = case when ${ended} then coalesce(completed_at, ${now}) else completed_at end, updated_at = ${now} where id = ${row.id}`;
    return next;
  }
  /** The scheduling rules for this enrolment's times with the caller's base weekly slot, for the account and for spoken light-call changes. */
  private async problem(sql: Database, e: Enrollment, calls: number[], now: Date): Promise<string | undefined> {
    if (e.weekly_weekday === null || e.weekly_minute === null) return undefined;
    const [caller] = await sql`select slot_weekday, slot_minute, timezone from callers where phone_hash = ${e.phone_hash}`;
    const base = caller && caller['slot_weekday'] !== null && caller['slot_minute'] !== null ? { weekday: Number(caller['slot_weekday']), minute: Number(caller['slot_minute']), timezone: String(caller['timezone']) } : null;
    return scheduleProblem({ timezone: e.timezone, weekday: e.weekly_weekday, weekly: e.weekly_minute, calls, lightDays: e.light_weekdays ?? [], lightMinute: e.light_minute }, base, now);
  }
  /** Usual times. Before the opening call the first call is `opening` (optional date), after it the plan restarts from now. */
  async schedule(hash: string, form: URLSearchParams, now = new Date()): Promise<void> {
    await transaction(this.sql, async tx => {
      await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      const loaded = await new UnblockRepository(tx, this.programmeId).load(hash);
      if (!loaded) throw new PracticeError('enrollment_unknown');
      const { enrollment: e, programme: p } = loaded; if (p.state === 'completed') throw new PracticeError('programme_complete');
      const s = scheduleInput(form, now);
      const choice = this.callsChoice(e, p, s.calls);
      const moved: Enrollment = { ...e, timezone: s.timezone, weekly_weekday: s.weekday, weekly_minute: s.weekly, light_weekdays: s.lightDays, light_minute: s.lightMinute,
        opening_at: p.openingHeld ? null : s.opening, calls_per_month: choice.calls, pending_calls_per_month: choice.pending };
      const problem = await this.problem(tx, moved, [choice.calls, choice.pending ?? choice.calls, callsOf(choice.programme ?? p)], now);
      if (problem) throw new PracticeError(problem);
      // The opening conversation's own date must also be inside coverage and clear of the usual slots.
      if (s.opening && !withinCoverage(s.opening)) throw new PracticeError('outside_coverage');
      const programme = choice.programme ?? p;
      const slot: Schedule = { timezone: s.timezone, weeklyWeekday: s.weekday, weeklyMinute: s.weekly, lightWeekdays: s.lightDays, lightMinute: s.lightMinute };
      const light = lightEnabled(programme, slot) ? nextLight(now, s.lightDays, s.lightMinute!, s.timezone) : null;
      const weekly = callsAllowed(e, now) || e.standing === 'awaiting_payment' ? weeklyPointer(moved, programme, now) : e.next_weekly_at;
      await tx`update unblock_enrollments set timezone = ${s.timezone}, weekly_weekday = ${s.weekday}, weekly_minute = ${s.weekly},
        light_weekdays = ${s.lightDays}::integer[], light_minute = ${s.lightMinute},
        calls_per_month = ${choice.calls}, pending_calls_per_month = ${choice.pending},
        programme_enc = ${encrypt(JSON.stringify(programme))}, revision = ${programme.revision},
        opening_at = ${p.openingHeld ? null : s.opening}, next_weekly_at = ${weekly}, next_light_at = ${light}, updated_at = ${now} where id = ${e.id}`;
    });
  }
  /**
   * Calls per month (1-8). Before the subscription has started a chapter, or before its first call has been held, the choice applies at once;
   * otherwise it takes effect from the next chapter (month), and the current month keeps the number it started with.
   */
  private callsChoice(e: Enrollment, p: Programme, requested: number | undefined): { calls: number; pending: number | null; programme?: Programme } {
    if (requested === undefined) return { calls: e.calls_per_month, pending: e.pending_calls_per_month };
    const untouched = !p.chapterStartedAt || (monthOf(p) === 1 && !p.openingHeld && p.weeksHeld === 0);
    if (untouched) {
      const programme = p.chapterStartedAt && p.chapterCalls !== requested ? { ...structuredClone(p), chapterCalls: requested, revision: p.revision + 1 } : undefined;
      return { calls: requested, pending: null, ...(programme ? { programme } : {}) };
    }
    return { calls: e.calls_per_month, pending: requested === e.calls_per_month ? null : requested };
  }
  async setCalls(hash: string, requested: number, now = new Date()): Promise<{ applied: 'now' | 'next_chapter' }> {
    const calls = parseCalls(requested);
    return transaction(this.sql, async tx => {
      await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      const loaded = await new UnblockRepository(tx, this.programmeId).load(hash);
      if (!loaded) throw new PracticeError('enrollment_unknown');
      const { enrollment: e, programme: p } = loaded; if (p.state === 'completed') throw new PracticeError('programme_complete');
      const choice = this.callsChoice(e, p, calls); const programme = choice.programme ?? p;
      const moved: Enrollment = { ...e, calls_per_month: choice.calls, pending_calls_per_month: choice.pending };
      const problem = await this.problem(tx, moved, [choice.calls, choice.pending ?? choice.calls, callsOf(programme)], now);
      if (problem) throw new PracticeError(problem);
      const weekly = choice.programme && e.weekly_weekday !== null && (callsAllowed(e, now) || e.standing === 'awaiting_payment') ? weeklyPointer(moved, programme, now) : e.next_weekly_at;
      await tx`update unblock_enrollments set calls_per_month = ${choice.calls}, pending_calls_per_month = ${choice.pending}, next_weekly_at = ${weekly},
        programme_enc = ${encrypt(JSON.stringify(programme))}, revision = ${programme.revision}, updated_at = ${now} where id = ${e.id}`;
      return { applied: choice.pending === null ? 'now' as const : 'next_chapter' as const };
    });
  }
  /**
   * The subscription became active (first activation or a return after it ended): start or resume the chapter clock and refresh any
   * stale next-call pointers, so a first-conversation date chosen before payment that has since passed does not ring at once.
   */
  static async activate(sql: Database, row: Enrollment, current: Programme, now: Date): Promise<void> {
    let p = structuredClone(current); const returning = !!row.anchor_at;
    let calls = row.calls_per_month; let pending: number | null = row.pending_calls_per_month;
    if (!returning || !p.chapterStartedAt) p = startChapter(p, calls, now);
    else if (chapterComplete(p)) { calls = pending ?? calls; pending = null; p = rollChapter(p, calls, now); }
    else { p.chapterStartedAt = now.toISOString(); p.revision++; }
    p.state = 'active';
    const moved: Enrollment = { ...row, anchor_at: now, calls_per_month: calls, pending_calls_per_month: pending, opening_at: !p.openingHeld && row.opening_at && row.opening_at > now ? row.opening_at : null };
    const weekly = weeklyPointer(moved, p, now);
    const light = lightEnabled(p, { lightWeekdays: row.light_weekdays ?? [], lightMinute: row.light_minute }) ? nextLight(now, row.light_weekdays, row.light_minute!, row.timezone) : null;
    const pos = chapterPos(monthOf(p));
    await sql`update unblock_enrollments set programme_enc = ${encrypt(JSON.stringify(p))}, revision = ${p.revision}, anchor_at = ${now}, chapter_started_at = ${new Date(p.chapterStartedAt!)},
      chapter = ${pos.number}, year = ${pos.year}, calls_per_month = ${calls}, pending_calls_per_month = ${pending}, opening_at = ${moved.opening_at}, next_weekly_at = ${weekly}, next_light_at = ${light},
      completed_at = null, updated_at = ${now} where id = ${row.id}`;
  }
  /** The subscription ended: no further calls, everything stays in the private account. */
  static async end(sql: Database, row: Enrollment, current: Programme, now: Date): Promise<void> {
    const p = structuredClone(current); if (p.state !== 'completed') { p.state = 'completed'; p.revision++; }
    await sql`update unblock_enrollments set programme_enc = ${encrypt(JSON.stringify(p))}, revision = ${p.revision}, opening_at = null, next_weekly_at = null, next_light_at = null,
      completed_at = coalesce(completed_at, ${now}), updated_at = ${now} where id = ${row.id}`;
  }
  /** Re-plan the next-call pointers after the subscription's end date changed (a cancellation at period end) or a pause was lifted. */
  static async replan(sql: Database, row: Enrollment, p: Programme, now: Date): Promise<void> {
    if (p.state === 'completed') return;
    await sql`update unblock_enrollments set next_weekly_at = ${weeklyPointer(row, p, now)}, updated_at = ${now} where id = ${row.id}`;
  }

  /**
   * Move or skip the one next call without changing the usual times. `kind` is `call` (the opening or weekly conversation) or `light` (skip only).
   * A weekly call can only move later, inside its own week: the claim sets the following call from the clock, so an earlier time would ring again at the usual slot.
   */
  async occurrence(hash: string, form: URLSearchParams, now = new Date()): Promise<void> {
    await transaction(this.sql, async tx => {
      const [caller] = await tx`select held_for_review,all_calls_stopped,sms_opt_out,slot_weekday,slot_minute,timezone from callers where phone_hash=${hash} for update`;
      const loaded = await new UnblockRepository(tx, this.programmeId).load(hash);
      if (!caller || !loaded) throw new PracticeError('enrollment_unknown');
      const { enrollment: e, programme: p } = loaded;
      if (!callsAllowed(e, now) || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || p.state !== 'active') throw new PracticeError('calls_held');
      const kind = form.get('kind'); const skip = form.get('action') === 'skip';
      if (kind !== 'call' && kind !== 'light') throw new PracticeError('schedule_invalid');
      const inflight = await tx`select id from call_attempts where phone_hash=${hash} and status in ('claimed','placed','settling') limit 1`;
      if (inflight.length) throw new PracticeError('call_in_progress');
      const stage = slotKind(p); const slot = scheduleOf(e);
      const regular = (after: Date): Date | null => planWeekly(e, p, after);
      let current: Date | null; let column: 'opening_at' | 'next_weekly_at' | 'next_light_at';
      if (kind === 'light') { column = 'next_light_at'; current = e.next_light_at; if (!skip || !lightEnabled(p, slot)) throw new PracticeError('calls_held'); }
      else {
        if (!stage || stage === 'light') throw new PracticeError('calls_held');
        column = stage === 'opening' && e.opening_at && (!e.next_weekly_at || e.opening_at <= e.next_weekly_at) ? 'opening_at' : 'next_weekly_at';
        current = e[column];
      }
      if (!current || current <= now || current.toISOString() !== form.get('expected_at')) throw new PracticeError('page_changed');
      if (skip) {
        if (column === 'next_light_at') { await tx`update unblock_enrollments set next_light_at=${nextLight(current, slot.lightWeekdays, slot.lightMinute!, e.timezone)},updated_at=${now} where id=${e.id}`; return; }
        if (column === 'opening_at') { await tx`update unblock_enrollments set opening_at=null,next_weekly_at=coalesce(next_weekly_at,${regular(current)}),updated_at=${now} where id=${e.id}`; return; }
        await tx`update unblock_enrollments set next_weekly_at=${regular(current)},updated_at=${now} where id=${e.id}`; return;
      }
      const at = appointmentInput(form, e.timezone, now);
      if (column === 'next_weekly_at' && stage === 'weekly') {
        const following = regular(current);
        if (at <= current) throw new PracticeError('occurrence_too_early');
        if (following && at >= following) throw new PracticeError('occurrence_too_late');
        if (following && +following - +at < 45 * 60_000) throw new PracticeError('calls_too_close');
      }
      if (column === 'opening_at' && e.next_weekly_at && at >= e.next_weekly_at) throw new PracticeError('occurrence_too_late');
      if (!withinCoverage(at)) throw new PracticeError('outside_coverage');
      const nearby: Date[] = []; const before = new Date(+at - 45 * 60_000);
      if (column !== 'next_light_at' && lightEnabled(p, slot)) nearby.push(nextLight(before, slot.lightWeekdays, slot.lightMinute!, e.timezone)!, ...(e.next_light_at ? [e.next_light_at] : []));
      if (column === 'opening_at' && e.next_weekly_at) nearby.push(e.next_weekly_at);
      if (caller['slot_weekday'] !== null && caller['slot_minute'] !== null) nearby.push(nextSlotAfter(before, { weekday: Number(caller['slot_weekday']), minute: Number(caller['slot_minute']), timezone: String(caller['timezone']) }));
      if (nearby.some(other => Math.abs(+at - +other) < 45 * 60_000)) throw new PracticeError('calls_too_close');
      if (column === 'opening_at') await tx`update unblock_enrollments set opening_at=${at},updated_at=${now} where id=${e.id}`;
      else await tx`update unblock_enrollments set next_weekly_at=${at},updated_at=${now} where id=${e.id}`;
    });
  }
}

/** The scheduling guard for what a caller says in a call: the same rules as the account (coverage hours, 45-minute spacing, base weekly call). */
export function lightGuard(e: Enrollment, p: Programme, base: { weekday: number; minute: number; timezone: string } | null, now: Date): (days: readonly number[], minute: number) => string | undefined {
  return (days, minute) => e.weekly_weekday === null || e.weekly_minute === null ? undefined
    : scheduleProblem({ timezone: e.timezone, weekday: e.weekly_weekday, weekly: e.weekly_minute, calls: [callsOf(p), e.pending_calls_per_month ?? callsOf(p)], lightDays: days, lightMinute: minute }, base, now);
}
/** The call the guide may name when it signs off: the pointer, or after a close the first call of the next chapter. */
export function signOffCall(e: Enrollment, p: Programme, kind: 'opening' | 'weekly' | 'light', week: number, now: Date): Date | null {
  return kind === 'weekly' && week >= callsOf(p) ? planWeekly(e, p, now, 0) : e.next_weekly_at;
}
