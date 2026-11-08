import { randomUUID } from 'node:crypto';
import { MARK } from '../link/page.ts';
import { localDisplayScript } from '../beliefs/display.ts';
import { back, css, escape, field, hidden, journeyCss, link, localValue } from '../beliefs/page.ts';
import { DEFAULT_CALLS, DEFAULT_LIGHT_DAYS, DEFAULT_LIGHT_MINUTE, MAX_CALLS, MIN_CALLS, callsOf, currentWish, monthOf, type Programme } from './model.ts';
import { chapterOfMonth, chapterPos } from './chapters.ts';
import { LIGHT_DAY_ORDER, WEEKDAYS } from './forms.ts';

export interface SubscriptionView {
  /** awaiting_payment | active | past_due | ended | payment_hold */
  standing: string; cancelling: boolean; paidUntil?: string; callsPerMonth: number; pendingCalls?: number | null;
  /** A provider subscription exists, so cancellation and the billing portal can be offered. */
  manageable: boolean; timezone?: string;
}
export type Screen = 'landing' | 'join' | 'verify' | 'schedule' | 'account';
export interface NextCall { at: string; text: string; label: string; kind: 'call' | 'light'; moveable: boolean; weekly: boolean; }
export interface PageOptions {
  preview?: boolean; available?: boolean; price?: string; note?: string; csrf?: string; programme?: Programme; revision?: number;
  challenge?: string; phone?: string; access?: boolean; checkout?: string; paid?: boolean; paymentHold?: boolean; held?: boolean;
  timezone?: string; weekly?: string; weekday?: number; lightDays?: number[]; lightTime?: string; scheduled?: boolean; openingAt?: string;
  next?: NextCall; nextLight?: NextCall; support?: string; supportHours?: string;
  /** Calls per month the schedule step shows (the caller's current choice). */
  calls?: number;
  /** The subscription as the account shows it. Present once a subscription is relevant (checkout started, active, ended). */
  sub?: SubscriptionView;
  /** Where the quiet footer mention of the sibling programme points. Omitted when that programme is not offered. */
  siblingHref?: string;
  /** Preview-only controls, mounted by the preview server and never by production routes. */
  controls?: string;
}

export const OUTCOME_WORDS: Record<string, string> = { done: 'Done', partly: 'Partly', not: 'Not taken this time', changed: 'It changed' };
const KIND_WORDS: Record<string, string> = { limit: 'A real limit', prediction: 'A prediction' };

const extraCss = `
.stack>*+*{margin-top:28px}.stack h2{font-size:24px;margin:0 0 6px}.quote{font-size:21px;line-height:1.45;color:var(--ink)!important;margin:6px 0}.why{margin:4px 0 0}
.rows{list-style:none;margin:0;padding:0}.rows li{padding:14px 0;border-top:1px solid var(--border)}.rows li:first-child{border-top:0}.rows .when{display:block;color:var(--gold);font-size:13px;letter-spacing:1.2px;text-transform:uppercase}
.rows .outcome{display:block;color:var(--muted);font-size:15px;margin-top:4px}.ledger li{font-size:19px;line-height:1.45}.ledger .when{margin-bottom:2px}
.pick{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0}.pick label{display:flex;align-items:center;margin:0;font-weight:400;font-size:16px}.pick input{margin:0 8px 0 0;width:auto;accent-color:var(--gold)}
.form fieldset{margin-top:34px}.solo{margin-top:16px}.soft{border-color:var(--border);background:transparent}.soft form button{background:transparent;color:var(--muted);border:1px solid var(--border)}`;

