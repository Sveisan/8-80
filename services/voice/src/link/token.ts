import { createHmac, timingSafeEqual } from 'node:crypto';

/** A week, so the link outlives the missed call it was sent about. */
const TTL_MS = 7 * 24 * 3600_000;

export interface LinkClaims {
  /** Never the number itself: a URL ends up in message threads and logs. */
  phoneHash: string;
  /** Exactly one thing this token may do. */
  purpose: 'reschedule';
  expiresAt: number;
}

export type Opened = { ok: true; claims: LinkClaims } | { ok: false; why: string };

/**
 * A link somebody can act on without logging in.
 *
 * There is no account to log into and there should not be one for this: asking
 * somebody to remember a password in order to move a phone call is how a small
 * courtesy becomes a chore they do not bother with.
 *
 * So the safety comes from what the token can do rather than from who holds it.
 * It carries a hash, not a number. It may only move a call. It cannot read the
 * commitment, cancel the account, or change an email address, and the page it
 * opens shows nothing a stranger could use. Worst case, somebody who finds the
 * link in a shared message thread moves a call — which the caller sees at once,
 * and which the next call would put right anyway.
 */
export function mintLink(phoneHash: string, secret: string, now = new Date()): string {
  const claims: LinkClaims = { phoneHash, purpose: 'reschedule', expiresAt: now.getTime() + TTL_MS };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function openLink(token: string, secret: string, now = new Date()): Opened {
  const [payload, given] = token.split('.');
  if (!payload || !given) return { ok: false, why: 'malformed' };

  const expected = sign(payload, secret);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length first: timingSafeEqual throws on a mismatch, and a throw is a timing
  // signal of its own.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, why: 'bad signature' };

  let claims: LinkClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LinkClaims;
  } catch {
    return { ok: false, why: 'unreadable' };
  }

  if (claims.purpose !== 'reschedule') return { ok: false, why: 'wrong purpose' };
  if (!claims.phoneHash) return { ok: false, why: 'no subject' };
  if (claims.expiresAt < now.getTime()) return { ok: false, why: 'expired' };

  return { ok: true, claims };
}

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');
