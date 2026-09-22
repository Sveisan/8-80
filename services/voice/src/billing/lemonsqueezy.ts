import { createHmac, timingSafeEqual } from 'node:crypto';
import { shapeOf } from '../webhook/speechify.ts';

/**
 * Lemon Squeezy's webhook, read defensively.
 *
 * This file was written without access to Lemon Squeezy's documentation — the
 * network this was built on cannot reach it — so everything that could differ
 * from what they actually send is either tried in several forms or recorded
 * for inspection rather than assumed. That is not a stopgap: it is the same
 * shape the Speechify webhook ended up in after five rounds of being wrong
 * about a header name and an envelope, and it cost an evening each time.
 *
 * What is safe to assume: the signature is an HMAC-SHA256 of the raw body in
 * hex, keyed on the secret set alongside the webhook. Every vendor does that
 * one the same way, and getting it wrong fails closed.
 *
 * What is not: the exact header names and the exact set of status strings. So
 * the headers are a list, the statuses are a table with an explicit default,
 * and an unrecognised payload comes back with its shape printed rather than
 * silently treated as nothing having happened.
 */

/** Tried in order. The first one present is used. */
const SIGNATURE_HEADERS = ['x-signature', 'x-lemonsqueezy-signature', 'signature'];
const EVENT_HEADERS = ['x-event-name', 'x-lemonsqueezy-event', 'x-event'];

export type Verdict = { ok: true } | { ok: false; why: string };

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

/** What a caller's subscription is doing, in our words rather than theirs. */
export type Standing = 'active' | 'past_due' | 'ended';

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
  unpaid: 'past_due',
  cancelled: 'active',
  expired: 'ended',
};

export interface Change {
  event: string;
  /** Lemon Squeezy's subscription id, as a string. */
  subscriptionId?: string;
  customerId?: string;
  /** Their raw status, kept so a log says what they actually sent. */
  status?: string;
  standing?: Standing;
  /** Our own key, round-tripped through the checkout's custom data. */
  phoneHash?: string;
  /** When a cancelled subscription actually runs out. */
  endsAt?: string;
}

export function readLemonWebhook(
  headers: Record<string, string | string[] | undefined>,
  payload: unknown,
): { ok: true; change: Change } | { ok: false; why: string; shape: string } {
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

  const change: Change = { event };
  const id = str(data?.['id']) ?? num(data?.['id']);
  if (id) change.subscriptionId = id;
  const customer = str(attrs?.['customer_id']) ?? num(attrs?.['customer_id']);
  if (customer) change.customerId = customer;
  if (status) {
    change.status = status;
    change.standing = STANDING[status] ?? 'past_due';
  }
  const hash = str(custom?.['phone_hash']) ?? str(custom?.['phoneHash']);
  if (hash) change.phoneHash = hash;
  const ends = str(attrs?.['ends_at']) ?? str(attrs?.['renews_at']);
  if (ends) change.endsAt = ends;

  return { ok: true, change };
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : undefined);

function pick(headers: Record<string, string | string[] | undefined>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const v = headers[name];
    const first = Array.isArray(v) ? v[0] : v;
    if (first) return first;
  }
  return undefined;
}

export { SIGNATURE_HEADERS, EVENT_HEADERS, STANDING };
