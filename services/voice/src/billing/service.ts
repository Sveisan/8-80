import { milestone } from '../journey/measure.ts';
import { randomUUID } from 'node:crypto';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { billingHome, composePaymentFailed } from './notice.ts';
import { accountState } from '../link/account.ts';
import type postgres from 'postgres';
import type { LoopDeps } from '../loop/deps.ts';
import { nextSlotAfter } from '../schedule/time.ts';
import { billingGateway, providerFor, BillingUnavailable, type Subscription } from './gateway.ts';
import type { Change } from './types.ts';
import { config } from '../config.ts';

type Row = { phone_hash: string; ls_subscription_id: string | null; ls_customer_id: string | null; billing_provider: string | null; billing_status: string; cancel_at_period_end: boolean; paid_until: Date | null; paused: boolean; next_call_at: Date | null; slot_weekday: number | null; slot_minute: number | null; timezone: string | null };
export const gatewayFor = (deps: LoopDeps) => deps.billing ?? billingGateway();

async function write(tx: postgres.TransactionSql, row: Row, sub: Subscription, now = new Date()): Promise<void> {
  if (row.ls_subscription_id === sub.subscriptionId && row.ls_customer_id && row.ls_customer_id !== sub.customerId) throw new BillingUnavailable();
  let next = row.next_call_at;
  if (sub.standing !== 'ended' && (!next || next <= now) && row.slot_weekday !== null && row.slot_minute !== null && row.timezone) {
    next = nextSlotAfter(now, { weekday: row.slot_weekday, minute: row.slot_minute, timezone: row.timezone });
  }
  await tx`update callers set billing_status = ${sub.standing}, billing_provider = ${sub.provider},
    ls_subscription_id = ${sub.subscriptionId}, ls_customer_id = ${sub.customerId},
    cancel_at_period_end = ${sub.cancelAtPeriodEnd}, paid_until = ${sub.endsAt ? new Date(sub.endsAt) : null},
    next_call_at = ${next},
    next_call_cycle = case when ${next?.getTime() !== row.next_call_at?.getTime()} then null else next_call_cycle end, updated_at = now() where phone_hash = ${row.phone_hash}`;
}

/** Read current provider state under the caller lock: delayed events cannot replay old payment status. */
export async function syncBilling(deps: LoopDeps, change: Change): Promise<{ matched: boolean; from?: string; phoneHash?: string; standing?: string; changed?: boolean; noticeId?: string }> {
  if (!change.subscriptionId) return { matched: false };
  const result = await deps.store.raw.begin(async tx => {
    const [row] = await tx<Row[]>`select * from callers where
      (${change.phoneHash ?? null}::text is not null and phone_hash = ${change.phoneHash ?? null}) or
      (${change.phoneHash ?? null}::text is null and ls_subscription_id = ${change.subscriptionId!}) for update`;
    if (!row) return { matched: false };
    const provider = change.provider ?? config.billing.provider();
    if (row.billing_provider && row.billing_provider !== provider) throw new BillingUnavailable();
    // A different purchase must be reconciled, never silently replace a live subscription.
    if (row.ls_subscription_id && row.ls_subscription_id !== change.subscriptionId && row.billing_status !== 'ended') throw new BillingUnavailable();
    const sub = await gatewayFor(deps).subscription(provider, change.subscriptionId!);
    if (sub.subscriptionId !== change.subscriptionId || (change.customerId && sub.customerId !== change.customerId)) throw new BillingUnavailable();
    const changed = row.billing_status !== sub.standing || row.cancel_at_period_end !== sub.cancelAtPeriodEnd || row.ls_subscription_id !== sub.subscriptionId;
    await write(tx, row, sub);
    if (sub.standing === 'active') await milestone(tx, row.phone_hash, 'paid', `${sub.provider}:${sub.subscriptionId}`);
    const noticeId = changed ? await billingNotice(tx, deps, row.phone_hash, sub) : undefined;
    return { matched: true, from: row.billing_status, phoneHash: row.phone_hash, standing: sub.standing, changed, noticeId };
  });
  if (result.noticeId) await dispatchMessage(deps, result.noticeId);
  return result;
}

