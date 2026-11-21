import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Database } from '../store/transaction.ts';

const invitations = { 'friend-1': 1, 'friend-2': 1, pilot: 8 } as const;
type Invitation = keyof typeof invitations;
export type WeeklyOffer = 'friend' | 'pilot';
const secret = () => process.env['WEEKLY_PILOT_INVITE_SECRET'] ?? '';
export const pilotIntake = () => process.env['WEEKLY_PILOT_INTAKE'] === '1';
const friendIntake = () => process.env['WEEKLY_FRIEND_INVITES'] === '1';
export const freeCalls = (offer: WeeklyOffer) => offer === 'friend' ? 4 : 1;
export const pilotDays = 30;

export class InvitationUnavailable extends Error {}

function signature(invitation: Invitation): string {
  return createHmac('sha256', secret()).update('weekly-intro:' + invitation).digest('base64url');
}

export function invitationLinks(base: string): Record<Invitation, string> {
  if (!/^https:\/\//.test(base) || secret().length < 32) throw new InvitationUnavailable();
  const link = (key: Invitation) => new URL('/start?invite=' + key + '.' + signature(key), base).href;
  return { 'friend-1': link('friend-1'), 'friend-2': link('friend-2'), pilot: link('pilot') };
}

function invite(token: string | null | undefined) {
  if (secret().length < 32) return undefined;
  const [key, provided, extra] = (token ?? '').split('.');
  if (extra !== undefined || (key !== 'friend-1' && key !== 'friend-2' && key !== 'pilot') ||
      (key === 'pilot' ? !pilotIntake() : !friendIntake()) ||
      !provided || !/^[\w-]{43}$/.test(provided) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(signature(key)))) return undefined;
  return { key, offer: key === 'pilot' ? 'pilot' as const : 'friend' as const, capacity: invitations[key] };
}

export async function availableOffer(sql: Database, token: string | null | undefined): Promise<WeeklyOffer | undefined> {
  const valid = invite(token);
  if (!valid) return undefined;
  const [row] = await sql`select used from weekly_invite_redemptions where invitation = ${valid.key}`;
  return Number(row?.['used'] ?? 0) < valid.capacity ? valid.offer : undefined;
}

/** The reservation and the verified account commit together. The count is
 * anonymous and is deliberately retained if a participant deletes an account. */
export async function redeemOffer(sql: Database, token: string | undefined): Promise<WeeklyOffer> {
  const valid = invite(token);
  if (!valid) throw new InvitationUnavailable();
  const claimed = await sql`
    insert into weekly_invite_redemptions (invitation, used) values (${valid.key}, 1)
    on conflict (invitation) do update set used = weekly_invite_redemptions.used + 1
      where weekly_invite_redemptions.used < ${valid.capacity}
    returning used`;
  if (!claimed.length) throw new InvitationUnavailable();
  return valid.offer;
}

export async function consumeFreeCall(sql: Database, hash: string, attemptId: string): Promise<WeeklyOffer | undefined> {
  const [row] = await sql<{ weekly_offer: WeeklyOffer; billing_status: string }[]>`
    update callers
    set weekly_free_calls_used = weekly_free_calls_used + 1,
      billing_status = case when weekly_offer = 'pilot' or weekly_free_calls_used >= ${freeCalls('friend') - 1} then 'ended' else billing_status end,
      next_call_at = case when weekly_offer = 'pilot' or weekly_free_calls_used >= ${freeCalls('friend') - 1} then null else next_call_at end,
      next_call_cycle = case when weekly_offer = 'pilot' or weekly_free_calls_used >= ${freeCalls('friend') - 1} then null else next_call_cycle end
    where phone_hash = ${hash} and weekly_offer is not null and billing_status in ('trialing', 'ended')
      and weekly_free_calls_used < case weekly_offer when 'friend' then ${freeCalls('friend')}::int else ${freeCalls('pilot')}::int end
      and exists (select 1 from call_attempts a where a.id = ${attemptId} and a.phone_hash = callers.phone_hash
        and a.started_at < callers.trial_ends_at)
    returning weekly_offer, billing_status`;
  return row?.billing_status === 'ended' ? row.weekly_offer : undefined;
}
