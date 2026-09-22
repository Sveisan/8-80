import { log } from '../log.ts';
import type { ScriptLines } from '../script.ts';
import type { Scheduler } from '../schedule/scheduler.ts';
import type { Slot } from '../schedule/time.ts';
import { moveTo, parseReply } from './reply.ts';
import { OptedOut, type Sms } from './types.ts';

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
  link?: string,
): Promise<boolean> {
  // Somebody else may already have sent it. Losing the race means sending
  // nothing, not sending a second one.
  if (!(await deps.scheduler.claimNudge(attemptId))) return false;
  const template = deps.script.get('sms.missed');
  if (!template) return false;
  // Without a link there is nothing to act on, and a text that only says the
  // call was missed is a notification about a failure. Better to send nothing.
  if (!link) return false;
  try {
    await deps.sms.send(phone, template.replace('{{link}}', link));
  } catch (e) {
    // The path that closes the hole. A carrier handles STOP before our webhook
    // ever sees it, so the first we learn of it is a rejected send — hours or
    // a week later, on the next missed call. Until this existed, that person
    // could not receive the one message offering a way out and was still being
    // rung every week, which is the worst state this product can put somebody
    // in. SCRIPT.md §13.
    if (!(e instanceof OptedOut)) throw e;
    await deps.scheduler.setPaused(phone, true);
    log('sms.stopped_by_carrier', { note: 'opted out at the carrier — calls paused' });
    return false;
  }
  return true;
}

export interface ReplyOutcome {
  action: 'moved' | 'moved_always' | 'later' | 'skipped' | 'stopped' | 'started' | 'unread';
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
  const reply = parseReply(text, now, slot.timezone);
  /**
   * Say it, and never let the saying undo the doing.
   *
   * Every branch below writes to the scheduler first and acknowledges second,
   * and a failed acknowledgement must not turn that write into a 500 — the
   * carrier retries a 500, and a retried STOP is harmless while a retried
   * "later" moves the call twice. It matters most on the branch it was written
   * for: after a carrier handles a STOP, messages to that number are blocked,
   * so the confirmation is the one send guaranteed to fail, on the one action
   * that must never fail to take effect.
   */
  const say = async (key: string, when?: string): Promise<string> => {
    const body = (deps.script.get(key) ?? '').replace('{{when}}', when ?? '');
    if (!body) return body;
    try {
      await deps.sms.send(phone, body);
    } catch (e) {
      log('sms.reply_not_sent', { reason: (e as Error).message });
    }
    return body;
  };

  switch (reply.kind) {
    case 'stop':
      // The calls stop before anything else happens, including being told
      // that they have. SCRIPT.md §13.
      await deps.scheduler.setPaused(phone, true);
      return { action: 'stopped', said: await say('sms.stopped') };

    case 'start': {
      await deps.scheduler.setPaused(phone, false);
      // Not just unpaused: a next_call_at left in the past would be read as a
      // missed week the moment the tick saw it, so the slot is recomputed from
      // now and they come back to the next real occurrence of their own time.
      const back = await deps.scheduler.setSlot(phone, slot, now);
      return {
        action: 'started',
        said: await say(
          'sms.started',
          back.toLocaleString('en-GB', { timeZone: slot.timezone, weekday: 'long', hour: '2-digit', minute: '2-digit' }),
        ),
      };
    }

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
