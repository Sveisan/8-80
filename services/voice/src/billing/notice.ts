import { config } from '../config.ts';
import type { Recap } from '../recap/compose.ts';
import type { ScriptLines } from '../script.ts';

/**
 * Where somebody goes to keep the calls.
 *
 * The phone hash rides along in the checkout's custom data and comes back on
 * the first webhook, which is the only thing tying a row in Lemon Squeezy's
 * database to a caller in ours. Matching on email would be the alternative and
 * it is not one: people pay with a different address than they signed up with
 * all the time, and a payment that cannot find its caller is a payment taken
 * for calls that never resume.
 */
export function checkoutLink(phoneHash: string, email?: string): string {
  const base = config.billing.checkoutUrl();
  if (!base) return '';
  const url = new URL(base);
  url.searchParams.set('checkout[custom][phone_hash]', phoneHash);
  if (email) url.searchParams.set('checkout[email]', email);
  return url.toString();
}

/**
 * The one email about money.
 *
 * Composed as a `Recap` so it goes out as the same letter on the same headed
 * paper as everything else — a billing email that arrives looking like a
 * different company is how a person learns which part of a product is the
 * product and which part is the business.
 */
export function composeTrialEnded(script: ScriptLines, link: string): Recap | undefined {
  return letterFrom(script, 'email.trial', link);
}

/**
 * The card did not clear.
 *
 * Once, on the day it first fails. The payments vendor runs its own dunning
 * and a second voice chasing the same card is what makes somebody cancel out
 * of irritation rather than intent.
 */
export function composePaymentFailed(script: ScriptLines, link: string): Recap | undefined {
  return letterFrom(script, 'email.payment', link);
}

/**
 * Both money letters, from the same four keys.
 *
 * One shape, so they cannot drift into looking like two companies — and so a
 * third one later is a block in SCRIPT.md rather than another function here.
 */
function letterFrom(script: ScriptLines, prefix: string, link: string): Recap | undefined {
  const line = (key: string): string | undefined => script.get(`${prefix}.${key}`) ?? undefined;
  const subject = line('subject');
  const lead = line('lead');
  if (!subject || !lead) return undefined;

  const parts: Recap['parts'] = [{ role: 'lead', text: lead }];
  const body = line('body');
  if (body && link) parts.push({ role: 'body', text: body });
  const quiet = line('quiet');
  if (quiet) parts.push({ role: 'quiet', text: quiet });
  const signoff = script.get('email.signoff');
  if (signoff) parts.push({ role: 'signoff', text: signoff });

  const label = line('link');
  return {
    subject,
    body: [...parts.map((p) => p.text), link].filter(Boolean).join('\n\n'),
    parts,
    ...(link && label ? { action: { label, url: link } } : {}),
  };
}