const form = (action: string, body: string, button: string, o: PageOptions, extra = ''): string => {
  const event = randomUUID();
  const controls = body.replace(/(for|id)="([^"]+)"/g, (_, attribute: string, id: string) => `${attribute}="${event}-${id}"`);
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escape(o.csrf)}"><input type="hidden" name="event" value="${event}"><input type="hidden" name="revision" value="${o.programme?.revision ?? o.revision ?? 0}">${extra}${controls}<button type="submit">${button}</button></form>`;
};
export const clock = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const dayLabel = (iso: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
const days = (list: readonly number[]): string => {
  const names = LIGHT_DAY_ORDER.filter(d => list.includes(d)).map(d => WEEKDAYS[d]!);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
};

/**
 * The schedule inputs, in one place: timezone, first conversation, weekly day/time and light evenings.
 * Calls per month (1-8, same price) is part of it: more than four use a second day, three days after the usual one.
 */
export function scheduleInputs(o: PageOptions): string {
  const zone = o.timezone ?? 'Europe/Oslo';
  const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(Date.now() + 86400_000)).slice(0, 10) + 'T18:00';
  const openingValue = o.openingAt ? localValue(o.openingAt, zone) : tomorrow;
  const chosen = o.lightDays ?? DEFAULT_LIGHT_DAYS; const none = o.scheduled && chosen.length === 0;
  return field('Your timezone', 'timezone', zone, 'text', 'required maxlength="80"') +
    (o.programme?.openingHeld ? '<p class="quiet">Your first conversation is done. These are your usual times. To move only the next call, return to your account.</p>' : field('First conversation', 'opening_local', openingValue, 'datetime-local', 'required') + '<p class="quiet">About 20–25 minutes. If you miss it, it is offered again at your next usual time.</p>') +
    `<label for="calls">Calls per month</label><select id="calls" name="calls">${Array.from({ length: MAX_CALLS - MIN_CALLS + 1 }, (_, i) => i + MIN_CALLS).map(n => `<option value="${n}" ${n === (o.calls ?? DEFAULT_CALLS) ? 'selected' : ''}>${n}</option>`).join('')}</select><p class="quiet">The price is the same whatever you choose, and you can change it in your account later. A change applies from your next chapter. Five or more calls a month use a second day, three days after your usual one.</p>` +
    `<label for="weekday">Regular call · day</label><select id="weekday" name="weekday">${WEEKDAYS.map((day, i) => `<option value="${i}" ${i === (o.weekday ?? 0) ? 'selected' : ''}>${day}</option>`).join('')}</select>` + field('Regular call · time', 'weekly', o.weekly ?? '17:00', 'time', 'required') +
    `<fieldset><legend>Light calls</legend><p class="quiet">About a minute: what was alive in your day. They start after your first conversation. A missed evening is not made up.</p><div class="pick"><label><input type="radio" name="light_choice" value="evenings" ${none ? '' : 'checked'}>Three evenings a week, or the evenings I choose</label><label><input type="radio" name="light_choice" value="none" ${none ? 'checked' : ''}>No light calls</label></div><div class="pick" role="group" aria-label="Light call evenings">${LIGHT_DAY_ORDER.map(d => `<label><input type="checkbox" name="light_day" value="${d}" ${chosen.includes(d) ? 'checked' : ''}>${WEEKDAYS[d]!.slice(0, 3)}</label>`).join('')}</div>${field('Light calls · time', 'light', o.lightTime ?? clock(DEFAULT_LIGHT_MINUTE), 'time', 'required')}</fieldset>`;
}

