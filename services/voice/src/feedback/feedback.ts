import type postgres from 'postgres';
import { config } from '../config.ts';
import { log } from '../log.ts';
import { Links } from '../link/token.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { OptedOut } from '../sms/types.ts';
import type { LoopDeps } from '../loop/deps.ts';

/** Not on top of the recap, which goes the moment the call settles. */
export const AFTER_CALL_MS = 15 * 60_000;
/** Older than this, the moment has passed; the next call brings it round again. */
const STALE_MS = 6 * 3600_000;
/** A call this short did not get far enough to ask about. */
export const MIN_CALL_MS = 3 * 60_000;
/** Never within half an hour of another text: one text about one event. */
export const TEXT_GAP_MS = 30 * 60_000;
/** Notes `settle` writes on a completed call that did not really happen. */
const ENDED_EARLY = ['moved during the call', 'no commitment was reached'];
/** Each answer. Generous, because somebody dictating runs on. */
export const ANSWER_MAX = 4000;

export interface Answers {
  pickup: string;
  nearly: string;
  else: string;
}

/**
 * The one feedback text, for whoever is due one.
 *
 * Run from the tick rather than scheduled at the end of a call, so the fifteen
 * minutes is a query and not a timer that dies with a process. A caller is due
 * when their latest completed call is at least `FEEDBACK_AFTER_CALL`, ended
 * between fifteen minutes and six hours ago, and they have no row in
 * `feedback`. SCRIPT.md §20 has the rules in words; the short version:
 *
 * - once, ever: the row is written before the text, and the hash is its key
 * - a flagged call skips them for good (DECISIONS.md: never auto-actioned)
 * - a short call, or one that ended early, waits for the next call
 * - not within thirty minutes of any other text to them
 * - not to somebody who has stopped the calls
 */
export async function sendDueFeedback(deps: LoopDeps, now = new Date()): Promise<number> {
  const after = config.feedback.afterCall();
  if (after < 1) return 0;
  const base = config.link.publicUrl().replace(/\/$/, '');
  if (!base) return 0;
  const sql = deps.store.raw;

  const due = await sql<
    { id: string; phone_hash: string; duration_ms: number | null; note: string | null; safety_tier: number | null; n: number }[]
  >`
    with done as (
      select phone_hash, count(*)::int as n
      from call_attempts where status = 'completed' and ended_at is not null
      group by phone_hash
    )
    select a.id, a.phone_hash, a.duration_ms, a.note, a.safety_tier, done.n
    from done
    join callers c on c.phone_hash = done.phone_hash and c.paused = false
    join lateral (
      select id, phone_hash, ended_at, duration_ms, note, safety_tier from call_attempts
      where phone_hash = done.phone_hash and status = 'completed' and ended_at is not null
      order by ended_at desc limit 1
    ) a on true
    where done.n >= ${after}
      and a.ended_at <= ${new Date(now.getTime() - AFTER_CALL_MS).toISOString()}
      and a.ended_at > ${new Date(now.getTime() - STALE_MS).toISOString()}
      and not exists (select 1 from feedback f where f.phone_hash = done.phone_hash)
      and not exists (
        select 1 from call_attempts t
        where t.phone_hash = done.phone_hash and t.sms_sent_at > ${new Date(now.getTime() - TEXT_GAP_MS).toISOString()}
      )
    limit 50
  `;

  let sent = 0;
  for (const row of due) {
    if (row.safety_tier !== null) {
      // Permanently: a flagged call is read by a person, and the product does
      // not follow it up with a survey — not now and not after the next one.
      await sql`insert into feedback (phone_hash, state, attempt_id) values (${row.phone_hash}, 'skipped', ${row.id}) on conflict do nothing`;
      log('feedback.skipped', { why: 'flagged call' });
      continue;
    }
    if ((row.duration_ms ?? 0) < MIN_CALL_MS || (row.note && ENDED_EARLY.includes(row.note))) continue;

    const claimed = await sql<{ phone_hash: string }[]>`
      insert into feedback (phone_hash, state, attempt_id, sent_at) values (${row.phone_hash}, 'sent', ${row.id}, ${now.toISOString()})
      on conflict do nothing returning phone_hash
    `;
    if (!claimed.length) continue;

    const phone = await deps.store.phoneFor(row.phone_hash);
    const template = deps.script.get(`sms.feedback.${row.n}`) ?? deps.script.get('sms.feedback');
    if (!phone || !template) {
      await sql`update feedback set state = 'failed' where phone_hash = ${row.phone_hash}`;
      continue;
    }
    const link = `${base}/f/${await new Links(sql).mint(row.phone_hash, now, 'feedback')}`;
    try {
      await deps.sms.send(phone, template.replace('{{count}}', String(row.n)).replace('{{link}}', link));
      sent++;
      log('feedback.sent', { afterCall: row.n });
    } catch (e) {
      await sql`update feedback set state = 'failed' where phone_hash = ${row.phone_hash}`;
      if (e instanceof OptedOut) {
        // The same rule as every other text: a number that refuses messages
        // has said no, and the calls stop. SCRIPT.md §13.
        await deps.scheduler.setPaused(phone, true);
        log('sms.stopped_by_carrier', { note: 'opted out at the carrier — calls paused' });
      } else {
        log('feedback.not_sent', { reason: (e as Error).message });
      }
    }
  }
  return sent;
}

