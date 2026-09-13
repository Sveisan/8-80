import type { ScriptLines } from '../script.ts';
import type { Scheduler } from '../schedule/scheduler.ts';
import type { Slot } from '../schedule/time.ts';
import { moveTo, parseReply } from './reply.ts';
import type { Sms } from './types.ts';

/**
 * The missed-call text, and what a reply to it does.
 *
 * `ARCHITECTURE.md` settled the shape long before any of this existed: no
 * answer means hang up, never voicemail, one warm SMS. This is that SMS and the
 * conversation it is allowed to have — which is short, because the alternative
 * to a short one is a product that texts people about missing a call.
 */
export async function textAfterMissedCall(
  attemptId: string,
  phone: string,
  deps: { sms: Sms; scheduler: Scheduler; script: ScriptLines },
): Promise<boolean> {
  // Somebody else may already have sent it. Losing the race means sending
  // nothing, not sending a second one.
  if (!(await deps.scheduler.claimNudge(attemptId))) return false;
  const body = deps.script.get('sms.missed');
  if (!body) return false;
  await deps.sms.send(phone, body);
  return true;
}

export interface ReplyOutcome {
  action: 'moved' | 'moved_always' | 'later' | 'skipped' | 'unread';
  /** What we said back, so a caller always gets an answer from a person's system. */
  said: string;
}

/**
 * Act on a reply, and always answer it.
 *
 * Silence is the one response not available here. Somebody who texted a number
 * that rang them and got nothing back has learned the thing does not listen,
 * which is the opposite of what the call spends fifteen minutes establishing.
 */
export async function handleReply(
  phone: string,
  text: string,
  slot: Slot,
  deps: { sms: Sms; scheduler: Scheduler; script: ScriptLines },
  now = new Date(),
): Promise<ReplyOutcome> {
  const reply = parseReply(text);
  const say = async (key: string, when?: string): Promise<string> => {
    const body = (deps.script.get(key) ?? '').replace('{{when}}', when ?? '');
    if (body) await deps.sms.send(phone, body);
    return body;
  };

  switch (reply.kind) {
    case 'skip':
      // The slot is untouched: skipping a week is not leaving.
      return { action: 'skipped', said: await say('sms.skipped') };

    case 'later': {
      const evening = new Date(now.getTime() + 8 * 3600_000);
      await deps.scheduler.callAgainAt(phone, evening);
      return { action: 'later', said: await say('sms.later') };
    }

    case 'move': {
      const at = moveTo(reply, slot.timezone, now);
      const when = at.toLocaleString('en-GB', {
        timeZone: slot.timezone,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
      if (reply.always) {
        await deps.scheduler.setSlot(phone, { weekday: reply.weekday, minute: reply.minute, timezone: slot.timezone }, now);
        return { action: 'moved_always', said: await say('sms.moved.always', when) };
      }
      // This week only. A day and a time after a missed call is not a request
      // to rewrite a standing arrangement, and the escape hatch is in the reply.
      await deps.scheduler.callAgainAt(phone, at);
      return { action: 'moved', said: await say('sms.moved', when) };
    }

    default:
      return { action: 'unread', said: await say('sms.unparsed') };
  }
}
