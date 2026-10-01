import { config } from './config.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { parseLocalTime, parseWeekday } from './schedule/time.ts';
import { PostgresStore, phoneKey } from './store/postgres.ts';
import { decrypt, hasKey } from './store/crypto.ts';
import { Links } from './link/token.ts';
import { loadScript } from './script.ts';
import { openSms } from './sms/index.ts';
import { textBeforeFirstCall } from './sms/welcome.ts';
import { OptedOut } from './sms/types.ts';

/**
 * Put somebody on the list, or move them.
 *
 *   npm run enrol -- --phone +4790033575 --name Eirik --email e@example.com \
 *                    --day tuesday --time 08:00
 *
 *   npm run enrol -- --phone +4790033575 --in 3     # ring me in three minutes
 *   npm run enrol -- --phone +4790033575 --rehearse --in 3
 *                                                   # ...as the first call again
 *   npm run enrol -- --phone +4790033575 --clear-commitment
 *   npm run enrol -- --phone +4790033575 --commitment "send the dinner invites"
 *                                                   # fix what next week opens on
 *   npm run enrol -- --list
 *
 * Giving somebody a slot for the first time texts them to say when the first
 * call is, with a link to move or refuse it before it happens. `--quiet` skips
 * that, for enrolling yourself or re-running a command.
 *
 * Deliberately a command and not a web form. The first caller is the person
 * building this, the second is a friend, and by the time there is a tenth there
 * will be a sign-up page. A form built now would be built for nobody.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const fail = (why: string): never => {
  console.error(why);
  process.exit(1);
};

if (!config.database.url) fail('DATABASE_URL is not set.');
if (!hasKey()) fail('DATA_ENCRYPTION_KEY is not set — a number would go to disk in the clear.');

const store = new PostgresStore(config.database.url);
const scheduler = new Scheduler(store.raw);

/** A number somebody who knows it would recognise, and nobody else. */
function safe(enc: string): string {
  if (!hasKey()) return '(encrypted)';
  try {
    const phone = decrypt(enc);
    // First three characters and last three, and no attempt to find where the
    // country code ends. Country codes are one to three digits and nothing in
    // the number says which, so a regex guessing at it prints "+479" for a
    // Norwegian number — a wrong country, stated confidently.
    return `${phone.slice(0, 3)}${'·'.repeat(Math.max(1, phone.length - 6))}${phone.slice(-3)}`;
  } catch {
    // A row written under a different key. Worth saying so rather than
    // printing nothing, because it means that caller cannot be rung either.
    return '(unreadable)';
  }
}

