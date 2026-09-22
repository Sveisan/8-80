import { log } from '../log.ts';
import type { ScriptLines } from '../script.ts';
import type { Slot } from '../schedule/time.ts';
import type { Sms } from './types.ts';
import { OptedOut } from './types.ts';

/**
 * The one text before the first call.
 *
 * Until this existed, the first contact anybody had with 8&80 was an unknown
 * number ringing them on a Tuesday morning — indistinguishable from a cold
 * call, and a poor start for a thing whose whole proposition is that it turns
 * up when it said it would.
 *
 * Once, ever, and only when somebody is newly given a slot. A second one would
 * be a reminder about a reminder, which §13 forbids for the missed call and
 * forbids here for the same reason.
 *
 * It carries the link, so the first call can be moved or stopped before it
 * ever happens. That is the whole point: consent that arrives after the phone
 * has already rung is not consent, it is an apology.
 */
export async function textBeforeFirstCall(
  phone: string,
  first: Date,
  slot: Slot,
  deps: { sms: Sms; script: ScriptLines },
  link: string,
): Promise<boolean> {
  const template = deps.script.get('sms.welcome');
  if (!template) return false;

  const when = first.toLocaleString('en-GB', {
    timeZone: slot.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    await deps.sms.send(phone, template.replace('{{when}}', when).replace('{{link}}', link));
  } catch (e) {
    // Somebody who opted out before they were ever enrolled has said no in
    // advance, and the answer is the same as saying it afterwards: do not ring
    // them. The caller decides what to do with that; this only reports it.
    if (e instanceof OptedOut) throw e;
    log('sms.welcome_not_sent', { reason: (e as Error).message });
    return false;
  }
  return true;
}
