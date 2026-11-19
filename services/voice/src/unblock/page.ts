import { feedbackWidget } from '../product-feedback/widget.ts';
import { randomUUID } from 'node:crypto';
import { MARK } from '../link/page.ts';
import { BRAND_HEAD } from '../design-system/head.ts';
import { PRACTICE_CSS, UNBLOCK_CSS } from '../design-system/pages.ts';
import { FOUNDATION_CSS, CONTROL_CSS } from '../design-system/styles.ts';
import { localDisplayScript } from '../beliefs/display.ts';
import { back, escape, field, hidden, link, localValue } from '../beliefs/page.ts';
import { DEFAULT_CALLS, MAX_CALLS, MIN_CALLS, callsOf, currentWish, monthOf, type Programme } from './model.ts';
import { chapterOfMonth, chapterPos } from './chapters.ts';
import { LIGHT_DAY_ORDER, WEEKDAYS } from './forms.ts';
import { protectEmailLinks } from '../design-system/email.ts';
import { JOURNEY_SCRIPT } from './journey.ts';
import { suggestedLocal, suggestedTimes } from './suggested-times.ts';

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
  /** Submitted editable values, retained only for rendering validation errors. */
  values?: URLSearchParams; invalid?: string; error?: boolean; contact?: boolean;
  scopeConfirmed?: boolean;
}

export const OUTCOME_WORDS: Record<string, string> = { done: 'Done', partly: 'Partly', not: 'Not taken this time', changed: 'It changed' };
const KIND_WORDS: Record<string, string> = { limit: 'A real limit', prediction: 'A prediction' };

const form = (action: string, body: string, button: string, o: PageOptions, extra = ''): string => {
  const event = randomUUID();
  const controls = body.replace(/(\s)(for|id|list|aria-describedby|aria-controls|aria-labelledby)="([^"]+)"/g,
    (_, space: string, attribute: string, id: string) => `${space}${attribute}="${event}-${id}"`);
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escape(o.csrf)}"><input type="hidden" name="event" value="${event}"><input type="hidden" name="revision" value="${o.programme?.revision ?? o.revision ?? 0}">${extra}${controls}<button type="submit">${button}</button></form>`;
};
export const clock = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const value = (o: PageOptions, name: string, fallback = ''): string => o.values?.get(name) ?? fallback;
const invalid = (o: PageOptions, name: string): string => o.invalid === name ? ` aria-invalid="true" aria-describedby="${name}-error"` : '';
const error = (o: PageOptions, name: string): string => o.invalid === name ? `<p class="wrong" id="${name}-error">${escape(o.note)}</p>` : '';
const input = (o: PageOptions, label: string, name: string, fallback = '', type = 'text', extra = ''): string =>
  field(label, name, value(o, name, fallback), type, extra + invalid(o, name)) + error(o, name);
