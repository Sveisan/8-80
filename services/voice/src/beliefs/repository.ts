import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { nextSlotAfter, parseLocalTime, parseWeekday, zonedTimeToUtc } from '../schedule/time.ts';
import { applyCommand, emptyPractice, PracticeError, type Command, type Practice } from './model.ts';

export interface Enrollment {
  phone_hash: string; practice_enc: string; revision: number; timezone: string;
  daily_minute: number | null; weekly_weekday: number | null; weekly_minute: number | null;
  onboarding_at: Date | null; next_daily_at: Date | null; next_weekly_at: Date | null; review_origin: Date | null;
  standing: string; provider: 'stripe' | 'lemonsqueezy' | null; purchase_id: string | null; payment_id: string | null;
  customer_id: string | null; paid_at: Date | null; amount_minor: number | null; currency: string | null;
}
export function nextDaily(after: Date, minute: number, timezone: string): Date {
  return new Date(Math.min(...Array.from({ length: 7 }, (_, weekday) =>
    +nextSlotAfter(after, { weekday, minute, timezone }))));
}
export function scheduleInput(form: URLSearchParams, now = new Date()) {
  const timezone = (form.get('timezone') ?? '').trim() || 'Europe/Oslo';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now); }
  catch { throw new PracticeError('timezone_invalid'); }
  const daily = parseLocalTime(form.get('daily') ?? '');
  const weekly = parseLocalTime(form.get('weekly') ?? '');
  const weekday = parseWeekday(form.get('weekday') ?? '');
  if (daily === undefined || weekly === undefined || weekday === undefined) throw new PracticeError('schedule_invalid');
  if (Math.min(Math.abs(daily - weekly), 1440 - Math.abs(daily - weekly)) < 45) throw new PracticeError('calls_too_close');
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(form.get('onboarding_local') ?? '');
  if (local) {
    const [year, month, day, hour, minute] = local.slice(1).map(Number);
    const calendar = new Date(Date.UTC(year!, month! - 1, day!));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month! - 1 || calendar.getUTCDate() !== day || hour! > 23 || minute! > 59) throw new PracticeError('onboarding_time_invalid');
  }
  const at = local ? zonedTimeToUtc(Number(local[1]),Number(local[2]),Number(local[3]),Number(local[4])*60+Number(local[5]),timezone) : new Date(form.get('onboarding') ?? '');
  if (!Number.isFinite(+at) || at <= now || +at > +now + 30 * 86400_000) throw new PracticeError('onboarding_time_invalid');
  return { timezone, daily, weekly, weekday, at };
}

export class BeliefRepository {
  constructor(readonly sql: Database) {}
  async load(hash: string): Promise<{ enrollment: Enrollment; practice: Practice } | undefined> {
    const [enrollment] = await this.sql<Enrollment[]>`select * from belief_enrollments where phone_hash = ${hash}`;
    return enrollment ? { enrollment, practice: JSON.parse(decrypt(enrollment.practice_enc)) as Practice } : undefined;
  }
  async enroll(hash: string, now = new Date()): Promise<void> {
    await this.sql`insert into belief_enrollments (phone_hash, practice_enc, consent_version, consent_at)
      values (${hash}, ${encrypt(JSON.stringify(emptyPractice()))}, 'beliefs-v1', ${now}) on conflict do nothing`;
  }
  async command(hash: string, command: Command, eventId: string, expected?: number, now = new Date()): Promise<Practice> {
    return transaction(this.sql, async tx => {
      await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      const [row] = await tx<Enrollment[]>`select * from belief_enrollments where phone_hash = ${hash} for update`;
      if (!row) throw new PracticeError('enrollment_unknown');
      const current = JSON.parse(decrypt(row.practice_enc)) as Practice;
      if (current.events.includes(eventId)) return current;
      if (expected !== undefined && expected !== current.revision) throw new PracticeError('page_changed');
      const practice = applyCommand(current, command, eventId, now);
      return this.write(tx,row,current,practice,now);
    });
  }
  /** Preserve IDs generated during discovery; commit the verified aggregate atomically. */
  async confirm(hash: string, expected: number, practice: Practice, now = new Date()): Promise<Practice> {
    return transaction(this.sql,async tx=>{
      await tx`select phone_hash from callers where phone_hash=${hash} for update`;
      const [row]=await tx<Enrollment[]>`select * from belief_enrollments where phone_hash=${hash} for update`;
      if(!row)throw new PracticeError('enrollment_unknown');
      const current=JSON.parse(decrypt(row.practice_enc)) as Practice;
      if(current.revision!==expected || practice.revision<expected)throw new PracticeError('page_changed');
      return this.write(tx,row,current,practice,now);
    });
  }
  private async write(sql: Database,row: Enrollment,current: Practice,practice: Practice,now: Date): Promise<Practice> {
    const started = !current.understood && practice.understood && row.daily_minute !== null && row.weekly_minute !== null && row.weekly_weekday !== null;
    const nextWeekly = started ? nextSlotAfter(now, { minute: row.weekly_minute!, weekday: row.weekly_weekday!, timezone: row.timezone }) : row.next_weekly_at;
    await sql`update belief_enrollments set practice_enc = ${encrypt(JSON.stringify(practice))}, revision = ${practice.revision},
      next_daily_at = ${started ? nextDaily(now, row.daily_minute!, row.timezone) : row.next_daily_at},
      next_weekly_at = ${nextWeekly}, review_origin = ${started ? nextWeekly : row.review_origin},
      onboarding_at = case when ${started} then null else onboarding_at end, updated_at = ${now} where phone_hash = ${row.phone_hash}`;
    return practice;
  }
  async schedule(hash: string, form: URLSearchParams, now = new Date()): Promise<void> {
    const s = scheduleInput(form, now);
    await transaction(this.sql, async tx => {
      const [caller] = await tx`select slot_weekday, slot_minute, timezone from callers where phone_hash = ${hash} for update`;
      if (!caller) throw new PracticeError('enrollment_unknown');
      if (caller['slot_weekday'] !== null && caller['slot_minute'] !== null && caller['timezone'] === s.timezone) {
        const baseMinute = Number(caller['slot_minute']);
        const apart = (minute: number) => Math.min(Math.abs(baseMinute - minute), 1440 - Math.abs(baseMinute - minute));
        if (apart(s.daily) < 45 || (caller['slot_weekday'] === s.weekday && apart(s.weekly) < 45)) throw new PracticeError('base_calls_too_close');
      }
      const loaded = await new BeliefRepository(tx).load(hash);
      if (!loaded) throw new PracticeError('enrollment_unknown');
      const weekly = nextSlotAfter(now, { minute: s.weekly, weekday: s.weekday, timezone: s.timezone });
      await tx`update belief_enrollments set timezone = ${s.timezone}, daily_minute = ${s.daily}, weekly_weekday = ${s.weekday}, weekly_minute = ${s.weekly},
        onboarding_at = ${loaded.practice.understood ? null : s.at},
        next_daily_at = ${loaded.practice.understood ? nextDaily(now, s.daily, s.timezone) : null},
        next_weekly_at = ${loaded.practice.understood ? weekly : null},
        review_origin = coalesce(review_origin, ${loaded.practice.understood ? weekly : null}), updated_at = ${now} where phone_hash = ${hash}`;
    });
  }
}
