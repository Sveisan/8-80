import type postgres from 'postgres';
import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { BillingUnavailable, providerUrl } from './gateway.ts';
import { obj, str } from './types.ts';

export const weeklyPilotFirstAmount = 18900;
const renewalAmount = 24900;
const getPrice = () => process.env['STRIPE_WEEKLY_PILOT_PRICE_ID'] ?? '';
const getCoupon = () => process.env['STRIPE_WEEKLY_PILOT_COUPON_ID'] ?? '';
const apiKey = () => process.env['STRIPE_SECRET_KEY'] ?? '';

export function pilotCheckoutReady(): boolean {
  return config.billing.provider() === 'stripe' && config.billing.checkoutReady() && /^price_[\w]+$/.test(getPrice()) &&
    /^[\w-]+$/.test(getCoupon());
}

export async function stripePilotCheckout(
  sql: postgres.Sql, phoneHash: string, fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  if (!pilotCheckoutReady()) return undefined;

  const request = async (path: string, body?: URLSearchParams, key?: string) => {
    const response = await fetcher('https://api.stripe.com/v1' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { authorization: 'Bearer ' + apiKey(), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(key ? { 'idempotency-key': key } : {}) },
      ...(body ? { body } : {}),
    });
    if (!response.ok) throw new BillingUnavailable();
    const data = obj(await response.json());
    if (!data) throw new BillingUnavailable();
    return data;
  };

  return await sql.begin(async tx => {
    const [row] = await tx<{ weekly_pilot_checkout: string | null }[]>`
      select weekly_pilot_checkout from callers where phone_hash = ${phoneHash}
        and weekly_offer = 'pilot' and weekly_free_calls_used = 1 and billing_status = 'ended'
        and ls_subscription_id is null and held_for_review = false
      for update`;
    if (!row) return undefined;
    const previous = row.weekly_pilot_checkout;
    if (previous) {
      const session = await request('/checkout/sessions/' + encodeURIComponent(previous));
      if (session['status'] === 'complete') return undefined;
      if (session['status'] === 'open') {
        const url = str(session['url']);
        if (!url) throw new BillingUnavailable();
        return providerUrl(url, 'stripe');
      }
      if (session['status'] !== 'expired') throw new BillingUnavailable();
    }

    const price = await request('/prices/' + encodeURIComponent(getPrice()));
    const recurring = obj(price['recurring']);
    if (price['active'] !== true || price['currency'] !== 'nok' || price['unit_amount'] !== renewalAmount ||
        price['tax_behavior'] !== 'inclusive' || recurring?.['interval'] !== 'month' || recurring['interval_count'] !== 1) throw new BillingUnavailable();

    const home = config.link.publicUrl().replace(/\/$/, '') + '/me';
    const form = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': getPrice(),
      'line_items[0][quantity]': '1',
      'discounts[0][coupon]': getCoupon(),
      'payment_method_types[0]': 'card',
      'automatic_tax[enabled]': 'true',
      'adaptive_pricing[enabled]': 'false',
      client_reference_id: phoneHash,
      success_url: home + '?billing=return',
      cancel_url: home,
    });
    const idempotency = createHash('sha256').update('weekly-pilot:' + phoneHash + ':' + (previous ?? 'initial')).digest('hex');
    const session = await request('/checkout/sessions', form, idempotency);
    const id = str(session['id']);
    const url = str(session['url']);
    if (!id || !url || session['currency'] !== 'nok' || session['amount_total'] !== weeklyPilotFirstAmount) throw new BillingUnavailable();
    const target = providerUrl(url, 'stripe');
    await tx`update callers set weekly_pilot_checkout = ${id} where phone_hash = ${phoneHash}`;
    return target;
  });
}
