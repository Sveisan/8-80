import { config } from './config.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { parseLocalTime, parseWeekday } from './schedule/time.ts';
import { PostgresStore } from './store/postgres.ts';
import { hasKey } from './store/crypto.ts';

/**
 * Put somebody on the list, or move them.
 *
 *   npm run enrol -- --phone +4790033575 --name Eirik --email e@example.com \
 *                    --day tuesday --time 08:00
 *
 *   npm run enrol -- --phone +4790033575 --in 3     # ring me in three minutes
 *   npm run enrol -- --list
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

try {
  if (has('list')) {
    const rows = await store.raw<
      { call_number: number; timezone: string | null; slot_weekday: number | null; slot_minute: number | null; next_call_at: Date | null; paused: boolean }[]
    >`select call_number, timezone, slot_weekday, slot_minute, next_call_at, paused from callers order by next_call_at`;
    if (!rows.length) console.log('Nobody is enrolled.');
    for (const r of rows) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const slot = r.slot_weekday === null || r.slot_minute === null
        ? 'no slot'
        : `${days[r.slot_weekday]} ${String(Math.floor(r.slot_minute / 60)).padStart(2, '0')}:${String(r.slot_minute % 60).padStart(2, '0')} ${r.timezone}`;
      // No numbers and no names: a terminal is a screen somebody else can see.
      console.log(
        `call #${r.call_number}  ${slot}${r.paused ? '  (paused)' : ''}  next: ${r.next_call_at?.toISOString() ?? 'never'}`,
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
  if (Object.keys(profile).length) await store.upsertProfile(phone, profile);

  const day = flag('day');
  const time = flag('time');
  if (day || time) {
    const weekday = parseWeekday(day ?? '') ?? fail(`--day ${day} is not a weekday`);
    const minute = parseLocalTime(time ?? '') ?? fail(`--time ${time} is not a time like 08:00`);
    const timezone = flag('tz') ?? 'Europe/Oslo';
    const next = await scheduler.setSlot(phone, { weekday, minute, timezone }, new Date());
    console.log(`Slot set. Next call ${next.toISOString()}`);
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

  const rec = await store.load(phone);
  console.log(`Enrolled. This will be call number ${rec.callNumber}.`);
} finally {
  await store.close();
}