/**
 * What they said last time, for the form. Also counts the first open, unless
 * the request is a link preview — a messaging app fetching the page to draw a
 * card is not somebody opening it, and would count every text as opened.
 */
export async function openFeedback(sql: postgres.Sql, phoneHash: string, counts: boolean): Promise<Answers | undefined> {
  const rows = counts
    ? await sql<AnswerRow[]>`
        update feedback set opened_at = coalesce(opened_at, now()) where phone_hash = ${phoneHash}
        returning pickup_enc, nearly_enc, else_enc`
    : await sql<AnswerRow[]>`select pickup_enc, nearly_enc, else_enc from feedback where phone_hash = ${phoneHash}`;
  const row = rows[0];
  return row ? read(row) : undefined;
}

/** Save the answers, all three, replacing what was there. Empty is allowed: every question is optional. */
export async function saveFeedback(sql: postgres.Sql, phoneHash: string, answers: Answers): Promise<boolean> {
  const enc = (s: string): string | null => (s ? encrypt(s) : null);
  const rows = await sql<{ phone_hash: string }[]>`
    update feedback set
      pickup_enc = ${enc(answers.pickup)}, nearly_enc = ${enc(answers.nearly)}, else_enc = ${enc(answers.else)},
      opened_at = coalesce(opened_at, now()), submitted_at = coalesce(submitted_at, now()), updated_at = now()
    where phone_hash = ${phoneHash}
    returning phone_hash
  `;
  return rows.length > 0;
}

/** Their answers, for the export. Nothing when they never answered. */
export async function feedbackFor(sql: postgres.Sql, phoneHash: string): Promise<Answers | undefined> {
  const rows = await sql<AnswerRow[]>`
    select pickup_enc, nearly_enc, else_enc from feedback where phone_hash = ${phoneHash} and submitted_at is not null
  `;
  return rows[0] ? read(rows[0]) : undefined;
}

export interface FeedbackNumbers {
  sent: number;
  opened: number;
  submitted: number;
  /** submitted / sent, as a whole percentage; undefined before anything was sent. */
  rate: number | undefined;
}

/** Counts only. The answers are read one person at a time, never tallied here. */
export async function feedbackNumbers(sql: postgres.Sql): Promise<FeedbackNumbers> {
  const rows = await sql<{ sent: number; opened: number; submitted: number }[]>`
    select count(*) filter (where state = 'sent')::int as sent,
           count(*) filter (where state = 'sent' and opened_at is not null)::int as opened,
           count(*) filter (where state = 'sent' and submitted_at is not null)::int as submitted
    from feedback
  `;
  const r = rows[0] ?? { sent: 0, opened: 0, submitted: 0 };
  return { ...r, rate: r.sent ? Math.round((100 * r.submitted) / r.sent) : undefined };
}

/** Link previews, by the agents that fetch them. Not people. */
export const isPreview = (userAgent: string | undefined): boolean =>
  /bot|facebookexternalhit|preview|slurp|crawler|spider|whatsapp|telegram/i.test(userAgent ?? '');

type AnswerRow = { pickup_enc: string | null; nearly_enc: string | null; else_enc: string | null };

const read = (row: AnswerRow): Answers => ({
  pickup: row.pickup_enc ? decrypt(row.pickup_enc) : '',
  nearly: row.nearly_enc ? decrypt(row.nearly_enc) : '',
  else: row.else_enc ? decrypt(row.else_enc) : '',
});
