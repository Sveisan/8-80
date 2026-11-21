import {acceptConsumerTerms,consumerTerms,withdrawalForm,requestWithdrawal,withdrawalAcknowledgement,type RefundRequest} from './consumer.ts';
import {CONSUMER_TERMS_VERSION,consumerDeadline,consumerCallsAllowed} from './consumer-policy.ts';
import {decrypt} from '../store/crypto.ts';
import { offerCountsValid, offeredCallCount } from './offer.ts';
import type { IncomingMessage } from 'node:http';
import { config, smsConfigured } from '../config.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type { Answer } from '../signup/routes.ts';
import { Pending, TTL_MS } from '../signup/pending.ts';
import { readPhone, EMAIL } from '../signup/form.ts';
import { Limiter } from '../signup/limit.ts';
import { phoneKey } from '../store/postgres.ts';
import { encrypt } from '../store/crypto.ts';
import { Links } from '../link/token.ts';
import { cookieOf, crossSite } from '../link/cookie.ts';
import { AccessCodes } from '../access/codes.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { describeAppointment } from '../schedule/time.ts';
import { deleteAccount } from '../billing/service.ts';
import { composeExport } from '../legal/export.ts';
import { beliefConfig } from '../beliefs/config.ts';
import { PracticeError } from '../beliefs/model.ts';
import { unblockConfig } from './config.ts';
import { unblockReadiness } from './readiness.ts';
import { unblockPage, aboutPage, clock, type NextCall, type PageOptions, type Screen } from './page.ts';
import { csrfFor, unblockCookie, readForm, pageHeaders } from './http.ts';
import { UnblockRepository, callsAllowed, scheduleOf, type Enrollment } from './repository.ts';
import { callsOf, chapterComplete, lightEnabled, parseCalls, slotKind, type Programme } from './model.ts';
import { messages, normaliseSchedule } from './forms.ts';
import { unblockCheckout } from './payment.ts';
import { cancelUnblock, refreshUnblock, unblockPortal } from './billing.ts';
import { formValues, invalidField } from './journey.ts';
import { contactNumber } from '../link/vcard.ts';
import { BillingUnavailable } from '../billing/gateway.ts';
import { NORWAY_SCOPE_VERSION, NORWAY_SIGNUP_PRODUCT, norwayScopeConfirmed } from './scope.ts';

const resendDelay = new Limiter(1, 60_000);
const sends = new Limiter(8, 3600_000); const verifies = new Limiter(30, 600_000);
const SAVED: Record<string, string> = {
  schedule: 'Your usual times are saved.', occurrence: 'This call has moved. Your usual times stay the same.', skip: 'This call is skipped. It will not be made up later.',
  calls: 'Saved. Your chosen calls per month apply from your next chapter.', calls_now: 'Saved. Your calls per month are updated.',
  cancel: 'Your subscription will end at the end of the period you have paid for. Your calls continue until then.',
  pause: 'Your calls are paused. Billing continues while calls are paused.', resume: 'Your calls are resumed. Shared STOP or safety holds still apply.',
  withdraw:'Your withdrawal is recorded. New Unblock calls are stopped; cancellation and repayment will be confirmed separately.',
  scope: 'Your Norway-only launch declaration is recorded. Payment, STOP and review holds still apply.',
};

/** The next conversation and next light evening, as the account shows them. Pure: no claim is made here. */
export function upcoming(e: Enrollment, p: Programme, now: Date): { call?: NextCall; light?: NextCall } {
  const stage = slotKind(p);
  const pointers = [e.opening_at, e.next_weekly_at].filter((d): d is Date => !!d && d > now).sort((a, b) => +a - +b);
  const call = stage && pointers[0] ? { at: pointers[0].toISOString(), text: describeAppointment(pointers[0], e.timezone), kind: 'call' as const,
    label: stage === 'opening' ? 'Opening conversation' : chapterComplete(p) ? 'First call of the next chapter' : p.weeksHeld + 1 >= callsOf(p) ? 'Regular call · your chapter close' : 'Regular call', moveable: true, weekly: stage === 'weekly' && pointers[0] === e.next_weekly_at } : undefined;
  const lit = e.next_light_at && e.next_light_at > now && lightEnabled(p, scheduleOf(e)) ? e.next_light_at : undefined;
  const light = lit ? { at: lit.toISOString(), text: describeAppointment(lit, e.timezone), kind: 'light' as const, label: 'Light call', moveable: false, weekly: false } : undefined;
  return { call, light };
}

