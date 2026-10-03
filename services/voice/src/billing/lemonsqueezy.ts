import { createHmac, timingSafeEqual } from 'node:crypto';
import { shapeOf } from '../webhook/speechify.ts';
import { num, obj, pick, str, type Change, type Payments, type Read, type Standing, type Verdict } from './types.ts';

/** Lemon Squeezy's documented HMAC signature and subscription event envelopes. */

/** Tried in order. The first one present is used. */
const SIGNATURE_HEADERS = ['x-signature', 'x-lemonsqueezy-signature', 'signature'];
const EVENT_HEADERS = ['x-event-name', 'x-lemonsqueezy-event', 'x-event'];

export function verifyLemonSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
): Verdict {
  if (!secret) return { ok: false, why: 'no signing secret configured' };
  const header = pick(headers, SIGNATURE_HEADERS);
  if (!header) return { ok: false, why: 'no signature header' };

  const want = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  // Their hex, whatever case and whatever padding they send it in.
  const got = Buffer.from(header.trim().replace(/^sha256=/, ''), 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, why: 'signature mismatch' };
  return { ok: true };
}

/**
 * Their status string to ours.
 *
 * `on_trial` counts as active because a trial that Lemon Squeezy is running is
 * still somebody entitled to the calls. `cancelled` does NOT end them: a
 * cancellation at Lemon Squeezy means "do not renew", and the subscription
 * runs to the end of the period they paid for. Ending the calls the moment
 * somebody cancels would take away a month they have already bought, which is
 * the kind of thing that gets a company written about.
 */
const STANDING: Record<string, Standing> = {
  active: 'active',
  on_trial: 'active',
  paused: 'ended',
  past_due: 'past_due',
  // Dunning exhausted. Their retries are finished and the card never worked,
  // so this is the end rather than another grace period — leaving it as
  // past_due meant calling somebody weekly, forever, for free, while nothing
  // ever said so.
  unpaid: 'ended',
  cancelled: 'active',
  expired: 'ended',
};

export function readLemonWebhook(headers: Record<string, string | string[] | undefined>, payload: unknown): Read {
  const p = payload as Record<string, unknown> | null;
  const meta = obj(p?.['meta']);
  const event = pick(headers, EVENT_HEADERS) ?? str(meta?.['event_name']) ?? str(meta?.['eventName']);
  if (!event) return { ok: false, why: 'no event name', shape: shapeOf(payload) };

  const data = obj(p?.['data']);
  const attrs = obj(data?.['attributes']);
  const status = str(attrs?.['status']);
  // Custom data is the only link between a row in their database and a person
  // in ours. Email matching would be the alternative and it is not one: people
  // pay with a different address than they signed up with all the time.
  const custom = obj(meta?.['custom_data']) ?? obj(meta?.['customData']);

  if (!['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_resumed', 'subscription_expired', 'subscription_paused', 'subscription_unpaused', 'subscription_payment_failed', 'subscription_payment_success', 'subscription_payment_recovered'].includes(event)) return { ok: false, why: 'event not used', shape: shapeOf(payload) };
  const change: Change = { event, provider: 'lemonsqueezy' };
  change.cancelAtPeriodEnd = attrs?.['cancelled'] === true || status === 'cancelled';
  const invoice = data?.['type'] === 'subscription-invoices';
  const id = invoice ? str(attrs?.['subscription_id']) ?? num(attrs?.['subscription_id']) : str(data?.['id']) ?? num(data?.['id']);
  if (id) change.subscriptionId = id;
  const customer = str(attrs?.['customer_id']) ?? num(attrs?.['customer_id']);
  if (customer) change.customerId = customer;
  if (invoice) {
    change.standing = event === 'subscription_payment_failed' ? 'past_due' : 'active';
  } else if (status) {
    change.status = status;
    change.standing = STANDING[status] ?? 'past_due';
  }
  const hash = str(custom?.['phone_hash']) ?? str(custom?.['phoneHash']);
  if (hash) change.phoneHash = hash;
  const ends = str(attrs?.['ends_at']) ?? str(attrs?.['renews_at']);
  if (ends) change.endsAt = ends;

  return { ok: true, change };
}

export const lemonPayments: Payments = {
  name: 'lemonsqueezy',
  verify: (headers, rawBody, secret) => verifyLemonSignature(headers, rawBody, secret),
  read: readLemonWebhook,
  checkout(base, phoneHash, email) {
    const url = new URL(base);
    url.searchParams.set('checkout[custom][phone_hash]', phoneHash);
    if (email) url.searchParams.set('checkout[email]', email);
    return url.toString();
  },
};

export { SIGNATURE_HEADERS, EVENT_HEADERS, STANDING };
