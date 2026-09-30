import { openStore } from './store/index.ts';
import { PostgresStore } from './store/postgres.ts';
import { feedbackNumbers } from './feedback/feedback.ts';

/**
 * npm run numbers
 *
 * The weekly numbers, in one place: how many people, how their weeks went, and
 * how the one feedback request is doing. Counts only — no names, no numbers,
 * no answers. The answers are read one person at a time, from the export, never
 * tallied.
 *
 * A command rather than a page, by the owner's decision on 2026-09-30: a page
 * would be this product's first admin login, and there is not going to be one.
 */
const store = openStore();
if (!(store instanceof PostgresStore)) {
  console.error('npm run numbers needs DATABASE_URL.');
  process.exit(1);
}
try {
  const sql = store.raw;
  const [people] = await sql<{ callers: number; active: number; calls: number; done: number; partly: number; undone: number }[]>`
    select count(*)::int as callers,
           count(*) filter (where paused = false and slot_weekday is not null)::int as active,
           coalesce(sum(greatest(call_number - 1, 0)), 0)::int as calls,
           coalesce(sum(weeks_done), 0)::int as done,
           coalesce(sum(weeks_partly), 0)::int as partly,
           coalesce(sum(weeks_undone), 0)::int as undone
    from callers
  `;
  const [week] = await sql<{ completed: number; missed: number }[]>`
    select count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status in ('failed', 'silent'))::int as missed
    from call_attempts where claimed_at > now() - interval '7 days'
  `;
  const f = await feedbackNumbers(sql);
  const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : '—');

  const rows: Array<[string, string | number]> = [
    ['callers', people?.callers ?? 0],
    ['  with a weekly call', people?.active ?? 0],
    ['calls, all time', people?.calls ?? 0],
    ['calls this week, completed', week?.completed ?? 0],
    ['calls this week, missed or failed', week?.missed ?? 0],
    ['weeks done / partly / undone', `${people?.done ?? 0} / ${people?.partly ?? 0} / ${people?.undone ?? 0}`],
    ['', ''],
    ['feedback_sms_sent', f.sent],
    ['link_opened', `${f.opened}  (${pct(f.opened, f.sent)})`],
    ['form_submitted', f.submitted],
    ['response rate', f.rate === undefined ? '—' : `${f.rate}%`],
  ];
  for (const [k, v] of rows) console.log(k ? `${k.padEnd(36)}${v}` : '');
} finally {
  await store.close();
}
