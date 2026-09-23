import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { log } from '../log.ts';
import { Links } from '../link/token.ts';
import { PostgresStore, phoneKey } from '../store/postgres.ts';
import { openSms } from '../sms/index.ts';
import { OptedOut } from '../sms/types.ts';
import { textBeforeFirstCall } from '../sms/welcome.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { readSignup } from './form.ts';
import { Limiter } from './limit.ts';
import { Pending } from './pending.ts';
import { codePage, signupPage, welcomePage } from './page.ts';

export interface Answer {
  status: number;
  body: string;
}

const HOUR = 3600_000;
/** One number may be texted three times an hour. It is somebody's evening. */
const perNumber = new Limiter(3, HOUR);
/** One client may ask ten times an hour. It is our phone bill. */
const perClient = new Limiter(10, HOUR);

const TRIAL_DAYS = 30;

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A form with six short fields does not need more, and a public endpoint
    // that will read as much as it is given is a way to run us out of memory.
    if (size > 8_192) break;
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The sign-up flow: describe it, take a form, prove the number, make a caller.
 *
 * Three steps and no account. There is no password anywhere in this product
 * and there is not going to be: everything a caller can do, they do from a
 * link in a text or by saying it on the phone, and a login would be a fourth
 * thing to forget in order to move a phone call.
 *
 * Returns undefined for a path it does not own, so the control plane's 404
 * stays in one place.
 */
export async function signupRoutes(
  req: IncomingMessage,
  url: URL,
  deps: LoopDeps,
  client: string,
  now = new Date(),
): Promise<Answer | undefined> {
  const script = deps.script;
  const store = deps.store as PostgresStore;
  const pending = new Pending(store.raw);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/start')) {
    if (!config.signup.open()) return undefined;
    return { status: 200, body: signupPage(script) };
  }

  if (req.method === 'POST' && url.pathname === '/start') {
    if (!config.signup.open()) return undefined;
    const form = await body(req);
    const read = readSignup(form, now);
    if (!read.ok) {
      return {
        status: 200,
        body: signupPage(script, {
          errors: read.errors,
          values: {
            name: form.get('name') ?? '',
            phone: form.get('phone') ?? '',
            email: form.get('email') ?? '',
            weekday: form.get('weekday') ?? '',
            time: form.get('time') ?? '',
          },
        }),
      };
    }

    const { signup } = read;
    // Both limits, and the number's first: a client that has burned its own
    // window must not be able to spend somebody else's by switching IP.
    if (!perNumber.take(phoneKey(signup.phone), now.getTime()) || !perClient.take(client, now.getTime())) {
      log('signup.rate_limited', {});
      // Deliberately indistinguishable from success. Telling a script which
      // numbers are rate limited tells it which numbers it has reached.
      return { status: 200, body: codePage(signup.phone, script) };
    }

    const code = await pending.start(signup, now);
    const template = script.get('sms.code') ?? '';
    try {
      await openSms().send(signup.phone, template.replace('{{code}}', code));
    } catch (e) {
      // Including an opt-out: somebody who told the carrier to stop messaging
      // us is somebody we do not text.
      log('signup.code_not_sent', { reason: e instanceof OptedOut ? 'opted out' : (e as Error).message });
      // And they are told, on this page, now. The page used to say "check your
      // texts" whether or not a text had left the building — so the first real
      // sign-up sat waiting for a message that was never coming and believed
      // it had worked. A silence that looks like success is the worst thing
      // this page can do.
      return { status: 200, body: codePage(signup.phone, script, 'signup.code.notsent') };
    }
    return { status: 200, body: codePage(signup.phone, script) };
  }

  if (req.method === 'POST' && url.pathname === '/start/verify') {
    const form = await body(req);
    const phone = (form.get('phone') ?? '').trim();
    const verdict = await pending.verify(phone, form.get('code') ?? '', now);
    if (!verdict.ok) {
      const key = {
        unknown: 'signup.code.unknown',
        expired: 'signup.code.expired',
        wrong: 'signup.code.wrong',
        'too many': 'signup.code.toomany',
      }[verdict.why];
      return { status: 200, body: codePage(phone, script, key) };
    }

    const { signup } = verdict;
    const slot = { weekday: signup.weekday, minute: signup.minute, timezone: signup.timezone };
    await store.upsertProfile(signup.phone, { name: signup.name, email: signup.email });
    await store.startTrial(signup.phone, new Date(now.getTime() + TRIAL_DAYS * 24 * HOUR));
    const first = await deps.scheduler.setSlot(signup.phone, slot, now);

    // The same text an enrolment sends, for the same reason: the first call
    // must not be the first they hear of it, and the link has to exist before
    // the phone rings rather than after.
    const link = `${config.link.publicUrl()}/r/${await new Links(store.raw).mint(phoneKey(signup.phone))}`;
    try {
      await textBeforeFirstCall(signup.phone, first, slot, { sms: openSms(), script }, link);
    } catch (e) {
      if (!(e instanceof OptedOut)) throw e;
      await deps.scheduler.setPaused(signup.phone, true);
      log('signup.opted_out', { note: 'verified but the number refuses messages — paused' });
    }

    log('signup.completed', { trialDays: TRIAL_DAYS });
    return { status: 200, body: welcomePage(signup, first, script) };
  }

  return undefined;
}
