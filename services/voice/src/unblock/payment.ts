/**
 * PAYMENT SEAM. Unblock moves to a monthly subscription; the subscription work replaces this file's body.
 *
 * Contract the account and preview rely on:
 *  - `unblockCheckout(reference)` returns a provider-owned HTTPS checkout URL for the enrolment's
 *    `checkout_reference`, or '' while checkout is unavailable (the account then says so, never a dead link).
 *  - Only an authoritative provider state may move `unblock_enrollments.standing` from `awaiting_payment`
 *    to `active`. Nothing in the page or route layer does that. The preview simulates it in memory only.
 */
export function unblockCheckout(reference: string): string {
  void reference; // the subscription work builds the checkout URL from this
  return '';
}