export async function cancelRenewal(deps: LoopDeps, hash: string): Promise<'cancelled' | 'none'> {
  let noticeId: string | undefined;
  const result = await deps.store.raw.begin(async tx => {
    const [row] = await tx<Row[]>`select * from callers where phone_hash = ${hash} for update`;
    if (!row?.ls_subscription_id) return 'none' as const;
    const sub = await gatewayFor(deps).cancel(providerFor(row.billing_provider), row.ls_subscription_id);
    if (sub.subscriptionId !== row.ls_subscription_id || (!sub.cancelAtPeriodEnd && sub.standing !== 'ended')) throw new BillingUnavailable();
    await write(tx, row, sub);
    if (row.cancel_at_period_end !== sub.cancelAtPeriodEnd || row.billing_status !== sub.standing) noticeId = await billingNotice(tx, deps, hash, sub);
    return 'cancelled' as const;
  });
  if (noticeId) await dispatchMessage(deps, noticeId);
  return result;
}

/** Billing must acknowledge non-renewal before the identifiers needed to cancel can be erased. */
export async function deleteAccount(deps: LoopDeps, phone: string, hash: string): Promise<boolean> {
  // The request to leave stops future calls even when the provider is down.
  // Keep this outside the erasure transaction so a failed cancellation cannot undo it.
  await deps.store.raw`update callers set paused = true, updated_at = now() where phone_hash = ${hash}`;
  return await deps.store.raw.begin(async tx => {
    const [row] = await tx<Row[]>`select * from callers where phone_hash = ${hash} for update`;
    if (!row) return false;
    if (row.ls_subscription_id) {
      const sub = await gatewayFor(deps).cancel(providerFor(row.billing_provider), row.ls_subscription_id);
      if (sub.subscriptionId !== row.ls_subscription_id || sub.customerId !== row.ls_customer_id || (!sub.cancelAtPeriodEnd && sub.standing !== 'ended')) throw new BillingUnavailable();
    }
    return deps.store.forget(phone, tx);
  });
}

export async function customerPortal(deps: LoopDeps, hash: string): Promise<string> {
  return await deps.store.raw.begin(async tx => {
    const [row] = await tx<Row[]>`select * from callers where phone_hash = ${hash} for update`;
    if (!row?.ls_subscription_id || !row.ls_customer_id) throw new BillingUnavailable();
    const base = config.link.publicUrl().replace(/\/$/, '');
    if (!base.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new BillingUnavailable();
    return gatewayFor(deps).portal(providerFor(row.billing_provider), row.ls_customer_id, row.ls_subscription_id, `${base}/me?billing=return`);
  });
}


async function billingNotice(tx: postgres.TransactionSql, deps: LoopDeps, hash: string, sub: Subscription): Promise<string> {
  const store = deps.store.in(tx);
  const phone = (await store.phoneFor(hash))!;
  const caller = await store.load(phone);
  const state = (await accountState(store.raw, hash))!;
  const key = state.billing === 'ended' ? 'email.billing.ended' : state.cancelAtPeriodEnd ? 'email.billing.cancelled' : 'email.billing.active';
  const parts = [{ role: 'lead' as const, text: deps.script.get(key) ?? '' }];
  parts.push({ role: 'lead', text: deps.script.get('email.billing.paused') ?? '' });
  const body = sub.standing === 'past_due' ? composePaymentFailed(deps.script, billingHome()) : {
    subject: deps.script.get('email.billing.subject') ?? '', parts,
    body: [...parts.map(p => p.text), billingHome()].filter(Boolean).join('\n\n'),
    ...(billingHome() ? { action: { label: deps.script.get('email.controls') ?? '', url: billingHome() } } : {}),
  };
  if (!body) throw new Error('Missing billing notice template');
  const id = await enqueue(tx, { eventKey: `billing:${randomUUID()}`, phoneHash: hash, channel: 'email', kind: 'billing',
    reference: `${sub.standing}:${sub.cancelAtPeriodEnd}`, to: caller.email ?? '', body });
  if (!caller.email) await tx`update message_outbox set status = 'failed', reason = 'missing_address' where id = ${id}`;
  return id;
}