function nextCard(o: PageOptions): string {
  const n = o.next; if (!n) return '';
  const move = n.moveable
    ? `<details class="spaced"><summary>Move only this call</summary><p class="quiet">${n.weekly ? 'Choose a later time in the same week, after your usual call time and before the following one.' : 'Choose any time in the next 30 days.'} Pick it in your saved scheduling zone: ${escape(o.timezone ?? 'Europe/Oslo')}. Your usual times stay the same.</p>${form('/unblock/action', hidden('action', 'occurrence') + hidden('kind', 'call') + hidden('expected_at', n.at) + field('New time for this call', 'occurrence_local', localValue(n.at, o.timezone ?? 'Europe/Oslo'), 'datetime-local', 'required'), 'Move this call', o)}</details>` : '';
  const skip = form('/unblock/action', hidden('action', 'skip') + hidden('kind', 'call') + hidden('expected_at', n.at), 'Skip this call', o);
  return `<article class="card appointment"><span class="eyebrow">Your next call · ${escape(n.label)}</span><h2><time datetime="${escape(n.at)}" data-local-appointment>${escape(n.text)}</time></h2><p class="quiet" data-display-zone>Shown in your saved time · ${escape(o.timezone)}</p>${move}${skip}<p class="quiet">A skipped call is not made up later.</p></article>`;
}
function lightCard(o: PageOptions): string {
  if (!o.scheduled) return '';
  const days_ = o.lightDays ?? [];
  const when = days_.length && o.lightTime ? `${days(days_)} at ${escape(o.lightTime)}` : '';
  const skip = o.nextLight ? `<p class="spaced">Next light call: <time datetime="${escape(o.nextLight.at)}">${escape(o.nextLight.text)}</time></p>${form('/unblock/action', hidden('action', 'skip') + hidden('kind', 'light') + hidden('expected_at', o.nextLight.at), 'Skip this light call', o)}` : '';
  return `<article class="card soft"><h2>Light calls</h2><p>${when ? `A minute or so, ${when}: what was alive in your day.` : 'You have chosen no light calls. Each weekly call will ask for one moment from the week instead.'}</p>${skip}<p>${link('/unblock/schedule', 'Change my times', true)}</p></article>`;
}