const support = (o: PageOptions, label = 'Contact us'): string => o.support ? protectEmailLinks(`<a href="${escape(o.support)}">${escape(label)}</a>${o.support.startsWith('mailto:') ? ` · ${escape(o.support.slice(7))}` : ''}`) : '';
const dayLabel = (iso: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
const days = (list: readonly number[]): string => {
  const names = LIGHT_DAY_ORDER.filter(d => list.includes(d)).map(d => WEEKDAYS[d]!);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
};

/**
 * The schedule inputs, in one place: timezone, first conversation, regular day/time and light-call days.
 * Calls per month (1-8, same price) is part of it: more than four use a second day, three days after the usual one.
 */
export function scheduleInputs(o: PageOptions): string {
  const zone = value(o, 'timezone', o.timezone ?? 'Europe/Oslo');
  // Invalid submitted zones must remain editable rather than throwing while rendering the error.
  let safeZone = zone;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { safeZone = o.timezone ?? 'Europe/Oslo'; }
  const suggestions = suggestedTimes();
  const defaultRegular = suggestedLocal(suggestions.regular, safeZone);
  const defaultLight = suggestedLocal(suggestions.light[0]!, safeZone);
  const openingValue = localValue(o.openingAt ?? suggestions.opening.toISOString(), safeZone);
  const chosen = o.values ? o.values.getAll('light_day').map(Number) : o.lightDays ?? suggestions.light.map(at => suggestedLocal(at, safeZone).weekday);
  const none = o.values ? o.values.get('light_choice') === 'none' : !o.scheduled || chosen.length === 0;
  const calls = value(o, 'calls', String(o.calls ?? DEFAULT_CALLS));
  const weekday = value(o, 'weekday', String(o.weekday ?? defaultRegular.weekday));
  const regular = `${WEEKDAYS[Number(weekday)] ?? ''}${Number(calls) > 4 ? ` and ${WEEKDAYS[(Number(weekday) + 3) % 7]}` : ''} at ${value(o, 'weekly', o.weekly ?? defaultRegular.time)}`;
  const zones = [...new Set([safeZone, ...Intl.supportedValuesOf('timeZone')])];
  return `<div data-unblock-schedule${!o.scheduled && !o.values ? ' data-detect-zone' : ''} data-opening-default="${suggestions.opening.toISOString()}" data-regular-default="${suggestions.regular.toISOString()}" data-light-defaults="${suggestions.light.map(at => at.toISOString()).join(',')}">
    <p class="quiet" data-zone-summary>Times in ${escape(safeZone.replace(/_/g, ' '))}</p>
    <p class="quiet">Unblock call starts: Monday–Friday, 09:00–16:30 Europe/Oslo. Human response coverage continues until 17:00. Choose the matching time in your timezone.</p>
    <details${o.invalid === 'timezone' ? ' open' : ''}><summary>Change timezone</summary>${input(o, 'Your timezone', 'timezone', zone, 'text', 'required maxlength="80" list="timezones" autocomplete="off"')}<datalist id="timezones">${zones.map(z => `<option value="${escape(z)}">${escape(z.replace(/_/g, ' '))}</option>`).join('')}</datalist></details>` +
    (o.programme?.openingHeld ? '<p class="quiet">Your first conversation is done. These are your usual times. To move only the next call, return to your account.</p>' : input(o, 'First conversation', 'opening_local', openingValue, 'datetime-local', 'required') + '<p class="quiet">About 15–20 minutes. We call your phone. If you miss it, the conversation is offered again at your next usual time.</p>') +
    `<label for="calls">Calls per month</label><select id="calls" name="calls"${invalid(o, 'calls')}>${Array.from({ length: MAX_CALLS - MIN_CALLS + 1 }, (_, i) => i + MIN_CALLS).map(n => `<option value="${n}" ${String(n) === calls ? 'selected' : ''}>${n}${n === DEFAULT_CALLS ? ' · suggested rhythm' : ''}</option>`).join('')}</select>${error(o, 'calls')}<p class="quiet">Start with four, or choose what suits you. The price is the same whatever you choose. A change applies from your next chapter. Five or more calls use a second day, three days after your usual one.</p>` +
    `<label for="weekday">Regular call · day</label><select id="weekday" name="weekday">${LIGHT_DAY_ORDER.map(i => `<option value="${i}" ${String(i) === weekday ? 'selected' : ''}>${WEEKDAYS[i]}</option>`).join('')}</select>` + input(o, 'Regular call · time', 'weekly', o.weekly ?? defaultRegular.time, 'time', 'required') +
    `<fieldset><legend>Optional light calls</legend><p class="quiet">About a minute to notice what was alive in your day. You can also choose them during your first conversation. A missed light call is not made up.</p><div class="unblock-options"><label><input type="radio" name="light_choice" value="none" ${none ? 'checked' : ''}>No light calls</label><label><input type="radio" name="light_choice" value="days" ${none ? '' : 'checked'}${invalid(o, 'light_choice')}>Choose light-call days</label></div>${error(o, 'light_choice')}<fieldset data-light-settings><legend>Light call days</legend><div class="unblock-options">${LIGHT_DAY_ORDER.map(d => `<label><input type="checkbox" name="light_day" value="${d}" ${chosen.includes(d) ? 'checked' : ''}>${WEEKDAYS[d]!.slice(0, 3)}</label>`).join('')}</div>${input(o, 'Light calls · time', 'light', o.lightTime ?? defaultLight.time, 'time')}</fieldset></fieldset>
    <section class="schedule-review" aria-labelledby="schedule-review-title"><h2 id="schedule-review-title">Review your times</h2><p data-schedule-summary aria-live="polite">${escape(regular)} · ${escape(safeZone)}. ${escape(calls)} calls per month. ${none ? 'No light calls.' : 'Light calls on your chosen evenings.'}</p><p class="quiet">Regular calls are spread across your billing month. Your account shows the next booked date after saving. Calls begin only after payment is confirmed.</p></section></div>`;
}

function nextCard(o: PageOptions): string {
  const n = o.next; if (!n) return '';
  const move = n.moveable
    ? `<details class="spaced"><summary>Move this call later</summary><p class="quiet">${n.weekly ? 'Choose a later time after this call and before your following regular call.' : 'Choose any time in the next 30 days.'} Pick it in your saved scheduling zone: ${escape(o.timezone ?? 'Europe/Oslo')}. Your usual times stay the same.</p>${form('/unblock/action', hidden('action', 'occurrence') + hidden('kind', 'call') + hidden('expected_at', n.at) + field('New time for this call', 'occurrence_local', localValue(n.at, o.timezone ?? 'Europe/Oslo'), 'datetime-local', 'required'), 'Move this call', o)}</details>` : '';
  const skip = form('/unblock/action', hidden('action', 'skip') + hidden('kind', 'call') + hidden('expected_at', n.at), 'Skip this call', o);
  return `<article class="card appointment"><span class="eyebrow">Your next call · ${escape(n.label)}</span><h2><time datetime="${escape(n.at)}" data-local-appointment>${escape(n.text)}</time></h2><p class="quiet" data-display-zone>Shown in your saved time · ${escape(o.timezone)}</p>${move}${skip}<p class="quiet">A skipped call is not made up later.</p></article>`;
}
function lightCard(o: PageOptions): string {
  if (!o.scheduled) return '';
  const days_ = o.lightDays ?? [];
  const when = days_.length && o.lightTime ? `${days(days_)} at ${escape(o.lightTime)}` : '';
  const skip = o.nextLight ? `<p class="spaced">Next light call: <time datetime="${escape(o.nextLight.at)}">${escape(o.nextLight.text)}</time></p>${form('/unblock/action', hidden('action', 'skip') + hidden('kind', 'light') + hidden('expected_at', o.nextLight.at), 'Skip this light call', o)}` : '';
  return `<article class="card soft"><h2>Light calls</h2><p>${when ? `A minute or so, ${when}: what was alive in your day.` : 'You have chosen no light calls. Each regular call will ask for one moment from the week instead.'}</p>${skip}<p>${link('/unblock/schedule', 'Change my times', true)}</p></article>`;
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
function currentStep(p: Programme): string {
  const step = [...p.steps].reverse().find(s => s.outcome === null && (s.month ?? 1) === monthOf(p));
  return step ? `<section class="card current-step"><h2>Your next step</h2><p class="quote">${escape(step.text)}</p><p class="quiet">The step you agreed to before we next speak. Whatever happens is useful. You can correct it during a call or contact us below.</p></section>` : '';
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
          : sub.cancelling ? `Cancelling${until ? ` on ${escape(until)}` : ' at the end of this billing period'}. ${paused ? 'Your calls stay paused.' : 'Your calls continue until then.'}`
            : paused ? `Paused. No calls are placed until you resume. Billing continues${until ? `; renews around ${escape(until)}` : ''}. Cancel renewal to stop future charges.` : `Active${until ? `. Renews around ${escape(until)}` : ''}.`;
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
  const purchase = !o.paid && !o.paymentHold ? `<article class="card"><h2>${o.sub?.standing === 'ended' ? 'Start again' : 'Start Unblock'}</h2><p>${o.preview ? 'Preview the paid enrolment without a charge.' : 'A monthly subscription. Your calls start after payment is confirmed.'}${o.price ? ` ${escape(o.price)}.` : ''}</p>${o.scheduled ? `<section class="schedule-review"><h3>Your chosen times</h3>${o.openingAt ? `<p>First conversation: <time datetime="${escape(o.openingAt)}" data-local-appointment>${escape(new Intl.DateTimeFormat('en-GB', { timeZone: o.timezone ?? 'Europe/Oslo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(o.openingAt)))}</time> · 15–20 minutes.</p>` : ''}<p>${o.calls ?? DEFAULT_CALLS} regular calls per month, using ${escape(days((o.calls ?? DEFAULT_CALLS) > 4 ? [o.weekday ?? 1, ((o.weekday ?? 1) + 3) % 7] : [o.weekday ?? 1]))} at ${escape(o.weekly)} · ${escape(o.timezone)}. ${o.lightDays?.length ? `Light calls: ${escape(days(o.lightDays))} at ${escape(o.lightTime)}.` : 'No light calls.'}</p><p class="quiet">Payment starts a renewing monthly subscription. Pausing calls does not pause billing. Cancel renewal in your account. Review the full price and terms at checkout.</p></section>` : ''}${!o.scheduled ? link('/unblock/schedule', 'Choose your times before checkout')
    : o.checkout ? form('/unblock/action', hidden('action', 'checkout') + '<label class="check"><input type="checkbox" name="scope_norway" value="yes" required><span>I am currently in Norway and understand the initial launch is Norway-only.</span></label>', 'Continue to payment', o)
      : o.preview ? form('/unblock/action', hidden('action', 'pay'), 'Preview payment confirmation', o)
        : '<p class="quiet">Checkout is not available here yet. If you attempted a payment, check its receipt or contact us before trying again.</p>'}</article>` : '';
  const help = o.support ? `<p class="quiet">Payment question, a correction to your notes, or a refund? ${support(o)}. A person handles these requests.</p>` : '';
  const paused = p.state === 'paused';
  const pausedLine = o.sub?.cancelling ? 'Your calls are paused. Renewal is cancelled; your words stay here.' : 'Your calls are paused. Your words stay here. Billing continues while your subscription is active; cancel renewal to stop future charges.';
  return `<section class="account stack">${back('/unblock', 'Unblock')}<h1>Your Unblock</h1><p class="quiet">${escape(intro)}</p>
    ${o.paid && o.scopeConfirmed === false ? `<section class="card"><h2>Norway-only initial launch</h2><p>Before calls, confirm that you are currently in Norway. You can still manage billing, cancel, export or delete your account.</p>${form('/unblock/action', hidden('action', 'scope') + '<label class="check"><input type="checkbox" name="scope_norway" value="yes" required><span>I am currently in Norway and understand the initial launch is Norway-only.</span></label>', 'Confirm Norway eligibility', o)}</section>` : ''}
    ${o.held ? '<p class="notice">Calls are on hold. Contact us before restarting.</p>' : ''}${o.paymentHold ? '<p class="notice">Your payment needs review. Calls are on hold; contact us for help.</p>' : ''}
    ${purchase}${paused ? `<p class="notice">${pausedLine}</p>` : ''}${o.sub || !o.paid ? '' : paused ? form('/unblock/action', hidden('action', 'resume'), 'Resume my calls', o) : ''}
    ${!paused && !finished && !o.held && !o.paymentHold ? nextCard(o) + currentStep(p) : ''}${!paused && o.paid && !o.next && !finished && !o.held ? o.scheduled ? '<p class="notice">Your usual times are saved. There is no upcoming appointment to show yet. Check back here or contact us before changing your arrangement.</p>' : `<p>${link('/unblock/schedule', 'Choose your times', true)}</p>` : ''}
    ${!paused && !o.held && !o.paymentHold && !finished && o.paid ? lightCard(o) : ''}
    ${finished ? '<article class="card"><h2>Your calls have ended</h2><p>No more calls will be placed. Revisiting this page does not start anything.</p></article>' : ''}
    ${wishSection(p)}${blockSection(p)}<details class="spaced"><summary>Earlier steps and moments</summary>${stepSection(p)}${ledgerSection(p)}${closingSection(p)}</details>${chapterSection(p)}
    ${!p.openingHeld && o.paid && o.scopeConfirmed !== false && !paused && !o.held && !o.paymentHold && !finished ? `<section class="card soft"><h2>Ready for your first conversation</h2><p>We call your phone. Allow 15–20 minutes somewhere you can talk comfortably. There is nothing to prepare.</p>${o.contact ? '<p><a class="button" href="/contact.vcf" download="8and80.vcf">Add 8&80 to contacts</a></p><p class="quiet">Download the contact card, then save it on your phone so you recognise our call.</p>' : ''}<p><a href="/unblock/account">Manage your Unblock calls</a> · Save this page or use the link in your verification text. You may need a new phone code when you return.</p></section>` : ''}
    ${subscriptionCard(o)}${o.controls ?? ''}
    <hr class="divider"><div class="actions">${!finished ? link('/unblock/schedule', 'Change my usual times', true) : ''}${!finished && p.state === 'active' && !o.sub && o.paid ? form('/unblock/action', hidden('action', 'pause'), 'Pause my calls', o) : ''}</div>${help}
    ${!o.preview ? `<details class="spaced"><summary>Your data and account</summary><p class="quiet">Download everything we hold about you, in your own words. Deleting erases your entire 8&80 account, including weekly calls and any other 8&80 programme, and stops all calls.</p>${form('/unblock/action', hidden('action', 'export'), 'Download my data', o)}${form('/unblock/action', hidden('action', 'delete') + field('Type DELETE to erase your entire 8&80 account', 'confirmation', '', 'text', 'required'), 'Delete my whole account', o)}</details>` : ''}
    <div class="account-signout">${form('/unblock/action', hidden('action', 'signout'), 'Sign out', o)}</div></section>`;
}

export function unblockPage(screen: Screen, o: PageOptions = {}): string {
  let body = '';
  if (screen === 'landing') body = `<section class="hero"><h1>See the light in your own life — and take the step that has been waiting.</h1><p class="lead">Phone calls to name something you have wanted for a long time, look honestly at what keeps it a wish, and take one small step at a time. Each month is a chapter.</p><p class="quiet">Initial launch: English-speaking adults currently in Norway.</p><p class="hero-offer">${o.price && !o.preview ? escape(o.price) + '. ' : ''}A separate monthly subscription. Choose 1–8 regular calls a month at the same price. Calls are with an AI.</p>${o.preview || o.available ? link('/unblock/join', 'Begin Unblock') : `<p class="notice">Enrolment opens when the paid pilot is ready. No subscription starts here.</p>${o.support ? `<p>${support(o, 'Ask about Unblock')}</p>` : ''}`}<p class="spaced quiet">Already started? <a href="/unblock/access">Open your account</a>.</p></section>
    <section class="journey" aria-labelledby="arc-heading"><h2 id="arc-heading">One wish. One step at a time.</h2><ol class="journey-steps" role="list">${[
      ['01', 'The wish', 'Say what you have wanted for a long time and kept for someday, and why it matters. Choose a first step.', 'Opening call', '15–20 min'],
      ['02', 'The step', 'Each call begins with what happened to your last step, then looks at what is in the way and what comes next.', 'Regular calls', '10–15 min'],
      ['03', 'The light', 'Notice what is already alive in your ordinary days. Your own words are kept for you and read back to you.', 'Light calls · optional', 'about 1 min'],
    ].map(([n, title, text, rhythm, duration]) => `<li class="journey-step"><span class="step-number" aria-hidden="true">${n}</span><h3>${title}</h3><p class="step-description">${text}</p><p class="step-timing"><span>${rhythm}</span><strong>${duration}</strong></p></li>`).join('')}</ol></section>
    <section class="cards" aria-label="How it works"><article class="card"><span class="eyebrow">Light calls</span><h3>What was alive today?</h3><p>On three days a week, within our weekday calling hours in Oslo, a call of about a minute asks one question. Choose other available days, or none at all. Without them, each regular call asks for one moment since you last spoke instead.</p></article><article class="card"><span class="eyebrow">A step not taken</span><h3>Information, not failure</h3><p>Done, partly, not done and “it changed” are all fine answers, and any of them is useful.</p></article><article class="card"><span class="eyebrow">Plainly</span><h3>An AI, and your words</h3><p>Calls are with an AI. This is a self-reflection programme for adults, not therapy and not an emergency service. Only what you say and agree to is saved, privately, and you can download or delete it all.</p></article></section>
    <section class="product-comparison"><h2>Which call suits you?</h2><p>Weekly 8&80 offers a weekly phone call for perspective and follow-through, with a short email recap. Unblock focuses on one wish, with regular conversations and optional light calls. They have separate subscriptions and private notes.</p><p>${link('/start', 'Explore weekly 8&80', true)}</p><p class="quiet">Unblock’s full price and renewal terms are shown before you pay. Pausing calls does not pause billing; cancel renewal in your account to stop future charges.</p>${o.preview || o.available ? link('/unblock/join', 'Begin Unblock') : ''}</section>`;
  if (screen === 'join') body = `<section class="form">${back('/unblock')}<h1>${o.access ? 'Open your Unblock' : 'Start with you'}</h1><p class="quiet">${o.access ? 'Verify your phone to open your private account.' : 'First, verify the number you want us to call. Then choose your times and review payment.'}</p>${form(o.access ? '/unblock/access' : '/unblock/join',
    (o.access ? '' : input(o, 'What shall we call you? (optional)', 'name', '', 'text', 'autocomplete="given-name" maxlength="80"') + input(o, 'Contact email (optional)', 'email', '', 'email', 'autocomplete="email"') + '<p class="quiet">For account support only. Calls never create email recaps.</p>') +
    input(o, 'Phone number', 'phone', '+47', 'tel', 'required autocomplete="tel" maxlength="30"') +
    (o.access ? '' : `<label class="check"><input type="checkbox" name="scope_norway" value="yes" required${o.values?.get('scope_norway') === 'yes' ? ' checked' : ''}${invalid(o, 'scope_norway')}><span>I am currently in Norway and understand the initial launch is Norway-only.</span></label>${error(o, 'scope_norway')}<label class="check"><input type="checkbox" name="consent" value="yes" required${o.values?.get('consent') === 'yes' ? ' checked' : ''}${invalid(o, 'consent')}><span>I’m 18 or older and understand that Unblock is a separate monthly subscription. Calls are with an AI. I’ve read the <a href="/unblock/about">service information</a>, <a href="/terms">terms</a> and <a href="/privacy">privacy information</a>. Nothing is charged until I choose to pay.</span></label>${error(o, 'consent')}`), 'Send my verification code', o)}</section>`;
  if (screen === 'verify') body = `<section class="form">${back(o.access ? '/unblock/access' : '/unblock/join', 'Change number')}<h1>Check your messages</h1><p class="quiet">Enter the six-digit code for ${escape(o.phone ? o.phone.slice(0, 3) + ' •••• ' + o.phone.slice(-4) : 'your phone')}. It expires after ten minutes.${o.preview ? ' For this local preview, use 000000.' : ''}</p>${form('/unblock/verify', input(o, 'Verification code', 'code', '', 'text', 'required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" autofocus') + hidden('challenge', o.challenge) + hidden('phone', o.phone) + hidden('access', o.access ? 'yes' : ''), o.access ? 'Open my account' : 'Choose my times', o)}${form('/unblock/resend', hidden('challenge', o.challenge) + hidden('phone', o.phone) + hidden('access', o.access ? 'yes' : ''), 'Send a new code', o)}<p class="quiet">Allow a minute before asking for another code. Only the latest code works.</p></section>`;
  if (screen === 'schedule') {
    body = `<section class="form">${back('/unblock/account', 'Your account')}<div class="schedule-heading"><h1>Make room for it</h1><p class="quiet">Choose times you can comfortably keep. Your regular conversation and the optional light calls are separate.</p></div>${form('/unblock/action', hidden('action', 'schedule') + scheduleInputs(o) + `<p class="quiet">Leave at least 45 minutes between calls.${o.supportHours ? ` Human response hours: ${escape(o.supportHours)}.` : ''}</p>`, 'Save my times', o)}</section>`;
  }
  if (screen === 'account') body = account(o);
  const title = screen === 'landing' ? 'See the light in your own life' : 'Unblock';
  const sibling = screen === 'account' && o.siblingHref ? `<p>Separately, there is also <a href="${escape(o.siblingHref)}">Beliefs</a>, a practice for assumptions that get in the way.</p>` : '';
  return `<!doctype html><html lang="en" data-theme="dark"><head>${BRAND_HEAD}<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · 8&80</title><style>${FOUNDATION_CSS}${CONTROL_CSS}${PRACTICE_CSS}${UNBLOCK_CSS}</style></head><body>${o.preview ? '<div class="preview">Local preview · no calls, texts or payments are sent</div>' : ''}<main class="shell"><a class="brand" href="/unblock" aria-label="8 and 80 Unblock home">${MARK}</a><nav class="top" aria-label="Main"><span class="eyebrow">Unblock</span><a href="/start">Weekly calls</a><a href="/unblock/account">Your account</a></nav>${o.note ? `<p class="notice" role="${o.error ? 'alert' : 'status'}">${escape(o.note)}</p>` : ''}${body}<footer class="footer quiet">${o.support ? `<p>Need help? ${support(o)}${o.supportHours ? ` · ${escape(o.supportHours)}` : ''}</p>` : ''}<a href="/unblock/about">About Unblock</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>${!o.preview ? '<a href="/start">Explore weekly 8&80</a>' : ''}${sibling}</footer></main><script>${localDisplayScript}</script><script>${JOURNEY_SCRIPT}</script>${o.preview ? '' : feedbackWidget()}</body></html>`;
}

export function aboutPage(o: PageOptions = {}): string {
  const body = `<section class="form">${back('/unblock')}<h1>A programme built around your life</h1><p>Name something you have wanted for a long time. Look at what keeps it a wish, take one small step at a time, and notice the moments in your ordinary days that are already alive. Each month is a chapter.</p><p>Calls are with an AI. There is an opening conversation of about 15–20 minutes, then regular calls of 10–15 minutes. Optional light calls take about a minute, on days you choose, or none.</p><p>Nothing is saved unless you have heard it read back and agreed. Your wish, your steps and the moments you noticed are private account information, stored encrypted, and separate from your weekly 8&80 call. You can pause, download everything or delete your whole account whenever you like.</p><p>The initial launch is for English-speaking adults currently in Norway. This is an optional self-reflection programme for adults. It is not therapy or an emergency service, and it does not promise a particular result. It may bring up things that matter; you can pass on any question or stop a call at any time. A step you do not take is information, not failure.</p><p>Unblock is separate from weekly 8&80 and is a monthly subscription of its own. You choose how many calls you want each month, from 1 to 8, at the same price; a change applies from your next chapter. Its price and billing terms are shown before you pay. You can pause calls straight away (billing continues while paused) or cancel in your account; a cancellation ends at the end of the period you have paid for. A refund, or a question about a charge, is decided by a person: contact support.</p>${o.support ? `<p>For human support: ${support(o, 'contact us')}. ${escape(o.supportHours)} This is not an emergency contact.</p>` : '<p>Human support contact and response hours will be confirmed before paid enrolment opens.</p>'}<p>In immediate danger, contact emergency services where you are.</p></section>`;
  return unblockPage('landing', o).replace(/<section class="hero">[\s\S]*?<footer class="footer/, `${body}<footer class="footer`);
}
