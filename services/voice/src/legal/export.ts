import type { Recap, RecapPart } from '../recap/compose.ts';
import type { ScriptLines } from '../script.ts';
import { phoneKey, type PostgresStore } from '../store/postgres.ts';
import { feedbackFor } from '../feedback/feedback.ts';

/**
 * Everything we hold about one person, as a letter they can read.
 *
 * privacy.md promises that the fastest way to get a copy is the link in every
 * text. A privacy policy that promises this and resolves to "email us and
 * we'll get to it" is the thing every other company does, and the sentence was
 * false in ours until this existed.
 *
 * It is deliberately a short list. The whole argument of that document is that
 * the record is small; a person should be able to see that in one screen
 * rather than take our word for it.
 */
export async function composeExport(
  store: PostgresStore,
  phone: string,
  script: ScriptLines,
): Promise<Recap | undefined> {
  const line = (key: string): string => script.get(key) ?? '';
  const subject = line('email.export.subject');
  const lead = line('email.export.lead');
  if (!subject || !lead) return undefined;

  const caller = await store.load(phone);
  const rows = await store.raw<{ scheduled_for: Date; status: string; duration_ms: number | null }[]>`
    select scheduled_for, status, duration_ms
    from call_attempts where phone_hash = ${phoneKey(phone)}
    order by scheduled_for desc limit 100
  `;
  const meta = await store.raw<
    { created_at: Date; billing_status: string; trial_ends_at: Date | null; timezone: string | null; slot_weekday: number | null; slot_minute: number | null }[]
  >`
    select created_at, billing_status, trial_ends_at, timezone, slot_weekday, slot_minute
    from callers where phone_hash = ${phoneKey(phone)}
  `;
  const row = meta[0];

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const slot =
    row?.slot_weekday !== null && row?.slot_weekday !== undefined && row.slot_minute !== null
      ? `${days[row.slot_weekday]} ${clock(row.slot_minute)} ${row.timezone ?? ''}`.trim()
      : '';

  const field = (key: string, value: string | undefined): string | undefined =>
    value ? `${line(key)}: ${value}` : undefined;

  const facts = [
    field('export.name', caller.name),
    field('export.phone', phone),
    field('export.email', caller.email),
    field('export.slot', slot),
    field('export.calls', String(Math.max(0, caller.callNumber - 1))),
    field('export.commitment', caller.lastCommitment ? `${caller.lastCommitment}${caller.lastCommitmentDay ? `, ${caller.lastCommitmentDay}` : ''}` : undefined),
    field('export.since', row?.created_at.toISOString().slice(0, 10)),
    field('export.billing', row ? billing(row.billing_status, row.trial_ends_at) : undefined),
  ].filter((f): f is string => Boolean(f));

  const history = rows.length
    ? `${line('export.history')}:\n` +
      rows
        .map(
          (r) =>
            `  ${r.scheduled_for.toISOString().slice(0, 16).replace('T', ' ')}  ${r.status}` +
            `${r.duration_ms ? `, ${Math.round(r.duration_ms / 60_000)} min` : ''}`,
        )
        .join('\n')
    : '';

  // What they told us about the calls, in their words, under the questions
  // they were asked. SCRIPT.md §20: held like a transcript, handed back like one.
  const said = await feedbackFor(store.raw, phoneKey(phone));
  const answered = said
    ? (
        [
          ['feedback.pickup', said.pickup],
          ['feedback.nearly', said.nearly],
          ['feedback.else', said.else],
        ] as const
      ).filter(([, a]) => a)
    : [];
  const feedback = answered.length
    ? `${line('export.feedback')}:\n` + answered.map(([q, a]) => `  ${line(q)}\n  ${a}`).join('\n\n')
    : '';

  const parts: RecapPart[] = [{ role: 'lead', text: lead }, { role: 'body', text: facts.join('\n') }];
  if (feedback) parts.push({ role: 'body', text: feedback });
  if (history) parts.push({ role: 'quiet', text: history });
  const quiet = line('email.export.quiet');
  if (quiet) parts.push({ role: 'quiet', text: quiet });
  const signoff = script.get('email.signoff');
  if (signoff) parts.push({ role: 'signoff', text: signoff });

  return { subject, body: parts.map((p) => p.text).join('\n\n'), parts };
}

/** Their billing state in a sentence rather than a column value. */
function billing(status: string, trialEndsAt: Date | null): string {
  if (status === 'trialing' && trialEndsAt) return `free month, until ${trialEndsAt.toISOString().slice(0, 10)}`;
  if (status === 'comped') return 'no charge';
  if (status === 'active') return 'subscribed';
  if (status === 'past_due') return 'subscribed, last payment did not clear';
  if (status === 'ended') return 'not subscribed';
  return status;
}
