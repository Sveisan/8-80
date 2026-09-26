/** What a caller's subscription is doing, in our words rather than a vendor's. */
export type Standing = 'active' | 'past_due' | 'ended';

export interface Change {
  event: string;
  /** The vendor's subscription id, as a string. */
  subscriptionId?: string;
  customerId?: string;
  /** Their raw status, kept so a log says what they actually sent. */
  status?: string;
  standing?: Standing;
  /** Our own key, round-tripped through the checkout. */
  phoneHash?: string;
  /** When a cancelled subscription actually runs out. */
  endsAt?: string;
}

export type Read = { ok: true; change: Change } | { ok: false; why: string; shape: string };
export type Verdict = { ok: true } | { ok: false; why: string };

/**
 * One payments vendor, behind the only four questions we ask of one.
 *
 * Two implementations exist because the vendor changed under us mid-build:
 * Lemon Squeezy was acquired and its successor is Stripe Managed Payments.
 * Everything that decides what happens to a caller — the trial gate, the two
 * letters, cancelled-does-not-stop-the-calls — sits behind this interface and
 * did not move. Only the reading of somebody else's JSON did.
 */
export interface Payments {
  readonly name: string;
  verify(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, secret: string): Verdict;
  read(headers: Record<string, string | string[] | undefined>, payload: unknown): Read;
  /** Where somebody goes to start paying, carrying our key back to us. */
  checkout(base: string, phoneHash: string, email?: string): string;
}

export const pick = (
  headers: Record<string, string | string[] | undefined>,
  names: readonly string[],
): string | undefined => {
  for (const name of names) {
    const v = headers[name];
    const first = Array.isArray(v) ? v[0] : v;
    if (first) return first;
  }
  return undefined;
};

export const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
export const num = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : undefined);
