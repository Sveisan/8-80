import { config } from '../config.ts';
import { BillingUnavailable, providerUrl, type Provider } from '../billing/gateway.ts';
import { payments } from '../billing/notice.ts';
import { obj, str } from '../billing/types.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { enqueue } from '../messages/outbox.ts';
import { beliefConfig } from './config.ts';
import type { Enrollment } from './repository.ts';

export function beliefCheckout(hash: string): string {
  const c = beliefConfig();
  if (!c.enabled || !c.price || !c.productId || !c.basePriceId || !c.checkout || !c.safetyReady || !c.priceApproved) return '';
  try { return payments().checkout(providerUrl(c.checkout, config.billing.provider()), `beliefs:${hash}`); }
  catch { return ''; }
}
const idOf = (v: unknown): string | undefined => str(v) ?? str(obj(v)?.['id']);
const identity = (v: unknown): string | undefined => typeof v === 'number' ? String(v) : str(v);
export interface Purchase { id: string; paymentId?: string; customerId?: string; productId: string; amount: number; currency: string; paid: boolean; reference?: string; }
/** Authoritative provider reads; a checkout redirect is never proof of payment. */
export async function readPurchase(provider: Provider, id: string, fetcher: typeof fetch = fetch): Promise<Purchase> {
  const c = beliefConfig();
  const key = process.env[provider === 'stripe' ? 'STRIPE_SECRET_KEY' : 'LEMONSQUEEZY_API_KEY'];
  if (!key || !c.basePriceId || !c.productId || c.basePriceId === c.productId) throw new BillingUnavailable();
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const response = await fetcher(`${provider === 'stripe' ? 'https://api.stripe.com/v1' : 'https://api.lemonsqueezy.com/v1'}${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${key}`, accept: provider === 'stripe' ? 'application/json' : 'application/vnd.api+json' },
    });
    if (!response.ok) throw new BillingUnavailable();
    const result = obj(await response.json());
    if (!result) throw new BillingUnavailable();
    return result;
  };
  if (provider === 'stripe') {
    const session = await get(`/checkout/sessions/${encodeURIComponent(id)}?expand[]=line_items.data.price&expand[]=payment_intent.latest_charge`);
    const lines = obj(session['line_items']); const data = lines?.['data'];
    if (session['id'] !== id || session['mode'] !== 'payment' || session['subscription'] || lines?.['has_more'] || !Array.isArray(data) || data.length !== 1) throw new BillingUnavailable();
    const item = obj(data[0]); const price = obj(item?.['price']);
    const base = await get(`/prices/${encodeURIComponent(c.basePriceId)}`); const recurring = obj(base['recurring']);
    if (item?.['quantity'] !== 1 || price?.['id'] !== c.productId || price?.['recurring'] || recurring?.['interval'] !== 'month' || recurring?.['interval_count'] !== 1 ||
      !Number.isInteger(base['unit_amount']) || Number(base['unit_amount']) <= 0 || price?.['unit_amount'] !== base['unit_amount'] || price?.['currency'] !== base['currency'] || session['amount_subtotal'] !== base['unit_amount'] ||
      session['currency'] !== base['currency'] || Number(obj(session['total_details'])?.['amount_discount'] ?? 0) !== 0) throw new BillingUnavailable();
    const intent = obj(session['payment_intent']); const charge = obj(intent?.['latest_charge']);
    return { id, productId: c.productId, amount: Number(base['unit_amount']), currency: String(base['currency']), reference: str(session['client_reference_id']),
      paymentId: idOf(session['payment_intent']), customerId: idOf(session['customer']),
      paid: session['payment_status'] === 'paid' && intent?.['status'] === 'succeeded' && !!charge && charge['paid'] === true && !charge['refunded'] && !charge['disputed'] && Number(charge['amount_refunded'] ?? 0) === 0 };
  }
  const order = obj((await get(`/orders/${encodeURIComponent(id)}?include=order-items`))['data']);
  const a = obj(order?.['attributes']); const item = obj(a?.['first_order_item']);
  const variant = obj(obj((await get(`/variants/${encodeURIComponent(c.productId)}`))['data'])?.['attributes']);
  const base = obj(obj((await get(`/variants/${encodeURIComponent(c.basePriceId)}`))['data'])?.['attributes']);
  const store = obj(obj((await get(`/stores/${encodeURIComponent(String(a?.['store_id']))}`))['data'])?.['attributes']);
  const items = obj(obj(order?.['relationships'])?.['order-items'])?.['data'];
  if (String(order?.['id']) !== id || !Array.isArray(items) || items.length !== 1 || identity(item?.['variant_id']) !== c.productId || variant?.['is_subscription'] !== false || base?.['is_subscription'] !== true ||
    base?.['interval'] !== 'month' || base?.['interval_count'] !== 1 || !Number.isInteger(base?.['price']) || Number(base?.['price']) <= 0 || variant?.['price'] !== base?.['price'] || item?.['price'] !== base?.['price'] ||
    a?.['subtotal'] !== base?.['price'] || String(a?.['currency']).toLowerCase() !== String(store?.['currency']).toLowerCase() || Number(a?.['discount_total'] ?? 0) !== 0 || Number(a?.['setup_fee'] ?? 0) !== 0) throw new BillingUnavailable();
  return { id, productId: c.productId, amount: Number(base?.['price']), currency: String(a?.['currency']).toLowerCase(), customerId: identity(a?.['customer_id']),
    paid: a?.['status'] === 'paid' && !a?.['refunded'] && Number(a?.['refunded_amount'] ?? 0) === 0 };
}

