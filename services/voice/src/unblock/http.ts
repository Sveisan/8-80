import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { displayHash } from '../beliefs/display.ts';

export { readForm } from '../beliefs/http.ts';
/** Page tokens are domain-separated: a Beliefs or base credential never validates an Unblock form. */
export const csrfFor = (token: string): string => createHash('sha256').update(`unblock:csrf:${token}`).digest('hex');
/** Scoped to /unblock, HttpOnly, one hour. An empty token clears it. */
export function unblockCookie(token: string, preview = false): string {
  const secure = !preview && config.link.publicUrl().startsWith('https://') ? '; Secure' : '';
  return `unblock=${token}; Path=/unblock; Max-Age=${token ? 3600 : 0}; HttpOnly; SameSite=Lax${secure}`;
}
export const pageHeaders = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${displayHash}'; form-action 'self' https://buy.stripe.com https://checkout.stripe.com https://*.lemonsqueezy.com; base-uri 'none'; frame-ancestors 'none'`,
};
