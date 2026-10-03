import { config } from '../config.ts';
import { obj, str, type Change } from './types.ts';
import { readStripeWebhook } from './stripe.ts';
import { readLemonWebhook } from './lemonsqueezy.ts';

export type Provider = 'stripe' | 'lemonsqueezy';
export interface Subscription extends Change { subscriptionId: string; customerId: string; standing: 'active' | 'past_due' | 'ended'; cancelAtPeriodEnd: boolean; provider: Provider; }
export interface BillingGateway {
  subscription(provider: Provider, id: string): Promise<Subscription>;
  cancel(provider: Provider, id: string): Promise<Subscription>;
  portal(provider: Provider, customer: string, subscription: string, returnUrl: string): Promise<string>;
}
export class BillingUnavailable extends Error { constructor() { super('Billing is temporarily unavailable'); } }

/** Only provider-owned HTTPS destinations may receive a customer's browser. */
export function providerUrl(value: string, provider: Provider): string {
  const u = new URL(value);
  const allowed = provider === 'stripe' ? ['buy.stripe.com', 'billing.stripe.com', 'checkout.stripe.com'] : ['lemonsqueezy.com'];
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.some(h => u.hostname === h || (provider === 'lemonsqueezy' && u.hostname.endsWith(`.${h}`)))) throw new BillingUnavailable();
  return u.toString();
}

/** Fetch is injected in tests. Keys are sent only to fixed official API origins. */
export function billingGateway(fetcher: typeof fetch = fetch): BillingGateway {
  async function request(provider: Provider, path: string, method = 'GET', fields?: Record<string, string>): Promise<Record<string, unknown>> {
    const key = provider === 'stripe' ? process.env['STRIPE_SECRET_KEY'] : process.env['LEMONSQUEEZY_API_KEY'];
    if (!key) throw new BillingUnavailable();
    const stripe = provider === 'stripe';
    const response = await fetcher(`${stripe ? 'https://api.stripe.com/v1' : 'https://api.lemonsqueezy.com/v1'}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${key}`, accept: stripe ? 'application/json' : 'application/vnd.api+json', ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(fields ? { body: new URLSearchParams(fields) } : {}),
    });
    // Never log a provider response: it can contain billing addresses and credentials.
    if (!response.ok) throw new BillingUnavailable();
    const data = obj(await response.json());
    if (!data) throw new BillingUnavailable();
    return data;
  }
  function normalise(provider: Provider, value: Record<string, unknown>): Subscription {
    const read = provider === 'stripe'
      ? readStripeWebhook({}, { type: 'customer.subscription.updated', data: { object: value } })
      : readLemonWebhook({}, { meta: { event_name: 'subscription_updated' }, data: value['data'] });
    const supported = provider === 'stripe' ? ['trialing', 'active', 'past_due', 'incomplete', 'unpaid', 'canceled', 'incomplete_expired', 'paused'] : ['active', 'on_trial', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'];
    if (!read.ok || !supported.includes(read.change.status ?? '') || !read.change.subscriptionId || !read.change.customerId || !read.change.standing) throw new BillingUnavailable();
    if (read.change.cancelAtPeriodEnd && read.change.standing !== 'ended' && (!read.change.endsAt || !Number.isFinite(Date.parse(read.change.endsAt)))) throw new BillingUnavailable();
    return { ...read.change, provider, subscriptionId: read.change.subscriptionId, customerId: read.change.customerId, standing: read.change.standing, cancelAtPeriodEnd: read.change.cancelAtPeriodEnd ?? false };
  }
  return {
    async subscription(provider, id) { const sub = normalise(provider, await request(provider, `/subscriptions/${encodeURIComponent(id)}`)); if (sub.subscriptionId !== id) throw new BillingUnavailable(); return sub; },
    async cancel(provider, id) {
      const current = await this.subscription(provider, id);
      if (current.standing === 'ended' || current.cancelAtPeriodEnd) return current;
      const value = await request(provider, `/subscriptions/${encodeURIComponent(id)}`, provider === 'stripe' ? 'POST' : 'DELETE', provider === 'stripe' ? { cancel_at_period_end: 'true' } : undefined);
      const result = normalise(provider, value);
      if (result.subscriptionId !== id || (!result.cancelAtPeriodEnd && result.standing !== 'ended')) throw new BillingUnavailable();
      return result;
    },
    async portal(provider, customer, subscription, returnUrl) {
      if (provider === 'stripe') {
        const value = await request(provider, '/billing_portal/sessions', 'POST', { customer, return_url: returnUrl });
        return providerUrl(str(value['url']) ?? '', provider);
      }
      const value = await request(provider, `/subscriptions/${encodeURIComponent(subscription)}`);
      const attrs = obj(obj(value['data'])?.['attributes']);
      if (String(attrs?.['customer_id']) !== customer) throw new BillingUnavailable();
      return providerUrl(str(obj(attrs?.['urls'])?.['customer_portal']) ?? '', provider);
    },
  };
}

export function providerFor(stored: string | null): Provider {
  if (stored === 'stripe' || stored === 'lemonsqueezy') return stored;
  return config.billing.provider();
}