export async function unblockRoutes(req: IncomingMessage, url: URL, deps: LoopDeps, client: string, now = new Date()): Promise<Answer | undefined> {
  if (url.pathname !== '/unblock' && !url.pathname.startsWith('/unblock/')) return undefined;
  const c = unblockConfig();
  const ready = unblockReadiness().length === 0;
  const options: PageOptions = { available: ready, price: c.price, support: `mailto:${config.company.supportEmail() || 'hei@8and80.me'}`, supportHours: c.supportHours };
  const page = (screen: Screen, status = 200, note?: string, extra: PageOptions = {}): Answer => ({ status, body: unblockPage(screen, { ...options, ...extra, note: note ?? extra.note }), headers: pageHeaders });
  const redirect = (location: string, cookie?: string): Answer => ({ status: 303, body: '', headers: { ...pageHeaders, location, ...(cookie ? { 'set-cookie': cookie } : {}) } });
  if (req.method === 'POST' && crossSite(req)) return page('landing', 403, 'This request could not be verified.');
  if(req.method==='GET'&&['/unblock/consumer-terms','/unblock/withdrawal-form'].includes(url.pathname))return {status:200,body:url.pathname.endsWith('withdrawal-form')?withdrawalForm():consumerTerms(),headers:{...pageHeaders,'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="unblock-information.txt"'}};
  if (req.method === 'GET' && url.pathname === '/unblock') return page('landing');
  if (req.method === 'GET' && url.pathname === '/unblock/about') return { status: 200, body: aboutPage(options), headers: pageHeaders };
  const accessing = url.pathname === '/unblock/access';
  if (url.pathname === '/unblock/join' || accessing || url.pathname === '/unblock/resend') {
    if (req.method === 'GET') return !accessing && !ready ? page('landing') : page('join', 200, undefined, { access: accessing });
    if (req.method !== 'POST') return page('join', 405);
    let form = await readForm(req);
    const resending = url.pathname === '/unblock/resend';
    const access = accessing || resending && form.get('access') === 'yes';
    if (!access && !ready) return page('landing', 503, 'Paid enrolment is not open yet.');
    const originalChallenge = form.get('challenge') ?? '';
    const phone = readPhone(form.get('phone') ?? '');
    const fail = (status: number, note: string, invalid?: string): Answer => page(resending ? 'verify' : 'join', status, note,
      { access, values: formValues(form), invalid, error: true, challenge: originalChallenge, phone });
    if (!phone) return fail(400, 'Check your phone number.', 'phone');
    if (!sends.take(client, +now)) return fail(429, 'Please wait before requesting another code.');
    if (!smsConfigured()) return fail(503, 'Verification messages are unavailable. Please try later.');
    if (resending) {
      if (!resendDelay.take(phoneKey(phone), +now)) return fail(429, 'Allow a minute before requesting another code. No new code was sent.');
      if (!access) {
        const saved = await new Pending(deps.store.raw).draft(originalChallenge, now, NORWAY_SIGNUP_PRODUCT);
        if (!saved || saved.phone !== phone) return fail(400, 'This signup has expired. Choose Change number to start again.');
        form = new URLSearchParams({ phone: saved.phone, name: saved.name, email: saved.email, consent: 'yes', scope_norway: 'yes' });
      }
    }
    const hash = phoneKey(phone); let messageId: string | undefined;
    let challenge: { id: string; code: string } | undefined;
    if (access) {
      // Same response for known and unknown numbers: a code is only ever queued for an existing account.
      challenge = await new AccessCodes(deps.store.raw).start(hash, now, async (tx, id, code) => {
        const [caller] = await tx`select phone_hash from callers where phone_hash=${hash} for update`;
        if (caller) messageId = await enqueue(tx, { eventKey: `unblock:access:${id}`, phoneHash: hash, channel: 'sms', kind: 'access', reference: id, to: phone, body: `Your 8&80 Unblock code is ${code}. It expires in ${TTL_MS / 60000} minutes. Manage your calls: ${config.link.publicUrl().replace(/\/$/, '')}/unblock/account` }, now);
      });
    } else {
      if (form.get('scope_norway') !== 'yes') return fail(400, 'The initial launch is for adults currently in Norway. Confirm that this applies to you.', 'scope_norway');
      if (form.get('consent') !== 'yes') return fail(400, 'Read the service information and confirm your choice.', 'consent');
      const email = (form.get('email') ?? '').trim();
      if (email && (email.length > 254 || !EMAIL.test(email))) return fail(400, 'Check your email address.', 'email');
      const [recent] = await deps.store.raw`select count(*)::int as count from message_outbox where phone_hash=${hash} and kind='signup' and created_at>${new Date(+now - 3600_000)}`;
      if (Number(recent?.['count']) >= 3) return fail(429, 'Please wait before requesting another code.');
      challenge = await new Pending(deps.store.raw).begin({ phone, email, name: (form.get('name') ?? '').trim().slice(0, 80), weekday: 0, minute: 480, timezone: 'Europe/Oslo' }, now, async (tx, id, code) => {
        messageId = await enqueue(tx, { eventKey: `unblock:signup:${id}`, phoneHash: hash, channel: 'sms', kind: 'signup', reference: id, to: phone, body: `Your 8&80 Unblock code is ${code}. It expires in ${TTL_MS / 60000} minutes. Manage your calls: ${config.link.publicUrl().replace(/\/$/, '')}/unblock/account` }, now);
      }, NORWAY_SIGNUP_PRODUCT);
    }
    if (!challenge) return fail(429, 'Please wait before requesting another code.');
    if (messageId && await dispatchMessage(deps, messageId, now) !== 'accepted') return page('verify', 503, 'Your code has not been confirmed as sent. It may still arrive; wait before requesting another.', { challenge: challenge.id, phone, access, error: true });
    return page('verify', 200, undefined, { challenge: challenge.id, phone, access });
  }
  if (url.pathname === '/unblock/verify') {
    if (req.method !== 'POST') return redirect('/unblock/access');
    if (!verifies.take(client, +now)) return page('join', 429, 'Please wait before trying another code.', { access: true });
    const form = await readForm(req); const id = form.get('challenge') ?? ''; const code = form.get('code') ?? ''; const phone = readPhone(form.get('phone') ?? '');
    let token: string | undefined; const returning = form.get('access') === 'yes';
    if (returning) {
      const hash = await new AccessCodes(deps.store.raw).verify(id, code, now);
      if (hash) token = await deps.store.raw.begin(async tx => {
        const [caller] = await tx`select phone_hash from callers where phone_hash=${hash} for update`;
        return caller ? new Links(tx).mint(hash, now, 'unblock') : undefined;
      });
    } else if (phone && ready) {
      await new Pending(deps.store.raw).verify(phone, code, now, id, async (tx, signup) => {
        const hash = phoneKey(signup.phone);
        await tx`insert into callers(phone_hash,phone_enc,name,email_enc,language) values(${hash},${encrypt(signup.phone)},${signup.name},${signup.email ? encrypt(signup.email) : null},'en') on conflict do nothing`;
        await new UnblockRepository(tx).enroll(hash, now, { name: signup.name, email: signup.email }, true);
        token = await new Links(tx).mint(hash, now, 'unblock');
      }, NORWAY_SIGNUP_PRODUCT);
    }
    if (!token) return page('verify', 400, 'The code is incorrect or expired.', { challenge: id, phone, access: returning, invalid: 'code', error: true });
    return redirect(returning ? '/unblock/account' : '/unblock/schedule', unblockCookie(token));
  }
  const token = cookieOf(req, 'unblock');
  const opened = token ? await new Links(deps.store.raw).open(token, now, 'unblock') : undefined;
  if (!opened?.ok) return redirect('/unblock/access', unblockCookie(''));
  const hash = opened.claims.phoneHash;
  const submitted = req.method === 'POST' ? await readForm(req) : undefined;
  const repo = new UnblockRepository(deps.store.raw);
  const loaded = await repo.load(hash);
  if (!loaded) return page('landing', 200, 'No Unblock enrolment is attached to this account.');
  const { enrollment: e, programme: p } = loaded;
  const [identity] = await deps.store.raw`select held_for_review,all_calls_stopped from callers where phone_hash=${hash}`;
  const held = !!e.withdraw_requested_at || !!(identity?.['held_for_review'] || identity?.['all_calls_stopped']) || !offerCountsValid(e) || !offeredCallCount(callsOf(p));
  const next = upcoming(e, p, now);
  const callsRunning = callsAllowed(e, now, p) && !held && p.state === 'active';
  const scheduled = e.weekly_weekday !== null && e.weekly_minute !== null;
  const live = e.standing === 'active' || e.standing === 'past_due';
  const [withdrawal]=await deps.store.raw<RefundRequest[]>`select * from unblock_refund_requests where enrollment_id=${e.id} and reason='withdrawal' order by requested_at limit 1`;
  const deadline=consumerDeadline(e);
  const privateOptions: PageOptions = { ...options, contact: !!contactNumber(), programme: p, csrf: csrfFor(token!), paid: live, paymentHold: e.standing === 'payment_hold', held,
    consumer:{email:e.contract_email_enc?decrypt(e.contract_email_enc):p.contact?.email??'',accepted:!!e.terms_accepted_at&&!(e.standing==='ended'&&!!e.contract_at),early:!!e.early_start_at,contractAt:e.contract_at?.toISOString(),deadline:deadline?.toISOString(),waiting:!!e.contract_at&&(!e.subscription_id||e.contract_subscription_id===e.subscription_id)&&!consumerCallsAllowed(e,now)&&!e.withdraw_requested_at,evidencePending:live&&(!e.contract_at||!!e.subscription_id&&e.contract_subscription_id!==e.subscription_id)&&!e.withdraw_requested_at,withdrawal:withdrawal?{id:withdrawal.id,status:withdrawal.status,repayBy:withdrawal.repay_by.toISOString(),cancelConfirmed:!!withdrawal.cancel_confirmed_at,guaranteed:withdrawal.guaranteed}:undefined},
    scopeConfirmed: norwayScopeConfirmed(e.norway_scope_version ?? undefined),
    checkout: !!e.withdraw_requested_at || !offerCountsValid(e) || !offeredCallCount(callsOf(p)) || live || e.subscription_id && e.standing !== 'ended' ? '' : unblockCheckout(e.checkout_reference, NORWAY_SCOPE_VERSION), timezone: e.timezone, scheduled, calls: e.pending_calls_per_month ?? e.calls_per_month,
    sub: { standing: e.standing, cancelling: e.cancel_at_period_end, paidUntil: e.paid_until?.toISOString(), callsPerMonth: e.calls_per_month, pendingCalls: e.pending_calls_per_month, manageable: !!e.subscription_id && e.standing !== 'ended', timezone: e.timezone },
    weekly: e.weekly_minute !== null ? clock(e.weekly_minute) : undefined, weekday: e.weekly_weekday ?? undefined,
    lightDays: scheduled ? e.light_weekdays ?? [] : undefined, lightTime: e.light_minute !== null ? clock(e.light_minute) : undefined,
    openingAt: e.opening_at && e.opening_at > now ? e.opening_at.toISOString() : undefined,
    next: callsRunning ? next.call : undefined, nextLight: callsRunning ? next.light : undefined,
    siblingHref: beliefConfig().enabled ? '/beliefs' : undefined };
  if(req.method==='GET'&&url.pathname==='/unblock/contract.txt'&&e.contract_document_enc)return {status:200,body:decrypt(e.contract_document_enc),headers:{...pageHeaders,'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="unblock-contract.txt"'}};
  if(req.method==='GET'&&url.pathname==='/unblock/withdrawal.txt'&&withdrawal)return {status:200,body:withdrawalAcknowledgement(withdrawal),headers:{...pageHeaders,'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="unblock-withdrawal-received.txt"'}};
  const saved = url.searchParams.get('saved'); if (saved) privateOptions.note = SAVED[saved];
  if (req.method === 'GET' && url.searchParams.get('billing') === 'return' && e.subscription_id) {
    // Back from the provider's billing portal: re-read the subscription so a cancellation or card change shows at once.
    try { await refreshUnblock(deps, hash, now); } catch { /* the page still shows the last confirmed state */ }
    return redirect('/unblock/account');
  }
  if (req.method === 'POST') {
    const form = submitted!;
    if (form.get('csrf') !== csrfFor(token!)) return page('account', 403, 'Open your account again before saving.', privateOptions);
    if (url.pathname !== '/unblock/action') return page('account', 404, 'Page not found.', privateOptions);
    try {
      const action = form.get('action');
      if(action==='withdraw'){await requestWithdrawal(deps,hash,now);return redirect('/unblock/account?saved=withdraw');}
      if (action === 'checkout') {
        if (!ready || e.withdraw_requested_at || !offerCountsValid(e) || !offeredCallCount(callsOf(p)) || live || e.subscription_id && e.standing !== 'ended') throw new BillingUnavailable();
        if (form.get('scope_norway') !== 'yes') throw new PracticeError('norway_required');
        const email=(form.get('contract_email')??'').trim();
        if(form.get('accept_terms')!=='yes'||form.get('terms_version')!==CONSUMER_TERMS_VERSION||!EMAIL.test(email)||email!==(form.get('contract_email_confirm')??'').trim())return page('account',400,'Read the terms, confirm your contract email and choose whether to request early calls.',{...privateOptions,consumer:{...privateOptions.consumer!,email},values:form,error:true});
        const checkout = unblockCheckout(e.checkout_reference, NORWAY_SCOPE_VERSION);
        if (!checkout) throw new BillingUnavailable();
        await acceptConsumerTerms(deps.store.raw,hash,email,form.get('early_start')==='yes',now);
        await repo.confirmNorway(hash, now);
        return redirect(checkout);
      }
      if (action === 'scope') {
        if (form.get('scope_norway') !== 'yes') throw new PracticeError('norway_required');
        await repo.confirmNorway(hash, now); return redirect('/unblock/account?saved=scope');
      }
      if (action === 'signout') { await deps.store.raw`delete from links where code=${token!} and purpose='unblock'`; return redirect('/unblock', unblockCookie('')); }
      if (action === 'export') {
        const phone = await deps.store.phoneFor(hash);
        const exported = phone ? await composeExport(deps.store, phone, deps.script, { includeBeliefs: true, includeUnblock: true }) : undefined;
        if (!exported) throw new PracticeError('enrollment_unknown');
        return { status: 200, body: exported.body, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="8and80-data.txt"', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } };
      }
      if (action === 'delete') {
        if (form.get('confirmation') !== 'DELETE') throw new PracticeError('deletion_confirmation_required');
        const phone = await deps.store.phoneFor(hash);
        if (phone) await deleteAccount(deps, phone, hash);
        return redirect('/unblock', unblockCookie(''));
      }
      if (action === 'schedule') {
        await repo.schedule(hash, normaliseSchedule(form), now); return redirect('/unblock/account?saved=schedule');
      }
      if (action === 'occurrence' || action === 'skip') { await repo.occurrence(hash, form, now); return redirect(`/unblock/account?saved=${action}`); }
      if (action === 'calls') { const { applied } = await repo.setCalls(hash, parseCalls(form.get('calls') ?? ''), now); return redirect(`/unblock/account?saved=${applied === 'now' ? 'calls_now' : 'calls'}`); }
      if (action === 'cancel') { await cancelUnblock(deps, hash, now); return redirect('/unblock/account?saved=cancel'); }
      if (action === 'billing') { const portal = await unblockPortal(deps, hash); return { status: 303, body: '', headers: { ...pageHeaders, location: portal } }; }
      if (action === 'pause' || action === 'resume') {
        if(e.withdraw_requested_at)throw new BillingUnavailable();
        await repo.command(hash, { type: action }, form.get('event') ?? '', Number(form.get('revision')), now);
        return redirect(`/unblock/account?saved=${action}`);
      }
      throw new PracticeError('schedule_invalid');
    } catch (error) {
      const scheduling = form.get('action') === 'schedule';
      return page(scheduling ? 'schedule' : 'account', error instanceof PracticeError ? 409 : 503,
        error instanceof PracticeError ? messages[error.code] ?? 'Review your choices before continuing.' : error instanceof BillingUnavailable ? messages['billing_unavailable'] : 'This change could not be confirmed. Please try again later.',
        { ...privateOptions, error: true, ...(scheduling ? { values: formValues(form), invalid: error instanceof PracticeError ? invalidField(error.code) : undefined } : {}) });
    }
  }
  if (req.method !== 'GET') return page('account', 405, undefined, privateOptions);
  const screen = url.pathname.slice('/unblock/'.length);
  if (!['account', 'schedule'].includes(screen)) return page('account', 404, 'Page not found.', privateOptions);
  return page(screen as Screen, 200, undefined, privateOptions);
}