function wishSection(p: Programme): string {
  const wish = currentWish(p);
  if (!wish) return `<section><h2>Your wish</h2><p class="quiet">It appears here after your first conversation, in your own words. Nothing is saved that you have not agreed to.</p></section>`;
  const earlier = p.wishes.slice(0, -1).reverse();
  return `<section><h2>Your wish</h2><p class="quote">${escape(wish.text)}</p>${wish.why ? `<p class="why quiet">Why it matters · ${escape(wish.why)}</p>` : ''}${earlier.length ? `<details class="spaced"><summary>Earlier versions</summary><ul class="rows">${earlier.map(w => `<li><span class="when">${escape(w.at.slice(0, 10))}</span>${escape(w.text)}${w.why ? `<span class="outcome">${escape(w.why)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}</section>`;
}
function blockSection(p: Programme): string {
  if (!p.blocks.length) return '';
  const wish = currentWish(p);
  const row = (b: Programme['blocks'][number]): string => `<li>${escape(b.text)}${KIND_WORDS[b.kind] ? `<span class="outcome">${KIND_WORDS[b.kind]}</span>` : ''}</li>`;
  const earlier = p.blocks.filter(b => wish && b.wishVersion !== wish.version);
  return `<section><h2>What keeps it a wish</h2><ul class="rows">${p.blocks.filter(b => !wish || b.wishVersion === wish.version).map(row).join('')}</ul>${earlier.length ? `<details class="spaced"><summary>From an earlier version of the wish</summary><ul class="rows">${earlier.map(row).join('')}</ul></details>` : ''}</section>`;
}
function stepSection(p: Programme): string {
  if (!p.steps.length) return '';
  const label = (s: Programme['steps'][number]): string => (p.month ?? 1) > 1 || (s.month ?? 1) > 1 ? `${escape(chapterOfMonth(s.month ?? 1).title)} · call ${s.week}` : `Call ${s.week}`;
  return `<section><h2>Steps</h2><ul class="rows">${p.steps.map(s => `<li><span class="when">${label(s)}</span>${escape(s.text)}${s.outcome ? `<span class="outcome">${OUTCOME_WORDS[s.outcome]}${s.outcomeText ? ` · ${escape(s.outcomeText)}` : ''}</span>` : ''}</li>`).join('')}</ul></section>`;
}
function ledgerSection(p: Programme): string {
  if (!p.ledger.length) return '';
  const entries = [...p.ledger].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.at.localeCompare(b.at));
  return `<section><h2>What was alive</h2><p class="quiet">Moments you noticed, in your words.</p><ul class="rows ledger">${entries.map(e => `<li><span class="when">${escape(dayLabel(e.occurredOn))}</span>${escape(e.text)}</li>`).join('')}</ul></section>`;
}
function closingSection(p: Programme): string {
  const all = [...(p.closings ?? []), ...(p.closing ? [p.closing] : [])];
  if (!all.length) return '';
  return all.map(c => { const chapter = chapterOfMonth(c.month ?? 1); return `<section><h2>Where you landed${all.length > 1 || (p.month ?? 1) > 1 ? ` · ${escape(chapter.title)}` : ''}</h2><p class="quote">${escape(c.text)}</p>${c.carryText ? `<p class="why quiet">To carry · ${escape(c.carryText)}</p>` : ''}<p class="why quiet">${escape(chapter.milestone)}</p></section>`; }).join('');
}
/** The current chapter, so the account says where the month is without counting or scoring anything. */
function chapterSection(p: Programme): string {
  if (!p.openingHeld) return '';
  const pos = chapterPos(monthOf(p)); const chapter = chapterOfMonth(monthOf(p));
  return `<section><h2>This month · ${escape(chapter.title)}</h2><p class="quiet">${escape(chapter.analogy)}</p><p class="why quiet">${escape(chapter.milestone)}</p>${pos.year > 1 ? `<p class="why quiet">Year ${pos.year}</p>` : ''}</section>`;
}

const dateLabel = (iso: string, zone = 'Europe/Oslo'): string => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
/** Status line, calls per month, pause/resume, cancel at period end and the provider's billing portal. */
function subscriptionCard(o: PageOptions): string {
  const sub = o.sub, p = o.programme; if (!sub || !p) return '';
  const paused = p.state === 'paused';
  const until = sub.paidUntil ? dateLabel(sub.paidUntil, sub.timezone) : '';
  const status = sub.standing === 'ended' || p.state === 'completed' ? 'Ended. No more calls will be placed; everything stays here.'
    : sub.standing === 'past_due' ? 'Payment problem. Your last payment did not go through; update your payment method under Manage billing. Calls continue while the payment provider retries.'
      : sub.standing === 'payment_hold' ? 'Your payment needs review.'
        : sub.standing !== 'active' ? 'Not started. Calls begin once the subscription is confirmed.'
          : sub.cancelling ? `Cancelling${until ? ` on ${escape(until)}` : ' at the end of this billing period'}. Your calls continue until then.`
            : paused ? 'Paused. No calls are placed until you resume.' : `Active${until ? `. Renews around ${escape(until)}` : ''}.`;
  const live = sub.standing === 'active' || sub.standing === 'past_due';
  const calls = `<h3>Calls per month</h3><p class="quiet">${sub.pendingCalls ? `This chapter keeps ${sub.callsPerMonth}. From your next chapter: ${sub.pendingCalls}.` : `${sub.callsPerMonth} a month.`} The price is the same whatever you choose. A change applies from your next chapter.${p.chapterCalls ? ` This chapter is set to ${callsOf(p)}.` : ''}</p>`
    + form('/unblock/action', hidden('action', 'calls') + `<label for="calls">Calls per month</label><select id="calls" name="calls">${Array.from({ length: MAX_CALLS - MIN_CALLS + 1 }, (_, i) => i + MIN_CALLS).map(n => `<option value="${n}" ${n === (sub.pendingCalls ?? sub.callsPerMonth) ? 'selected' : ''}>${n}</option>`).join('')}</select>`, 'Save calls per month', o);
  const pause = live && p.state === 'active' ? `<p class="quiet spaced">Pausing stops calls straight away. It does not pause billing: your subscription keeps renewing while calls are paused. To stop being billed, cancel.</p>${form('/unblock/action', hidden('action', 'pause'), 'Pause my calls', o)}`
    : live && paused ? form('/unblock/action', hidden('action', 'resume'), 'Resume my calls', o) : '';
  const cancel = live && sub.manageable && !sub.cancelling ? `<p class="quiet spaced">Cancelling ends the subscription at the end of the billing period you have paid for. Calls continue until then.</p>${form('/unblock/action', hidden('action', 'cancel'), 'Cancel at the end of this period', o)}` : '';
  const billing = sub.manageable ? form('/unblock/action', hidden('action', 'billing'), 'Manage billing', o) : '';
  return `<section data-seam="subscription" class="card soft"><h2>Subscription</h2><p>${status}</p>${live ? calls : ''}${pause}${cancel}${billing}</section>`;
}

function account(o: PageOptions): string {
  const p = o.programme; if (!p) return '';
  const finished = p.state === 'completed';
  const intro = finished ? 'Your calls have ended. Everything below stays here for you.'
    : !p.openingHeld ? 'Your first conversation comes first. What you say there is read back to you before anything is saved.'
      : 'Your wish, your steps and the moments you noticed are kept here, in your own words.';
  // PAYMENT SEAM: the checkout link comes from ./payment.ts; the preview simulates payment in memory.
  const purchase = !o.paid && !o.paymentHold ? `<article class="card"><h2>${o.sub?.standing === 'ended' ? 'Start again' : 'Start Unblock'}</h2><p>${o.preview ? 'Preview the paid enrolment without a charge.' : 'A monthly subscription. Your calls start after payment is confirmed.'}${o.price ? ` ${escape(o.price)}.` : ''}</p>${!o.scheduled ? link('/unblock/schedule', 'Choose your times before checkout')
    : o.checkout ? link(o.checkout, 'Continue to payment')
      : o.preview ? form('/unblock/action', hidden('action', 'pay'), 'Preview payment confirmation', o)
        : '<p class="quiet">Checkout is not available here yet. If you attempted a payment, check its receipt or contact us before trying again.</p>'}</article>` : '';
  const help = o.support ? `<p class="quiet">Payment question or refund? <a href="${escape(o.support)}">Contact us</a>. A person decides; nothing is refunded automatically.</p>` : '';
  const paused = p.state === 'paused';
  return `<section class="account stack">${back('/unblock', 'Unblock')}<h1>Your Unblock</h1><p class="quiet">${escape(intro)}</p>
    ${o.held ? '<p class="notice">Calls are on hold. Contact us before restarting.</p>' : ''}${o.paymentHold ? '<p class="notice">Your payment needs review. Calls are on hold; contact us for help.</p>' : ''}
    ${purchase}${paused ? '<p class="notice">Your calls are paused. Your words stay here.</p>' : ''}${o.sub || !o.paid ? '' : paused ? form('/unblock/action', hidden('action', 'resume'), 'Resume my calls', o) : ''}
    ${!paused && !o.held && !o.paymentHold ? nextCard(o) : ''}${!paused && o.paid && !o.next && !finished && !o.held ? `<p>${link('/unblock/schedule', 'Choose your times', true)}</p>` : ''}
    ${!paused && !o.held && !o.paymentHold && !finished && o.paid ? lightCard(o) : ''}
    ${finished ? '<article class="card"><h2>Your calls have ended</h2><p>No more calls will be placed. Revisiting this page does not start anything.</p></article>' : ''}
    ${chapterSection(p)}${wishSection(p)}${blockSection(p)}${stepSection(p)}${ledgerSection(p)}${closingSection(p)}
    ${subscriptionCard(o)}${o.controls ?? ''}
    <hr class="divider"><div class="actions">${!finished ? link('/unblock/schedule', 'Change my usual times', true) : ''}${!finished && p.state === 'active' && !o.sub && o.paid ? form('/unblock/action', hidden('action', 'pause'), 'Pause my calls', o) : ''}</div>${help}
    ${!o.preview ? `<details class="spaced"><summary>Your data and account</summary><p class="quiet">Download everything we hold about you, in your own words. Deleting erases your entire 8&80 account, including weekly calls and any other 8&80 programme, and stops all calls.</p>${form('/unblock/action', hidden('action', 'export'), 'Download my data', o)}${form('/unblock/action', hidden('action', 'delete') + field('Type DELETE to erase your entire 8&80 account', 'confirmation', '', 'text', 'required'), 'Delete my whole account', o)}</details>` : ''}
    ${form('/unblock/action', hidden('action', 'signout'), 'Sign out', o)}</section>`;
}

export function unblockPage(screen: Screen, o: PageOptions = {}): string {
  let body = '';
  if (screen === 'landing') body = `<section class="hero"><h1>See the light in your own life — and take the step that has been waiting.</h1><p class="lead">Phone calls to name something you have wanted for a long time, look honestly at what keeps it a wish, and take one small step at a time. Each month is a chapter.</p>${o.preview || o.available ? link('/unblock/join', 'Begin Unblock') : '<p class="notice">Enrolment opens when the paid pilot is ready.</p>'}<p class="spaced quiet">Already started? <a href="/unblock/access">Open your account</a>.</p></section>
    <section class="journey" aria-labelledby="arc-heading"><h2 id="arc-heading">One wish. One step at a time.</h2><ol class="journey-steps" role="list">${[
      ['01', 'The wish', 'Say what you have wanted for a long time and kept for someday, and why it matters. Choose a first step.', 'Opening call', '20–25 min'],
      ['02', 'The step', 'Each call begins with what happened to your last step, then looks at what is in the way and what comes next.', 'Regular calls', '10–15 min'],
      ['03', 'The light', 'Notice what is already alive in your ordinary days. Your own words are kept for you and read back to you.', 'Light calls · optional', 'about 1 min'],
    ].map(([n, title, text, rhythm, duration]) => `<li class="journey-step"><span class="step-number" aria-hidden="true">${n}</span><h3>${title}</h3><p class="step-description">${text}</p><p class="step-timing"><span>${rhythm}</span><strong>${duration}</strong></p></li>`).join('')}</ol></section>
    <section class="cards" aria-label="How it works"><article class="card"><span class="eyebrow">Light calls</span><h3>What was alive today?</h3><p>On three evenings a week, at a time you choose, a call of about a minute asks one question. Choose other evenings, or none at all. Without them, each weekly call asks for one moment from your week instead.</p></article><article class="card"><span class="eyebrow">A step not taken</span><h3>Information, not failure</h3><p>Done, partly, not done and “it changed” are all fine answers, and any of them is useful.</p></article><article class="card"><span class="eyebrow">Plainly</span><h3>An AI, and your words</h3><p>Calls are with an AI. This is a self-reflection programme for adults, not therapy and not an emergency service. Only what you say and agree to is saved, privately, and you can download or delete it all.</p></article></section>
    ${o.price && !o.preview ? `<p class="quiet journey-price">${escape(o.price)}. A monthly subscription, separate from weekly 8&80. You choose between 1 and 8 calls a month at the same price, and can pause or cancel in your account.</p>` : '<p class="quiet journey-price">A monthly subscription, separate from weekly 8&80. You choose between 1 and 8 calls a month at the same price. The price is shown before you pay.</p>'}`;
  if (screen === 'join') body = `<section class="form">${back('/unblock')}<h1>${o.access ? 'Open your Unblock' : 'Start with you'}</h1><p class="quiet">${o.access ? 'Verify your phone to open your private account.' : 'First, verify the number you want us to call.'}</p>${form(o.access ? '/unblock/access' : '/unblock/join',
    (o.access ? '' : field('What shall we call you?', 'name', '', 'text', 'autocomplete="given-name" maxlength="80"') + field('Contact email (optional)', 'email', '', 'email', 'autocomplete="email"') + '<p class="quiet">For account support only. Calls never create email recaps.</p>') +
    field('Phone number', 'phone', '+47', 'tel', 'required autocomplete="tel" maxlength="30"') +
    (o.access ? '' : '<label class="check"><input type="checkbox" name="consent" value="yes" required><span>I’m 18 or older and choose this separate monthly subscription. Calls are with an AI. I’ve read the <a href="/unblock/about">service information</a>, <a href="/terms">terms</a> and <a href="/privacy">privacy information</a>.</span></label>'), 'Send my verification code', o)}</section>`;
  if (screen === 'verify') body = `<section class="form">${back(o.access ? '/unblock/access' : '/unblock/join', 'Change number or request a new code')}<h1>Check your messages</h1><p class="quiet">Enter your six-digit verification code. If it has expired, request a new one.${o.preview ? ' For this local preview, use 000000.' : ''}</p>${form('/unblock/verify', field('Verification code', 'code', '', 'text', 'required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"') + hidden('challenge', o.challenge) + hidden('phone', o.phone) + hidden('access', o.access ? 'yes' : ''), 'Open my account', o)}</section>`;
  if (screen === 'schedule') {
    body = `<section class="form">${back('/unblock/account', 'Your account')}<div class="schedule-heading"><h1>Make room for it</h1><p class="quiet">Choose times you can comfortably keep. Your regular conversation and the optional light calls are separate.</p></div>${form('/unblock/action', hidden('action', 'schedule') + scheduleInputs(o) + `<p class="quiet">Leave at least 45 minutes between calls.${o.supportHours ? ` Human response hours: ${escape(o.supportHours)}.` : ''}</p>`, 'Save my times', o)}</section>`;
  }
  if (screen === 'account') body = account(o);
  const title = screen === 'landing' ? 'See the light in your own life' : 'Unblock';
  const sibling = screen === 'account' && o.siblingHref ? `<p>Separately, there is also <a href="${escape(o.siblingHref)}">Beliefs</a>, a practice for assumptions that get in the way.</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · 8&80</title><style>${css}${journeyCss}${extraCss}</style></head><body>${o.preview ? '<div class="preview">Local preview · no calls, texts or payments are sent</div>' : ''}<main class="shell"><a class="brand" href="/unblock" aria-label="8 and 80 Unblock home">${MARK}</a><nav class="top" aria-label="Main"><span class="eyebrow">Unblock</span><a href="/unblock/account">Your account</a></nav>${o.note ? `<p class="notice" role="status">${escape(o.note)}</p>` : ''}${body}<footer class="footer quiet">${o.support ? `<p>Need help? <a href="${escape(o.support)}">Contact us</a>${o.supportHours ? ` · ${escape(o.supportHours)}` : ''}</p>` : ''}<a href="/unblock/about">About Unblock</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>${!o.preview ? '<a href="/start">Explore weekly 8&80</a>' : ''}${sibling}</footer></main><script>${localDisplayScript}</script></body></html>`;
}

export function aboutPage(o: PageOptions = {}): string {
  const body = `<section class="form">${back('/unblock')}<h1>A programme built around your life</h1><p>Name something you have wanted for a long time. Look at what keeps it a wish, take one small step at a time, and notice the moments in your ordinary days that are already alive. Each month is a chapter.</p><p>Calls are with an AI. There is an opening conversation of about 20–25 minutes, then regular calls of 10–15 minutes. Optional light calls take about a minute, on evenings you choose, or none.</p><p>Nothing is saved unless you have heard it read back and agreed. Your wish, your steps and the moments you noticed are private account information, stored encrypted, and separate from your weekly 8&80 call. You can pause, download everything or delete your whole account whenever you like.</p><p>This is an optional self-reflection programme for adults. It is not therapy or an emergency service, and it does not promise a particular result. It may bring up things that matter; you can pass on any question or stop a call at any time. A step you do not take is information, not failure.</p><p>Unblock is separate from weekly 8&80 and is a monthly subscription of its own. You choose how many calls you want each month, from 1 to 8, at the same price; a change applies from your next chapter. Its price and billing terms are shown before you pay. You can pause calls straight away (billing continues while paused) or cancel in your account; a cancellation ends at the end of the period you have paid for. A refund, or a question about a charge, is decided by a person: contact support.</p>${o.support ? `<p>For human support: <a href="${escape(o.support)}">contact us</a>. ${escape(o.supportHours)} This is not an emergency contact.</p>` : '<p>Human support contact and response hours will be confirmed before paid enrolment opens.</p>'}<p>In immediate danger, contact emergency services where you are.</p></section>`;
  return unblockPage('landing', o).replace(/<section class="hero">[\s\S]*?<footer class="footer/, `${body}<footer class="footer`);
}
