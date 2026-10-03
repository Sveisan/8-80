import type { Recap, RecapPart } from '../recap/compose.ts';
import type { ScriptLines } from '../script.ts';
import { phoneKey, type PostgresStore } from '../store/postgres.ts';
import { decrypt } from '../store/crypto.ts';
import { feedbackFor } from '../feedback/feedback.ts';

/**
 * Everything we hold about one person, as a letter they can read.
 *
 * privacy.md promises that the fastest way to get a copy is the link in every
 * text. A privacy policy that promises this and resolves to "email us and
 * we'll get to it" is the thing every other company does, and the sentence was
 * false in ours until this existed.
 *
 * A readable summary precedes the retained records. Credentials are excluded.
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
    order by scheduled_for desc
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
  // The readable summary is followed by all retained application data, including
  // the personal context and short-lived transcript buffer omitted by the old export.
  // Authentication secrets are never copied into an email.
  const hash = phoneKey(phone);
  const [profile] = await store.raw`select * from callers where phone_hash = ${hash}`;
  if (!profile) return undefined;
  const attempts = await store.raw`select * from call_attempts where phone_hash = ${hash} order by scheduled_for`;
  const feedbackRows = await store.raw`select * from feedback where phone_hash = ${hash}`;
  const deliveries = await store.raw`select event, received_at, verdict, body_enc from webhook_deliveries where conversation_id in (
    select provider_call_id from call_attempts where phone_hash = ${hash} and provider_call_id is not null) order by received_at`;
  const credentials = await store.raw`select purpose, created_at, expires_at from links where phone_hash = ${hash}`;
  const pendingSignup = await store.raw`select phone_enc, email_enc, name, timezone, slot_weekday, slot_minute, attempts, expires_at, created_at from signups where phone_hash = ${hash}`;
  const recovery = await store.raw`select attempts, consumed, expires_at, window_at, sent_at, sends from access_codes where phone_hash = ${hash}`;
  const journey = await store.raw`select event, at from journey_events where phone_hash = ${hash} order by at`;
  const messageRows = await store.raw`select * from message_outbox where phone_hash = ${hash} order by created_at`;
  const messageAttempts = await store.raw`select a.* from message_attempts a join message_outbox m on m.id = a.message_id where m.phone_hash = ${hash} order by a.started_at`;
  const messages = messageRows.map(({ payload_enc, recipient_enc, ...meta }) => ({ ...meta,
    recipient: recipient_enc ? decrypt(recipient_enc) : null,
    // Codes and bearer links are credentials; copies of previous exports would
    // recursively duplicate these records rather than add a new data category.
    payload: ['access', 'signup', 'export'].includes(meta['kind']) ? '[credential or duplicate export payload omitted]'
      : payload_enc ? JSON.parse(decrypt(payload_enc).replace(/(https?:\/\/[^\s"<>]+\/(?:r|f)\/)[a-z0-9-]+/gi, '$1[credential omitted]')) : null,
  }));
  const unseal = (row: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.endsWith('_enc') ? key.slice(0, -4) : key, key.endsWith('_enc') && typeof value === 'string' ? decrypt(value) : value]));
  parts.push({ role: 'body', text: JSON.stringify({ profile: unseal(profile), callAttempts: attempts, feedback: feedbackRows.map(unseal), retainedCallDeliveries: deliveries.map(unseal), accessExpiry: credentials, pendingSignup: pendingSignup.map(unseal), recovery, journey, messages, messageAttempts }, null, 2) });
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