/** Call only after the existing payment signature verifier accepts the raw body. */
export async function syncBeliefPurchase(deps: LoopDeps, payload: unknown, headers: Record<string,string|string[]|undefined>, fetcher: typeof fetch = fetch): Promise<boolean | undefined> {
  const provider = config.billing.provider(); const p = obj(payload); const object = obj(obj(p?.['data'])?.['object']);
  const meta = obj(p?.['meta']); const data = obj(p?.['data']); const custom = obj(meta?.['custom_data']);
  const event = provider === 'stripe' ? str(p?.['type']) : str(meta?.['event_name']) ?? str(headers['x-event-name']);
  const reference = provider === 'stripe' ? str(object?.['client_reference_id']) : str(custom?.['phone_hash']);
  const hash = reference?.startsWith('beliefs:') ? reference.slice(8) : undefined;
  let purchaseId = provider === 'stripe' && object?.['object'] === 'checkout.session' ? str(object['id']) : provider === 'lemonsqueezy' && data?.['type'] === 'orders' ? identity(data['id']) : undefined;
  const paymentId = provider === 'stripe' && ['charge.refunded','charge.dispute.created','charge.dispute.closed'].includes(event ?? '') ? idOf(object?.['payment_intent']) : undefined;
  const [found] = await deps.store.raw<Enrollment[]>`select * from belief_enrollments where
    (${hash ?? null}::text is not null and phone_hash = ${hash ?? null}) or
    (${hash ?? null}::text is null and provider = ${provider} and (purchase_id = ${purchaseId ?? null} or payment_id = ${paymentId ?? null}))`;
  if (!found) return hash ? false : undefined;
  purchaseId ??= found.purchase_id ?? undefined;
  const allowed = provider === 'stripe' ? ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','charge.refunded','charge.dispute.created','charge.dispute.closed'] : ['order_created','order_refunded'];
  if (!purchaseId || !allowed.includes(event ?? '')) return false;
  const purchase = await readPurchase(provider, purchaseId, fetcher);
  if ((provider === 'stripe' && purchase.reference !== `beliefs:${found.phone_hash}`) || (hash && hash !== found.phone_hash)) throw new BillingUnavailable();
  await deps.store.raw.begin(async tx => {
    const [caller] = await tx`select phone_hash from callers where phone_hash = ${found.phone_hash} for update`;
    const [row] = await tx<Enrollment[]>`select * from belief_enrollments where phone_hash = ${found.phone_hash} for update`;
    if (!caller || !row || (row.provider && row.provider !== provider) || (row.purchase_id && row.purchase_id !== purchase.id)) throw new BillingUnavailable();
    const standing = purchase.paid ? 'active' : 'payment_hold';
    await tx`update belief_enrollments set standing = ${standing}, provider = ${provider}, purchase_id = ${purchase.id}, payment_id = ${purchase.paymentId ?? null},
      customer_id = ${purchase.customerId ?? null}, paid_at = case when ${purchase.paid} then coalesce(paid_at, now()) else paid_at end,
      amount_minor = ${purchase.amount}, currency = ${purchase.currency}, updated_at = now() where phone_hash = ${row.phone_hash}`;
    if (purchase.paid && row.standing !== 'active') {
      const phone = await deps.store.in(tx).phoneFor(row.phone_hash); const base = config.link.publicUrl().replace(/\/$/, '');
      if (phone && base) await enqueue(tx, { eventKey: `beliefs:purchase:${provider}:${purchase.id}`, phoneHash: row.phone_hash, channel: 'sms', kind: 'beliefs', to: phone,
        body: `Your 8&80 Beliefs purchase is confirmed. One payment, no renewal. Choose or check your call times: ${base}/beliefs/access` });
    }
  });
  return true;
}
