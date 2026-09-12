import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { log } from '../log.ts';
import { phoneKey } from '../store/postgres.ts';
import { nextSlotAfter, type Slot } from './time.ts';

/** A call the scheduler has taken responsibility for placing. */
export interface Claim {
  attemptId: string;
  phoneHash: string;
  /** The slot instant this is for, not the moment it was claimed. */
  scheduledFor: Date;
}

export type AttemptStatus = 'claimed' | 'placed' | 'completed' | 'silent' | 'failed' | 'missed';

/**
 * How late a call may be and still be the call. Past this it is recorded as
 * missed rather than placed: someone who agreed to Tuesday at eight has not
 * agreed to Thursday at four, and an outage should cost them one week rather
 * than produce a burst of calls when the box comes back.
 */
const GRACE_MS = 2 * 60 * 60_000;

/** A cap so that months of downtime do not write an unbounded backlog. */
const MAX_MISSED = 12;

/**
 * Decides who is due and makes sure each of them is called once.
 *
 * The hard requirement is that a restart, a redeploy, or two schedulers running
 * at once cannot ring someone twice for the same Tuesday. That is why claiming
 * a call is an insert against a unique key rather than a flag on the caller:
 * the second attempt conflicts and does nothing, with no coordination between
 * the processes and no lock held across a phone call.
 *
 * Claiming and advancing the slot happen in one transaction. Split them and a
 * crash in between leaves a caller whose slot is permanently in the past and
 * permanently claimed — never called again, with nothing in the logs saying so.
 * Together, the worst case is a claimed attempt that was never placed, which is
 * a visible row and what `stale` exists to find.
 */
export class Scheduler {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Take responsibility for every caller whose slot has come round, and move
   * each of their slots to next week in the same breath.
   */
  async claimDue(now = new Date(), limit = 50, graceMs = GRACE_MS): Promise<Claim[]> {
    return await this.sql.begin(async (tx) => {
      const due = await tx<
        { phone_hash: string; next_call_at: Date; slot_weekday: number; slot_minute: number; timezone: string }[]
      >`
        select phone_hash, next_call_at, slot_weekday, slot_minute, timezone
        from callers
        where paused = false
          and next_call_at is not null
          and next_call_at <= ${now}
          and slot_weekday is not null
          and slot_minute is not null
          and timezone is not null
        order by next_call_at
        limit ${limit}
        for update skip locked
      `;

      const claims: Claim[] = [];
      for (const row of due) {
        const slot: Slot = { weekday: row.slot_weekday, minute: row.slot_minute, timezone: row.timezone };
        let due_ = row.next_call_at;
        let missed = 0;

        // Slots that went by while nobody was listening are recorded and not
        // called. A fortnight of downtime must not become a fortnight of calls
        // arriving at once, and a call six days late is not the weekly call —
        // it is a stranger ringing on a Monday afternoon.
        while (now.getTime() - due_.getTime() > graceMs) {
          await tx`
            insert into call_attempts (id, phone_hash, scheduled_for, status, note)
            values (${randomUUID()}, ${row.phone_hash}, ${due_}, 'missed', 'slot passed unclaimed')
            on conflict (phone_hash, scheduled_for) do nothing
          `;
          missed++;
          if (missed >= MAX_MISSED) {
            // Past the cap we stop counting weeks and rejoin the present. The
            // cap must move the slot as well as stop the writing: leaving it in
            // the past here is how a nine-month outage ends in a phone call.
            due_ = nextSlotAfter(now, slot);
            break;
          }
          due_ = nextSlotAfter(due_, slot);
        }

        // Whether or not this one is still callable, the slot moves on — a
        // next_call_at left in the past brings us back here every tick.
        const stillDue = due_.getTime() <= now.getTime();
        const next = stillDue ? nextSlotAfter(due_, slot) : due_;
        await tx`update callers set next_call_at = ${next}, updated_at = now() where phone_hash = ${row.phone_hash}`;

        if (missed) log('schedule.missed', { slots: missed, upTo: due_.toISOString() });
        if (!stillDue) continue;

        const attemptId = randomUUID();
        const inserted = await tx<{ id: string }[]>`
          insert into call_attempts (id, phone_hash, scheduled_for)
          values (${attemptId}, ${row.phone_hash}, ${due_})
          on conflict (phone_hash, scheduled_for) do nothing
          returning id
        `;
        if (inserted[0]) claims.push({ attemptId, phoneHash: row.phone_hash, scheduledFor: due_ });
      }

      if (due.length) log('schedule.claimed', { due: due.length, claimed: claims.length });
      return claims;
    });
  }

  /** Set or change someone's weekly slot, and work out when it next comes round. */
  async setSlot(phone: string, slot: Slot, now = new Date()): Promise<Date> {
    const next = nextSlotAfter(now, slot);
    await this.sql`
      update callers
      set timezone = ${slot.timezone},
          slot_weekday = ${slot.weekday},
          slot_minute = ${slot.minute},
          next_call_at = ${next},
          paused = false,
          updated_at = now()
      where phone_hash = ${phoneKey(phone)}
    `;
    return next;
  }

  /** Their choice to stop. The slot stays, so resuming is not re-entering it. */
  async setPaused(phone: string, paused: boolean): Promise<void> {
    await this.sql`update callers set paused = ${paused}, updated_at = now() where phone_hash = ${phoneKey(phone)}`;
  }

  async markPlaced(attemptId: string, providerCallId: string): Promise<void> {
    await this.sql`
      update call_attempts
      set status = 'placed', provider_call_id = ${providerCallId}, started_at = now()
      where id = ${attemptId}
    `;
  }

  async finish(
    attemptId: string,
    status: Exclude<AttemptStatus, 'claimed' | 'placed'>,
    detail: { durationMs?: number; note?: string } = {},
  ): Promise<void> {
    await this.sql`
      update call_attempts
      set status = ${status},
          ended_at = now(),
          duration_ms = ${detail.durationMs ?? null},
          note = ${detail.note ?? null}
      where id = ${attemptId}
    `;
    log('schedule.finished', { status, note: detail.note });
  }

  /**
   * Attempts that were claimed or placed and then went quiet.
   *
   * A claim that never became a call is a week someone silently did not get.
   * Nothing here retries on its own — that is a decision about whether ringing
   * someone two hours late is better than not ringing them, and it belongs to
   * whoever runs this, not to a sweep that does it by default.
   */
  async stale(olderThanMs = 15 * 60_000, now = new Date()): Promise<{ id: string; phoneHash: string; status: string }[]> {
    const cutoff = new Date(now.getTime() - olderThanMs);
    const rows = await this.sql<{ id: string; phone_hash: string; status: string }[]>`
      select id, phone_hash, status from call_attempts
      where status in ('claimed', 'placed') and claimed_at < ${cutoff}
      order by claimed_at
    `;
    return rows.map((r) => ({ id: r.id, phoneHash: r.phone_hash, status: r.status }));
  }
}
