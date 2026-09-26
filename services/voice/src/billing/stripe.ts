import { createHmac, timingSafeEqual } from 'node:crypto';
import { shapeOf } from '../webhook/speechify.ts';
import { num, obj, pick, str, type Change, type Payments, type Read, type Standing, type Verdict } from './types.ts';

const SIGNATURE_HEADERS = ['stripe-signature'];
/** Five minutes, the same window their own libraries use. */
const TOLERANCE_MS = 5 * 60_000;

/**
 * Stripe's status to ours — and the row that is the opposite of the other
 * vendor's.
 *
 * At Lemon Squeezy, `cancelled` meant "do not renew" and the subscription ran
 * to the end of the paid period, so it mapped to `active`. At Stripe,
 * `canceled` means the subscription is already over; the "do not renew" state
 * is `active` with `cancel_at_period_end` set. Carrying the first mapping over
 * to the second vendor would have ended somebody's calls on the day they
 * cancelled, taking away a month they had already paid for.
 *
 * `incomplete` is a first payment that never completed. It reads as past_due
 * rather than ended so that a card needing 3-D Secure does not cost somebody
 * their week between the two events.
 */
const STANDING: Record<string, Standing> = {
  trialing: 'active',
  active: 'active',
  past_due: 'past_due',
  incomplete: 'past_due',
  unpaid: 'ended',
  canceled: 'ended',
  incomplete_expired: 'ended',
  paused: 'ended',
};

/**
 * Stripe's webhook signature.
 *
 * `Stripe-Signature: t=<unix seconds>,v1=<hex>,v1=<hex>`, where the signed
 * payload is `${t}.${raw body}` — the raw bytes, before any parsing, because a
 * re-serialised body is a different body. More than one v1 appears during a
 * secret rotation and any of them matching is a pass, which is what makes
 * rotation possible without a window where everything 401s.
 *
 * The timestamp is checked as well as the signature. Without it a valid
 * delivery captured once could be replayed forever.
 */
export function verifyStripeSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
  now = new Date(),
): Verdict {
  if (!secret) return { ok: false, why: 'no signing secret configured' };
  const header = pick(headers, SIGNATURE_HEADERS);
  if (!header) return { ok: false, why: 'no signature header' };

  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find((kv) => kv[0] === 't')?.[1];
  const signatures = parts.filter((kv) => kv[0] === 'v1').map((kv) => kv[1] ?? '');
  if (!t || !signatures.length) return { ok: false, why: 'malformed signature header' };

  const age = Math.abs(now.getTime() - Number(t) * 1000);
  if (!Number.isFinite(age) || age > TOLERANCE_MS) return { ok: false, why: 'timestamp outside the window' };

  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex'), 'hex');
  for (const candidate of signatures) {
    const got = Buffer.from(candidate, 'hex');
    if (got.length === want.length && timingSafeEqual(want, got)) return { ok: true };
  }
  return { ok: false, why: 'signature mismatch' };
}

/**
 * What a Stripe event means for a caller.
 *
 * Two shapes arrive here. A completed Checkout Session is the only event that
 * carries `client_reference_id` — our phone hash, round-tripped through the
 * payment link — and is therefore the only one that can attach a subscription
 * to a person. Everything after it is found by the subscription id that
 * session wrote.
 */
export function readStripeWebhook(headers: Record<string, string | string[] | undefined>, payload: unknown): Read {
  const p = obj(payload);
  const event = str(p?.['type']);
  if (!event) return { ok: false, why: 'no event type', shape: shapeOf(payload) };

  const object = obj(obj(p?.['data'])?.['object']);
  if (!object) return { ok: false, why: 'no data.object', shape: shapeOf(payload) };

  const change: Change = { event };
  const objectType = str(object['object']) ?? '';

  if (objectType === 'checkout.session') {
    // The one event that knows who this is.
    const hash = str(object['client_reference_id']);
    if (hash) change.phoneHash = hash;
    const sub = idOf(object['subscription']);
    if (sub) change.subscriptionId = sub;
    const customer = idOf(object['customer']);
    if (customer) change.customerId = customer;
    // A completed session in subscription mode is a paid subscription. The
    // customer.subscription.created that follows carries the authoritative
    // status; this is the one that carries the identity.
    change.status = str(object['payment_status']) ?? 'complete';
    change.standing = change.status === 'unpaid' ? 'past_due' : 'active';
    return { ok: true, change };
  }

  if (objectType === 'subscription') {
    const id = str(object['id']);
    if (id) change.subscriptionId = id;
    const customer = idOf(object['customer']);
    if (customer) change.customerId = customer;
    const status = str(object['status']);
    if (status) {
      change.status = status;
      // An unknown status fails towards still calling somebody rather than
      // towards cutting off a paying customer.
      change.standing = STANDING[status] ?? 'past_due';
    }
    const ends = num(object['current_period_end']) ?? num(object['cancel_at']);
    if (ends) change.endsAt = new Date(Number(ends) * 1000).toISOString();
    return { ok: true, change };
  }

  if (objectType === 'invoice') {
    const sub = idOf(object['subscription']) ?? idOf(obj(object['parent'])?.['subscription']);
    if (sub) change.subscriptionId = sub;
    const customer = idOf(object['customer']);
    if (customer) change.customerId = customer;
    // The invoice says what happened to one payment; the subscription event
    // that accompanies it says what that means overall. This is the faster of
    // the two and the one that must not be missed, because a failed card that
    // says nothing is how somebody's calls stop without warning.
    change.status = event;
    change.standing = event === 'invoice.payment_failed' ? 'past_due' : 'active';
    return { ok: true, change };
  }

  return { ok: false, why: `nothing we act on: ${objectType || 'unknown object'}`, shape: shapeOf(payload) };
}

/** Stripe sends either an id or the expanded object, depending on the event. */
const idOf = (v: unknown): string | undefined => str(v) ?? str(obj(v)?.['id']);

/**
 * A payment link, carrying our key back to us.
 *
 * `client_reference_id` is the only thing tying a row in Stripe's database to
 * a caller in ours. Matching on email would be the alternative and is not one:
 * people pay with a different address than they signed up with all the time,
 * and a payment that cannot find its caller is a payment taken for calls that
 * never resume.
 */
export const stripePayments: Payments = {
  name: 'stripe',
  verify: (headers, rawBody, secret) => verifyStripeSignature(headers, rawBody, secret),
  read: readStripeWebhook,
  checkout(base, phoneHash, email) {
    const url = new URL(base);
    url.searchParams.set('client_reference_id', phoneHash);
    if (email) url.searchParams.set('prefilled_email', email);
    return url.toString();
  },
};

export { STANDING, TOLERANCE_MS };
