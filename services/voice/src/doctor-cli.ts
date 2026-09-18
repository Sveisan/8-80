import { config } from './config.ts';
import { PostgresStore } from './store/postgres.ts';
import { Deliveries } from './webhook/deliveries.ts';
import { hasKey } from './store/crypto.ts';

/**
 * npm run doctor — what the system knows about itself, on one screen.
 *
 * Written after a day spent grepping an empty journal and concluding nothing
 * had happened, when in fact three webhooks had arrived and been discarded. The
 * question "is it working" was answerable the whole time; it just took four
 * commands, two passwords and knowing which of two systemd units to ask.
 *
 * Read-only. Nothing here dials, writes or sends. Safe to run while worried.
 */
const check = (ok: boolean, label: string, detail?: string): void => {
  console.log(`  ${ok ? '·' : '✕'} ${label}${detail ? `\n      ${detail}` : ''}`);
};

/** What each missing variable actually switches off, rather than its name. */
const NEEDED: [string, string][] = [
  ['DATABASE_URL', 'Nothing runs. The scheduler, the calls, all of it.'],
  ['DATA_ENCRYPTION_KEY', 'No commitment is stored and no delivery is kept.'],
  ['SPEECHIFY_API_KEY', 'No call can be placed.'],
  ['SPEECHIFY_AGENT_ID', 'No call can be placed.'],
  ['SPEECHIFY_WEBHOOK_SECRET', 'Every delivery is rejected with a 401, silently.'],
  ['PUBLIC_URL', 'The missed-call text has no link, so no text is sent at all.'],
  ['RESEND_API_KEY', 'Recaps are written to disk instead of sent.'],
  ['SMS_FROM_NUMBER', 'Missed-call texts are written to disk instead of sent.'],
  ['SPEECHIFY_CALLER_ID_NUMBER', 'Calls arrive from whatever number the platform picks.'],
];

console.log('\n8&80 — what is actually true right now\n');
console.log('CONFIGURATION');
for (const [key, why] of NEEDED) {
  const set = Boolean(process.env[key]);
  check(set, key, set ? undefined : why);
}

const voiceFrom = process.env['SPEECHIFY_CALLER_ID_NUMBER'];
const smsFrom = process.env['SMS_FROM_NUMBER'];
if (voiceFrom && smsFrom && voiceFrom !== smsFrom) {
  check(false, 'the call and the text come from different numbers', 'See preflight — the text says "Rang just now".');
}

if (!config.database.url) {
  console.log('\n  Without DATABASE_URL there is nothing else to look at.\n');
  process.exit(1);
}

const store = new PostgresStore(config.database.url);
try {
  console.log('\nCALLERS');
  const callers = await store.raw<
    { call_number: number; paused: boolean; next_call_at: Date | null; slot_weekday: number | null; slot_minute: number | null; timezone: string | null }[]
  >`select call_number, paused, next_call_at, slot_weekday, slot_minute, timezone from callers order by next_call_at`;
  if (!callers.length) console.log('  Nobody is enrolled. `npm run enrol -- --help`');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const c of callers) {
    // No numbers and no names: a terminal is a screen somebody else can see.
    const slot =
      c.slot_weekday === null || c.slot_minute === null
        ? 'no slot — never due'
        : `${days[c.slot_weekday]} ${String(Math.floor(c.slot_minute / 60)).padStart(2, '0')}:${String(c.slot_minute % 60).padStart(2, '0')} ${c.timezone}`;
    console.log(`  call #${c.call_number}  ${slot}${c.paused ? '  (paused)' : ''}`);
    console.log(`      next: ${c.next_call_at?.toISOString() ?? 'never'}`);
  }

  console.log('\nLAST FIVE ATTEMPTS');
  const attempts = await store.raw<
    { scheduled_for: Date; status: string; duration_ms: number | null; note: string | null; sms_sent_at: Date | null }[]
  >`select scheduled_for, status, duration_ms, note, sms_sent_at from call_attempts order by scheduled_for desc limit 5`;
  if (!attempts.length) console.log('  No call has ever been attempted.');
  for (const a of attempts) {
    console.log(
      `  ${a.scheduled_for.toISOString().slice(0, 16).replace('T', ' ')}  ${a.status.padEnd(10)}` +
        `${a.duration_ms ? `${Math.round(a.duration_ms / 1000)}s` : '—'}${a.sms_sent_at ? '  texted' : ''}`,
    );
    if (a.note) console.log(`      ${a.note}`);
  }

  console.log('\nLAST FIVE DELIVERIES');
  if (!hasKey()) {
    console.log('  Not kept — DATA_ENCRYPTION_KEY is unset.');
  } else {
    const rows = await new Deliveries(store.raw).list(5);
    if (!rows.length) console.log('  None. A call that ended should produce one within a minute.');
    for (const r of rows) {
      console.log(
        `  ${r.receivedAt.toISOString().slice(0, 16).replace('T', ' ')}  ${(r.event ?? '—').padEnd(24)}${r.verdict ?? '(no verdict)'}`,
      );
    }
  }

  // The one sentence worth reading if you read nothing else.
  const stuck = attempts.filter((a) => a.status === 'placed' || a.status === 'claimed').length;
  const lastGood = attempts.find((a) => a.status === 'completed');
  console.log('\nIN SHORT');
  if (!attempts.length) console.log('  Nothing has been attempted yet.');
  else if (stuck) console.log(`  ${stuck} attempt(s) placed and never settled — the webhook is not coming back.`);
  else if (lastGood) console.log(`  Last completed call: ${lastGood.scheduled_for.toISOString().slice(0, 16).replace('T', ' ')}. The loop is closing.`);
  else console.log('  Every recent attempt failed. Read the notes above, then the tick journal.');
  console.log('');
} finally {
  await store.close();
}
