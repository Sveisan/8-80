import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { config } from '../config.ts';
import { BillingUnavailable, providerFor, type Provider, type Subscription } from '../billing/gateway.ts';
import { gatewayFor } from '../billing/service.ts';
import { payments } from '../billing/notice.ts';
import type { Change } from '../billing/types.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { dispatchMessage, enqueue } from '../messages/outbox.ts';
import { unblockConfig } from './config.ts';
import { UnblockRepository, type Enrollment } from './repository.ts';
import type { Programme } from './model.ts';
import { decrypt } from '../store/crypto.ts';

/**
 * Unblock's own monthly subscription, separate from the weekly 8&80 one. It reuses the weekly provider code (signature check, gateway reads,
 * cancellation, portal) and the same webhook endpoint; events are recognised by the Unblock checkout reference or by a stored Unblock subscription id.
 * Nothing here trusts a webhook body for access: the subscription is always re-read from the provider under the caller lock.
 */
type Standing = 'awaiting_payment' | 'active' | 'past_due' | 'ended';
const REF = 'unblock:';

export function standingFor(was: string, sub: Pick<Subscription, 'standing'>): Standing {
  if (sub.standing === 'active') return 'active';
  // A first payment that never completed is not entitlement; a card that fails later keeps calling while the provider retries (as the weekly product does).
  if (sub.standing === 'past_due') return was === 'awaiting_payment' || was === 'ended' ? was : 'past_due';
  return was === 'awaiting_payment' ? 'awaiting_payment' : 'ended';
}

/** Call only after the existing payment signature verifier accepts the raw body. Returns undefined when the event is not Unblock's. */
export async function syncUnblockSubscription(deps: LoopDeps, payload: unknown, headers: Record<string, string | string[] | undefined>, now = new Date()): Promise<boolean | undefined> {
  const read = payments().read(headers, payload);
  if (!read.ok) return undefined;
  const change = read.change;
  const ref = change.phoneHash?.startsWith(REF) ? change.phoneHash : undefined;
  const matches = await deps.store.raw<Enrollment[]>`select * from unblock_enrollments where
    (${ref ?? null}::text is not null and checkout_reference = ${ref ?? null}) or (${change.subscriptionId ?? null}::text is not null and subscription_id = ${change.subscriptionId ?? null})`;
  if (new Set(matches.map(m => m.id)).size > 1) throw new BillingUnavailable();
  if (!matches[0]) return ref ? false : undefined;
  if (!change.subscriptionId) return false;
  return applySubscription(deps, matches[0].id, change, now);
}

/** Re-read the subscription from the provider and bring the enrolment in line with it. */
export async function applySubscription(deps: LoopDeps, enrollmentId: string, change: Change, now = new Date()): Promise<boolean> {
  const provider: Provider = change.provider ?? config.billing.provider();
  const c = unblockConfig();
  if (!c.productId) throw new BillingUnavailable();
  const sub = await gatewayFor(deps).subscription(provider, change.subscriptionId!);
  if (sub.subscriptionId !== change.subscriptionId || (change.customerId && sub.customerId !== change.customerId)) throw new BillingUnavailable();
  // Only this product's subscription may grant Unblock calls; the weekly product or any other price cannot.
  if (!sub.productIds?.includes(c.productId)) throw new BillingUnavailable();
  let noticeId: string | undefined;
  await deps.store.raw.begin(async tx => {
    const [identity] = await tx`select phone_hash from callers where phone_hash = (select phone_hash from unblock_enrollments where id = ${enrollmentId}) for update`;
    const [row] = await tx<Enrollment[]>`select * from unblock_enrollments where id = ${enrollmentId} for update`;
    if (!identity || !row || (row.provider && row.provider !== provider)) throw new BillingUnavailable();
    // A different subscription must be reconciled, never silently replace a live one.
    if (row.subscription_id && row.subscription_id !== sub.subscriptionId && row.standing !== 'ended') throw new BillingUnavailable();
    if (row.subscription_id === sub.subscriptionId && row.customer_id && row.customer_id !== sub.customerId) throw new BillingUnavailable();
    const standing = standingFor(row.standing, sub);
    const programme = JSON.parse(decrypt(row.programme_enc)) as Programme;
    const paidUntil = sub.endsAt ? new Date(sub.endsAt) : null;
    const paidFlag = standing === 'active' && row.standing !== 'active';
    await tx`update unblock_enrollments set standing = ${standing}, provider = ${provider}, subscription_id = ${sub.subscriptionId}, customer_id = ${sub.customerId}, product_id = ${c.productId},
      cancel_at_period_end = ${sub.cancelAtPeriodEnd}, paid_until = ${paidUntil}, paid_at = case when ${paidFlag} then coalesce(paid_at, ${now}) else paid_at end, updated_at = ${now} where id = ${row.id}`;
    const [current] = await tx<Enrollment[]>`select * from unblock_enrollments where id = ${row.id}`;
    if (standing === 'active' && (row.standing === 'awaiting_payment' || row.standing === 'ended')) {
      await UnblockRepository.activate(tx, current!, programme, now);
      noticeId = await confirmation(tx, deps, current!.phone_hash, provider, sub.subscriptionId, now);
    } else if (standing === 'ended' && row.standing !== 'ended') await UnblockRepository.end(tx, current!, programme, now);
    else if ((standing === 'active' || standing === 'past_due') && (row.cancel_at_period_end !== sub.cancelAtPeriodEnd || +(row.paid_until ?? 0) !== +(paidUntil ?? 0))) await UnblockRepository.replan(tx, current!, programme, now);
  });
  if (noticeId) await dispatchMessage(deps, noticeId);
  return true;
}

