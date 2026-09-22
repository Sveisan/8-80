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
  const line = (key: string): string | undefined => script.get(key) ?? undefined;
  const subject = line('email.trial.subject');
  const lead = line('email.trial.lead');
  if (!subject || !lead) return undefined;

  const parts: Recap['parts'] = [{ role: 'lead', text: lead }];
  const body = line('email.trial.body');
  if (body && link) parts.push({ role: 'body', text: body });
  const quiet = line('email.trial.quiet');
  if (quiet) parts.push({ role: 'quiet', text: quiet });
  const signoff = line('email.signoff');
  if (signoff) parts.push({ role: 'signoff', text: signoff });

  const label = line('email.trial.link');
  return {
    subject,
    body: [...parts.map((p) => p.text), link].filter(Boolean).join('\n\n'),
    parts,
    ...(link && label ? { action: { label, url: link } } : {}),
  };
}
