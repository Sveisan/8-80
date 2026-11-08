import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { nextSlotAfter, parseLocalTime, parseWeekday } from '../schedule/time.ts';
import { PracticeError } from '../beliefs/model.ts';
import { appointmentInput } from '../beliefs/repository.ts';
import { withinCoverage } from './coverage.ts';
import { applyCommand, DEFAULT_LIGHT_DAYS, DEFAULT_LIGHT_MINUTE, emptyProgramme, firstWeekly, lightEnabled, nextLight, parseDays, slotKind, type Command, type Programme, type Schedule } from './model.ts';

export interface Enrollment {
  id: string; is_current: boolean; checkout_reference: string; phone_hash: string; programme_enc: string; revision: number; timezone: string;
  weekly_weekday: number | null; weekly_minute: number | null; light_weekdays: number[]; light_minute: number | null;
  opening_at: Date | null; next_weekly_at: Date | null; next_light_at: Date | null;
  standing: string; provider: string | null; purchase_id: string | null; payment_id: string | null; product_id: string | null;
  customer_id: string | null; paid_at: Date | null; amount_minor: number | null; currency: string | null; completed_at: Date | null;
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
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  if (lightDays.includes(weekday) && apart(lightMinute, weekly) < 45) throw new PracticeError('calls_too_close');
  const opening = form.get('opening_local') || form.get('opening') ? appointmentInput(form, timezone, now, 'opening') : null;
  return { timezone, weekly, weekday, lightDays, lightMinute: lightDays.length ? lightMinute : null, opening };
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
      values (${id},${'unblock:' + id},${hash},${encrypt(JSON.stringify(programme))},'unblock-v1',${now}) on conflict do nothing`;
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
  /** One place decides every future-call pointer; a completed programme clears all of them. */
  private async write(sql: Database, row: Enrollment, current: Programme, next: Programme, now: Date): Promise<Programme> {
    const completed = next.state === 'completed';
    const opened = !current.openingHeld && next.openingHeld;
    const resumed = current.state === 'paused' && next.state === 'active';
    const lightChanged = (current.light?.seq ?? 0) !== (next.light?.seq ?? 0);
    const days = lightChanged && next.light ? next.light.days : row.light_weekdays ?? [];
    const minute = lightChanged && next.light ? next.light.minute : row.light_minute;
    const slot = scheduleOf(row);
    const regular = row.weekly_weekday !== null && row.weekly_minute !== null ? nextSlotAfter(now, { weekday: row.weekly_weekday, minute: row.weekly_minute, timezone: row.timezone }) : null;
    const weekly = completed ? null : opened ? firstWeekly(now, slot) : resumed && (!row.next_weekly_at || row.next_weekly_at <= now) ? regular : row.next_weekly_at;
    const enabled = !completed && lightEnabled(next, { lightWeekdays: days, lightMinute: minute });
    const light = !enabled ? null : opened ? nextLight(new Date(+now + 12 * 3600_000), days, minute!, row.timezone)
      : lightChanged || resumed || !row.next_light_at || row.next_light_at <= now ? nextLight(now, days, minute!, row.timezone) : row.next_light_at;
    await sql`update unblock_enrollments set programme_enc = ${encrypt(JSON.stringify(next))}, revision = ${next.revision},
      light_weekdays = ${days}::integer[], light_minute = ${minute}, next_weekly_at = ${weekly}, next_light_at = ${light},
      opening_at = case when ${opened || completed} then null else opening_at end,
      completed_at = case when ${completed} then coalesce(completed_at, ${now}) else completed_at end, updated_at = ${now} where id = ${row.id}`;
    return next;
  }
  /** Usual times. Before the opening call the first call is `opening` (optional date), after it the weekly slot restarts from now. */
  async schedule(hash: string, form: URLSearchParams, now = new Date()): Promise<void> {
    await transaction(this.sql, async tx => {
      const [caller] = await tx`select slot_weekday, slot_minute, timezone from callers where phone_hash = ${hash} for update`;
      if (!caller) throw new PracticeError('enrollment_unknown');
      const loaded = await new UnblockRepository(tx, this.programmeId).load(hash);
      if (!loaded) throw new PracticeError('enrollment_unknown');
      const p = loaded.programme; if (p.state === 'completed') throw new PracticeError('programme_complete');
      const s = scheduleInput(form, now);
      const weekly = nextSlotAfter(now, { weekday: s.weekday, minute: s.weekly, timezone: s.timezone });
      const slot: Schedule = { timezone: s.timezone, weeklyWeekday: s.weekday, weeklyMinute: s.weekly, lightWeekdays: s.lightDays, lightMinute: s.lightMinute };
      const nextWeekly = p.openingHeld ? weekly : s.opening ? firstWeekly(s.opening, slot) : weekly;
      const appointments: Date[] = s.opening ? [s.opening] : [];
      let w = now; for (let i = 0; i < 6; i++) { w = nextSlotAfter(w, { weekday: s.weekday, minute: s.weekly, timezone: s.timezone }); appointments.push(w); }
      let l = now; if (s.lightMinute !== null) for (let i = 0; i < 21; i++) { l = nextLight(l, s.lightDays, s.lightMinute, s.timezone)!; appointments.push(l); }
      if (caller['slot_weekday'] !== null && caller['slot_minute'] !== null) {
        const base = { weekday: Number(caller['slot_weekday']), minute: Number(caller['slot_minute']), timezone: String(caller['timezone']) };
        if (appointments.some(at => Math.abs(+at - +nextSlotAfter(new Date(+at - 45 * 60_000), base)) < 45 * 60_000)) throw new PracticeError('base_calls_too_close');
      }
      const light = lightEnabled(p, slot) ? nextLight(now, s.lightDays, s.lightMinute!, s.timezone) : null;
      await tx`update unblock_enrollments set timezone = ${s.timezone}, weekly_weekday = ${s.weekday}, weekly_minute = ${s.weekly},
        light_weekdays = ${s.lightDays}::integer[], light_minute = ${s.lightMinute},
        opening_at = ${p.openingHeld ? null : s.opening}, next_weekly_at = ${nextWeekly}, next_light_at = ${light}, updated_at = ${now} where id = ${loaded.enrollment.id}`;
    });
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
      if (e.standing !== 'active' || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || p.state !== 'active') throw new PracticeError('calls_held');
      const kind = form.get('kind'); const skip = form.get('action') === 'skip';
      if (kind !== 'call' && kind !== 'light') throw new PracticeError('schedule_invalid');
      const inflight = await tx`select id from call_attempts where phone_hash=${hash} and status in ('claimed','placed','settling') limit 1`;
      if (inflight.length) throw new PracticeError('call_in_progress');
      const stage = slotKind(p); const slot = scheduleOf(e);
      const regular = (after: Date): Date | null => e.weekly_weekday !== null && e.weekly_minute !== null ? nextSlotAfter(after, { weekday: e.weekly_weekday, minute: e.weekly_minute, timezone: e.timezone }) : null;
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