try {
  if (has('list')) {
    const rows = await store.raw<
      { phone_enc: string; call_number: number; timezone: string | null; slot_weekday: number | null; slot_minute: number | null; next_call_at: Date | null; paused: boolean; rehearse_first_call: boolean }[]
    >`select phone_enc, call_number, timezone, slot_weekday, slot_minute, next_call_at, paused, rehearse_first_call from callers order by next_call_at`;
    if (!rows.length) console.log('Nobody is enrolled.');
    for (const r of rows) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const slot = r.slot_weekday === null || r.slot_minute === null
        ? 'no slot'
        : `${days[r.slot_weekday]} ${String(Math.floor(r.slot_minute / 60)).padStart(2, '0')}:${String(r.slot_minute % 60).padStart(2, '0')} ${r.timezone}`;
      // The country code and the last three digits, and nothing between.
      //
      // This printed nothing identifying at all, on the reasoning that a
      // terminal is a screen somebody else can see. That reasoning holds and
      // the line still obeys it — but it also made an ordinary question
      // unanswerable: which of these rows is a test number and which is a
      // person about to be rung for the first time. Three digits settle that
      // for whoever already knows the number and tell a stranger nothing.
      //
      // Never the whole number. A list of everybody's number on one screen is
      // the export this product refuses to build.
      const n = safe(r.phone_enc);
      console.log(
        `${n}  call #${r.call_number}  ${slot}${r.paused ? '  (paused)' : ''}${r.rehearse_first_call ? '  (rehearsing the first call)' : ''}  next: ${r.next_call_at?.toISOString() ?? 'never'}`,
      );
    }
    process.exit(0);
  }

  const phone = flag('phone') ?? fail('--phone is required, in E.164: +4790000000');
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) fail(`${phone} is not an E.164 number — it needs the country code, like +4790000000`);

  const profile: { name?: string; email?: string; language?: string; voice?: string } = {};
  for (const k of ['name', 'email', 'language', 'voice'] as const) {
    const v = flag(k);
    if (v) profile[k] = v;
  }
  // Always, even with nothing to set. Everything below is an UPDATE, and an
  // UPDATE against a caller who does not exist succeeds while doing nothing —
  // which is how "Slot set" was printed for somebody the scheduler had never
  // heard of.
  // Read before the upsert creates the row, so a first enrolment can be told
  // from a change to an existing one.
  const hadSlot = Boolean(await scheduler.slotFor(phone));
  await store.upsertProfile(phone, profile);

  const day = flag('day');
  const time = flag('time');
  if (day || time) {
    const weekday = parseWeekday(day ?? '') ?? fail(`--day ${day} is not a weekday`);
    const minute = parseLocalTime(time ?? '') ?? fail(`--time ${time} is not a time like 08:00`);
    const timezone = flag('tz') ?? 'Europe/Oslo';
    const slot = { weekday, minute, timezone };
    // Before the slot is set, because after it there is no way to tell a first
    // slot from a moved one, and this text must go out exactly once ever.
    const first = !hadSlot && (await store.load(phone)).callNumber === 0;
    const next = await scheduler.setSlot(phone, slot, new Date());
    console.log(`Slot set. Next call ${next.toISOString()}`);

    if (first && !has('quiet')) {
      // An unknown number ringing on a Tuesday morning is a cold call. One
      // text first, with the link on it, so the first call can be moved or
      // refused before it ever happens. SCRIPT.md §13.
      const link = `${config.link.publicUrl()}/r/${await new Links(store.raw).mint(phoneKey(phone))}`;
      try {
        const sent = await textBeforeFirstCall(phone, next, slot, { sms: openSms(), script: loadScript() }, link);
        console.log(sent ? 'Texted them when the first call is.' : 'No text sent — see the log.');
      } catch (e) {
        if (!(e instanceof OptedOut)) throw e;
        // They said no before they were ever asked. Honour it now rather than
        // ring them and find out.
        await scheduler.setPaused(phone, true);
        console.log('That number has opted out of messages. Paused rather than called.');
      }
    }
  }

  const inMinutes = flag('in');
  if (inMinutes) {
    const mins = Number(inMinutes);
    if (!Number.isFinite(mins) || mins < 0) fail(`--in ${inMinutes} is not a number of minutes`);
    // The standing arrangement is untouched: this is a one-off, exactly like
    // "try me later today" from a missed-call text.
    const at = new Date(Date.now() + mins * 60_000);
    await scheduler.callAgainAt(phone, at);
    console.log(`One-off call at ${at.toISOString()} — the weekly slot is unchanged.`);
  }

  if (has('pause')) await scheduler.setPaused(phone, true);
  if (has('resume')) await scheduler.setPaused(phone, false);

  if (has('rehearse') || has('no-rehearse')) {
    const on = !has('no-rehearse');
    const found = await store.setRehearseFirstCall(phone, on);
    if (!found) fail('No such caller. Give them a slot first, then rehearse.');
    console.log(
      on
        ? 'The next call will be the first-call experience. Nothing else was changed.'
        : 'Rehearsal cleared. The next call is the ordinary one.',
    );
  }

  if (flag('commitment') !== undefined || has('clear-commitment')) {
    const text = has('clear-commitment') ? undefined : flag('commitment');
    const found = await store.setCommitment(phone, text);
    if (!found) fail('No such caller.');
    console.log(text ? `Next call opens on: "${text}".` : 'Commitment cleared. The next call asks what they ended up working on.');
  }

  const rec = await store.load(phone);
  const as = rec.rehearseFirstCall ? ' — served as a first call (rehearsal)' : '';
  console.log(`Enrolled. This will be call number ${rec.callNumber}${as}.`);
} finally {
  await store.close();
}
