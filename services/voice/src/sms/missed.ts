import { log } from '../log.ts';
import type { ScriptLines } from '../script.ts';
import type { Scheduler } from '../schedule/scheduler.ts';
import { describeAppointment, type Slot } from '../schedule/time.ts';
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
  if (!deps.sms.transactional && !(await deps.scheduler.claimNudge(attemptId))) return false;
  const template = deps.script.get('sms.missed');
  if (!template) return false;
  // Without a link there is nothing to act on, and a text that only says the
  // call was missed is a notification about a failure. Better to send nothing.
  if (!link) return false;
  try {
    await deps.sms.send(phone, template.replace('{{link}}', link));
  } catch (e) {
    if (deps.sms.transactional) throw e;
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

/**
 * The text for a call that never left the building.
 *
 * `textAfterMissedCall` says "rang just now", which is a lie when the carrier
 * refused it and their phone never made a sound. Same claim, same once-only
 * guarantee, different sentence — because the difference matters to the person
 * reading it, and because "my end, not yours" is true and worth saying.
 *
 * A weekly call that silently does not arrive is the one failure this product
 * cannot have. It makes a single promise and the promise is that it turns up.
 */
export async function textAfterFailedCall(
  attemptId: string,
  phone: string,
  deps: { sms: Sms; scheduler: Scheduler; script: ScriptLines },
  link?: string,
): Promise<boolean> {
  if (!deps.sms.transactional && !(await deps.scheduler.claimNudge(attemptId))) return false;
  const template = deps.script.get('sms.failed');
  if (!template || !link) return false;
  try {
    await deps.sms.send(phone, template.replace('{{link}}', link));
  } catch (e) {
    if (deps.sms.transactional) throw e;
    if (e instanceof OptedOut) {
      await deps.scheduler.setPaused(phone, true);
      log('sms.stopped_by_carrier', { note: 'opted out at the carrier — calls paused' });
      return false;
    }
    log('sms.failed_notice_not_sent', { reason: (e as Error).message });
    return false;
  }
  return true;
}

/**
 * The text a finished call owes, when the call could not finish the job itself.
 *
 * Two things the mentor cannot do on a phone call: move the weekly slot, and
 * take an email address. It says so out loud in both cases — and a sentence
 * admitting a limit, followed by nothing, is just an apology. This is the part
 * that makes it an arrangement.
 *
 * One text, never two. Somebody who asked to move the call AND has no address
 * on file gets the slot one, because that is the thing they asked for, and the
 * page at the other end carries both. SCRIPT.md §13: a product whose premise is
 * that it does not nag cannot send two messages about one call.
 *
 * Same once-only claim as the missed-call text, so a webhook delivered twice —
 * which theirs are — cannot text somebody twice.
 */
export async function textAfterCall(
  attemptId: string,
  phone: string,
  want: 'slot' | 'email' | 'callback' | 'callback_unavailable',
  deps: { sms: Sms; scheduler: Scheduler; script: ScriptLines },
  link?: string,
  next?: string,
): Promise<boolean> {
  // Without a link there is nothing to act on, and a text saying "you can't do
  // this here" with no elsewhere is worse than silence.
  if (!link) return false;
  const template = deps.script.get({ slot: 'sms.slot.link', email: 'sms.email.ask', callback: 'sms.callback', callback_unavailable: 'sms.callback.unavailable' }[want]);
  if (!template) return false;
  if (!deps.sms.transactional && !(await deps.scheduler.claimNudge(attemptId))) return false;
  try {
    await deps.sms.send(phone, template.replace('{{link}}', link).replace('{{when}}', next ?? ''));
  } catch (e) {
    if (deps.sms.transactional) throw e;
    if (e instanceof OptedOut) {
      await deps.scheduler.setPaused(phone, true);
      log('sms.stopped_by_carrier', { note: 'opted out at the carrier — calls paused' });
      return false;
    }
    log('sms.after_call_not_sent', { reason: (e as Error).message, want });
    return false;
  }
  log('sms.after_call', { want });
  return true;
}

export interface ReplyOutcome {
  action: 'moved' | 'moved_always' | 'needs_time' | 'skipped' | 'unchanged' | 'stopped' | 'started' | 'unread';
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
  context: { skipAt?: Date; language?: string } = {},
): Promise<ReplyOutcome> {
  const reply = parseReply(text, now, slot.timezone);
  /**
   * Say it, and never let the saying undo the doing.
   *
   * Scheduling changes are written before they are acknowledged, and a failed
   * acknowledgement must not turn that write into a 500 — the
   * carrier retries a 500, and a retried command can target a changed schedule.
   * It matters most on the branch it was written
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
    if (deps.sms.transactional) throw e;
      log('sms.reply_not_sent', { reason: (e as Error).message });
    }
    return body;
  };

  switch (reply.kind) {
    case 'cancel_subscription':
      return { action: 'unread', said: await say('sms.subscription.needs_verification') };
    case 'stop':
      // The calls stop before anything else happens, including being told
      // that they have. SCRIPT.md §13.
      await deps.scheduler.setPaused(phone, true);
      return { action: 'stopped', said: await say('sms.stopped') };

    case 'start': {
      const back = await deps.scheduler.resumeIfEligible(phone, now);
      if (!back) return { action: 'unchanged', said: await say('sms.start.inactive') };
      return {
        action: 'started',
        said: await say(
          'sms.started',
          describeAppointment(back, slot.timezone, context.language),
        ),
      };
    }

    case 'skip': {
      const result = await deps.scheduler.skipCall(phone, now, context.skipAt);
      if (result.kind === 'inactive') return { action: 'unchanged', said: await say('sms.skip.inactive') };
      if (!result.next) return { action: 'skipped', said: await say(result.kind === 'skipped' && result.paidAccessEnded ? 'sms.skipped.paid_end' : 'sms.skipped.trial_end') };
      return {
        action: result.kind,
        said: await say(
          result.kind === 'skipped' ? 'sms.skipped' : 'sms.skip.unchanged',
          describeAppointment(result.next, slot.timezone, context.language),
        ),
      };
    }

    case 'later':
      // “Later” is not permission to choose an hour, particularly overnight.
      return { action: 'needs_time', said: await say('sms.later') };

    case 'move': {
      const at = moveTo(reply, slot.timezone, now);
      const when = describeAppointment(at, slot.timezone, context.language);
      const weekly = reply.always ? { weekday: reply.weekday, minute: reply.minute, timezone: slot.timezone } : undefined;
      if (!(await deps.scheduler.moveIfActive(phone, at, weekly))) {
        return { action: 'unchanged', said: await say('sms.move.inactive') };
      }
      return { action: reply.always ? 'moved_always' : 'moved', said: await say(reply.always ? 'sms.moved.always' : 'sms.moved', when) };
    }

    default:
      return { action: 'unread', said: await say('sms.unparsed') };
  }
}
