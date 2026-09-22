import { config } from './config.ts';
import { PostgresStore } from './store/postgres.ts';
import { Deliveries } from './webhook/deliveries.ts';
import { hasKey } from './store/crypto.ts';
import { FEATURE_GROUPS } from './preflight.ts';
import { heartbeats } from './schedule/scheduler.ts';

/**
 * npm run doctor — what the system knows about itself, on one screen.
 *
 * Written after a day spent grepping an empty journal and concluding nothing
 * had happened, when in fact three webhooks had arrived and been discarded. The
 * question "is it working" was answerable the whole time; it just took four
 * commands, two passwords and knowing which of two systemd units to ask.
 *
 * Read-only. Nothing here dials, writes or sends. Safe to run while worried.
 *
 * Every section is wrapped, and that is not defensiveness for its own sake: the
 * first time this ran on the server it died on a table a pending migration had
 * not yet created, and took the four sections after it down with it. A
 * diagnostic that stops at the first broken thing is no better than the four
 * commands it replaced — the broken thing is usually what you came to see.
 */
async function section(title: string, body: () => Promise<void>): Promise<void> {
  console.log(`\n${title}`);
  try {
    await body();
  } catch (e) {
    const message = (e as Error).message;
    console.log(`  ✕ ${message}`);
    if (/relation .* does not exist/.test(message)) {
      console.log('      A migration has not been applied here. Run: npm run db:migrate');
    }
  }
}
const check = (ok: boolean, label: string, detail?: string): void => {
  console.log(`  ${ok ? '·' : '✕'} ${label}${detail ? `\n      ${detail}` : ''}`);
};

/** What each missing variable actually switches off, rather than its name. */
const NEEDED: [string, string][] = [
  ['DATABASE_URL', 'Nothing runs. The scheduler, the calls, all of it.'],
  ['DATA_ENCRYPTION_KEY', 'No commitment is stored and no delivery is kept.'],
  ['SPEECHIFY_API_KEY', 'No call can be placed.'],
  ['SPEECHIFY_AGENT_ID', 'No call can be placed.'],
  ['SPEECHIFY_WEBHOOK_SECRET', 'Every delivery is rejected with a 401, silently. One per agent, comma-separated.'],
  ['SPEECHIFY_FIRST_CALL_AGENT_ID', 'First calls are served the returning-call prompt.'],
  ['PUBLIC_URL', 'The missed-call text has no link, so no text is sent at all — and the recap loses its letterhead image.'],
  ['RESEND_API_KEY', 'Recaps are written to disk instead of sent.'],
  ['RECAP_FROM_ADDRESS', 'Goes with RESEND_API_KEY. One without the other sends nothing.'],
  ['SIGNUP_OPEN', 'The public sign-up page is closed. Nobody can join without the CLI. Needs the Twilio block too.'],
  ['LEMONSQUEEZY_CHECKOUT_URL', 'The trial-ended email has nowhere to point.'],
  ['LEMONSQUEEZY_WEBHOOK_SECRET', 'Every payment webhook is refused with a 401. Nobody ever becomes active.'],
  ['SMS_FROM_NUMBER', 'Missed-call texts are written to disk instead of sent.'],
  ['TWILIO_ACCOUNT_SID', 'Goes with SMS_FROM_NUMBER and the auth token.'],
  ['TWILIO_AUTH_TOKEN', 'Goes with SMS_FROM_NUMBER and the account SID.'],
  [
    'SPEECHIFY_CALLER_ID_NUMBER',
    'Calls arrive from whatever number the platform picks — and a number that is not authorised on the trunk is refused with SIP 403, intermittently, which reads as a flaky carrier for days.',
  ],
];

console.log('\n8&80 — what is actually true right now\n');
console.log('CONFIGURATION');
for (const [key, why] of NEEDED) {
  const set = Boolean(process.env[key]);
  check(set, key, set ? undefined : why);
}

// A feature half set is worse than one not set at all, and is invisible in the
// list above: every name reads as present or absent on its own. The groups and
// their triggers live in preflight, so the two cannot drift apart.
for (const group of FEATURE_GROUPS) {
  if (!group.trigger.some((k) => process.env[k])) continue;
  const missing = group.needs.filter((k) => !process.env[k]);
  if (missing.length) {
    check(false, `${group.label} is half configured`, `Missing: ${missing.join(', ')}. It is written to disk instead.`);
  }
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
  await section('CALLERS', async () => {
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
  });

  await section('BACKGROUND JOBS', async () => {
    const beats = await heartbeats(store.raw);
    if (!beats.length) {
      console.log('  Nothing has reported yet. One tick after deploying is enough.');
      return;
    }
    for (const b of beats) {
      const mins = Math.round((Date.now() - b.at.getTime()) / 60_000);
      // The tick runs every minute. Anything past a few means the scheduler has
      // stopped — which is silent everywhere else you could think to look,
      // because a tick with nothing to do logs nothing at all.
      const ok = b.job !== 'tick' || mins < 5;
      check(
        ok,
        `${b.job} last ran ${mins < 1 ? 'under a minute' : `${mins} minutes`} ago`,
        ok ? (b.note ?? undefined) : 'It should run every minute. Check: systemctl status 8and80-tick.timer',
      );
    }
  });

  let attempts: { scheduled_for: Date; status: string; duration_ms: number | null; note: string | null; sms_sent_at: Date | null }[] = [];
  await section('LAST FIVE ATTEMPTS', async () => {
  attempts = await store.raw<
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
  });

  await section('LAST FIVE DELIVERIES', async () => {
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
  });

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
