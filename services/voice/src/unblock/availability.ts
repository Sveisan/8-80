import type postgres from 'postgres';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { localDate, zonedTimeToUtc } from '../schedule/time.ts';

const zone = 'Europe/Oslo';
interface Row { checked_in_at: Date | null; expires_at: Date | null; }
export interface Availability { available: boolean; checkedInAt: Date | null; expiresAt: Date | null; }
/** An explicit check-in for this Oslo working day; expiry cannot be carried into tomorrow. */
function status(row: Row | undefined, now: Date): Availability {
  const day = localDate(now, zone);
  const end = zonedTimeToUtc(day.year, day.month, day.day, 17 * 60, zone);
  const available = !!row?.checked_in_at && !!row.expires_at && day.weekday >= 1 && day.weekday <= 5
    && row.checked_in_at <= now && row.expires_at > now && +row.expires_at === +end;
  return { available, checkedInAt: available ? row!.checked_in_at : null, expiresAt: available ? row!.expires_at : null };
}
export async function unblockAvailability(sql: Database, now = new Date()): Promise<Availability> {
  const [row] = await sql<Row[]>`select checked_in_at,expires_at from unblock_availability where id='sole-operator'`;
  return status(row, now);
}
/** Held through placement. Away waits for a placement already in progress, then blocks every new start. */
export async function lockUnblockAvailability(sql: postgres.TransactionSql, now: Date): Promise<Availability> {
  const [row] = await sql<Row[]>`select checked_in_at,expires_at from unblock_availability where id='sole-operator' for share`;
  return status(row, now);
}
/** Private server CLI only. No public route, scheduler refresh or automatic daily check-in. */
export async function setUnblockAvailability(sql: Database, available: boolean, now = new Date()): Promise<Availability> {
  return transaction(sql, async tx => {
    const [row] = await tx<Row[]>`select checked_in_at,expires_at from unblock_availability where id='sole-operator' for update`;
    if (!row) throw Error('Availability migration is required.');
    const day = localDate(now, zone);
    const end = zonedTimeToUtc(day.year, day.month, day.day, 17 * 60, zone);
    if (available && (day.weekday === 0 || day.weekday === 6 || now >= end)) throw Error('Check in on an Oslo working day before 17:00.');
    // Repeated Available is idempotent: it must not invalidate a call due since the first check-in.
    const since = available ? (status(row, now).checkedInAt ?? now) : null;
    await tx`update unblock_availability set checked_in_at=${since},expires_at=${available ? end : null},updated_at=${now} where id='sole-operator'`;
    return status({ checked_in_at: since, expires_at: available ? end : null }, now);
  });
}
