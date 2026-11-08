import { config } from '../config.ts';
import { providerUrl } from '../billing/gateway.ts';
import { payments } from '../billing/notice.ts';
import { unblockConfig } from './config.ts';
import { unblockReadiness } from './readiness.ts';

/**
 * Hosted subscription checkout for Unblock. The enrolment's `checkout_reference` rides along (Stripe `client_reference_id`,
 * Lemon Squeezy custom data) and comes back on the first webhook, which is the only thing tying a provider subscription to an enrolment.
 * Returns '' while checkout is unavailable (the account then says so, never a dead link). A redirect from the checkout proves nothing:
 * only an authoritative provider read in ./billing.ts moves `standing` from `awaiting_payment` to `active`.
 * The price is whatever the provider's product is (UNBLOCK_CHECKOUT_URL, UNBLOCK_PRODUCT_ID); no amount is in code.
 */
export function unblockCheckout(reference: string): string {
  const c = unblockConfig();
  if (unblockReadiness().length) return '';
  try { return payments().checkout(providerUrl(c.checkout, config.billing.provider()), reference); }
  catch { return ''; }
}