async function confirmation(tx: postgres.TransactionSql, deps: LoopDeps, hash: string, provider: string, subscriptionId: string, now: Date): Promise<string | undefined> {
  const phone = await deps.store.in(tx).phoneFor(hash); const base = config.link.publicUrl().replace(/\/$/, '');
  if (!phone || !base) return undefined;
  return enqueue(tx, { eventKey: `unblock:subscription:${provider}:${subscriptionId}:${randomUUID()}`, phoneHash: hash, channel: 'sms', kind: 'unblock', to: phone,
    body: `Your 8&80 Unblock subscription is confirmed. Choose or check your call times: ${base}/unblock/access` }, now);
}

/** Refresh after the caller returns from the provider's billing portal, where they may have cancelled, resumed or changed their card. */
export async function refreshUnblock(deps: LoopDeps, hash: string, now = new Date()): Promise<void> {
  const [row] = await deps.store.raw<Enrollment[]>`select * from unblock_enrollments where phone_hash = ${hash} and is_current`;
  if (!row?.subscription_id) return;
  await applySubscription(deps, row.id, { event: 'account.return', provider: providerFor(row.provider), subscriptionId: row.subscription_id, ...(row.customer_id ? { customerId: row.customer_id } : {}) }, now);
}

/** Cancel at the end of the paid period: calls continue until then. */
export async function cancelUnblock(deps: LoopDeps, hash: string, now = new Date()): Promise<'cancelled' | 'none'> {
  return deps.store.raw.begin(async tx => {
    await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
    const [row] = await tx<Enrollment[]>`select * from unblock_enrollments where phone_hash = ${hash} and is_current for update`;
    if (!row?.subscription_id) return 'none' as const;
    const sub = await gatewayFor(deps).cancel(providerFor(row.provider), row.subscription_id);
    if (sub.subscriptionId !== row.subscription_id || sub.customerId !== row.customer_id || (!sub.cancelAtPeriodEnd && sub.standing !== 'ended')) throw new BillingUnavailable();
    const programme = JSON.parse(decrypt(row.programme_enc)) as Programme;
    const standing = standingFor(row.standing, sub); const paidUntil = sub.endsAt ? new Date(sub.endsAt) : null;
    await tx`update unblock_enrollments set standing = ${standing}, cancel_at_period_end = ${sub.cancelAtPeriodEnd}, paid_until = ${paidUntil}, updated_at = ${now} where id = ${row.id}`;
    const [current] = await tx<Enrollment[]>`select * from unblock_enrollments where id = ${row.id}`;
    if (standing === 'ended') await UnblockRepository.end(tx, current!, programme, now); else await UnblockRepository.replan(tx, current!, programme, now);
    return 'cancelled' as const;
  });
}

/** The provider's own billing portal for this subscription (card, invoices, cancellation). */
export async function unblockPortal(deps: LoopDeps, hash: string): Promise<string> {
  return deps.store.raw.begin(async tx => {
    await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
    const [row] = await tx<Enrollment[]>`select * from unblock_enrollments where phone_hash = ${hash} and is_current for update`;
    if (!row?.subscription_id || !row.customer_id) throw new BillingUnavailable();
    const base = config.link.publicUrl().replace(/\/$/, '');
    if (!base.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new BillingUnavailable();
    return gatewayFor(deps).portal(providerFor(row.provider), row.customer_id, row.subscription_id, `${base}/unblock/account?billing=return`);
  });
}
