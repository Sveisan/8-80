import { parseLocalTime, parseWeekday } from '../schedule/time.ts';

export interface Signup {
  phone: string;
  email: string;
  name: string;
  weekday: number;
  minute: number;
  timezone: string;
}

export type Invalid = { field: keyof Signup; why: string };

const E164 = /^\+[1-9]\d{6,14}$/;
/**
 * Deliberately loose. The only test that settles whether an address works is
 * sending to it, and every clever pattern ever written has rejected somebody's
 * real address. This rejects what cannot possibly be one and lets the rest
 * through to Resend, which knows.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** Norwegian numbers typed the way Norwegians type them. */
function normalisePhone(raw: string, fallbackCountry = '+47'): string {
  const digits = raw.replace(/[\s()\-.]/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('+')) return digits;
  // Eight digits and no country code is a Norwegian mobile. Anything else
  // without a country code is a guess we are not entitled to make.
  if (/^\d{8}$/.test(digits)) return `${fallbackCountry}${digits}`;
  return digits;
}

/**
 * What the form said, or what is wrong with it.
 *
 * Every field is checked before anything is written and before a code is sent,
 * because a code sent to a mistyped number is a text to a stranger, and the
 * stranger is the one who pays for our validation being lax.
 *
 * Errors come back as a list rather than the first one. Somebody who fat-fingers
 * two fields on a phone should learn that once, not twice.
 */
export function readSignup(
  form: URLSearchParams,
  now = new Date(),
  fallbackCountry = '+47',
): { ok: true; signup: Signup } | { ok: false; errors: Invalid[] } {
  const errors: Invalid[] = [];
  const get = (k: string): string => (form.get(k) ?? '').trim();

  const phone = normalisePhone(get('phone'), fallbackCountry);
  if (!E164.test(phone)) errors.push({ field: 'phone', why: 'number' });

  const email = get('email');
  if (!EMAIL.test(email)) errors.push({ field: 'email', why: 'email' });

  const name = get('name').slice(0, 80);
  if (!name) errors.push({ field: 'name', why: 'name' });

  const weekday = parseWeekday(get('weekday'));
  if (weekday === undefined) errors.push({ field: 'weekday', why: 'weekday' });

  const minute = parseLocalTime(get('time'));
  if (minute === undefined) errors.push({ field: 'minute', why: 'time' });

  const timezone = get('timezone') || 'Europe/Oslo';
  if (!isZone(timezone, now)) errors.push({ field: 'timezone', why: 'timezone' });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    signup: { phone, email, name, weekday: weekday as number, minute: minute as number, timezone },
  };
}

/**
 * Whether the platform has heard of this zone.
 *
 * The zone arrives from a hidden field the browser filled in, so it is not
 * user input in the usual sense — but it reaches `Intl.DateTimeFormat`, which
 * throws on an unknown zone, and a throw here would be a 500 on the one page
 * where a 500 costs a customer.
 */
function isZone(name: string, now: Date): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name }).format(now);
    return true;
  } catch {
    return false;
  }
}
