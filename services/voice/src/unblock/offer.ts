/** Owner-approved launch package, 20 November 2026. Historical chapter content is not rewritten. */
export const OFFER_MAX_REGULAR_CALLS = 4;
export const offeredCallCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= OFFER_MAX_REGULAR_CALLS;
export const offerCountsValid = (e: { calls_per_month: number; pending_calls_per_month: number | null }): boolean =>
  offeredCallCount(e.calls_per_month) && (e.pending_calls_per_month === null || offeredCallCount(e.pending_calls_per_month));

/** Presentation of the owner-approved gross price; this does not classify or calculate VAT. */
export function taxInclusivePrice(label: string): string {
  const price = label.trim().replace(/\.$/, '');
  return !price || /including applicable VAT$/i.test(price) ? price : `${price}, including applicable VAT`;
}
