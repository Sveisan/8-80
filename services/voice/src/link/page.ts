import { checkoutLink } from '../billing/notice.ts';
import { config } from '../config.ts';
import { maskEmail, type AccountState } from './account.ts';
import type { ScriptLines } from '../script.ts';
import { describeAppointment, type Slot } from '../schedule/time.ts';
import { BUSY, BUSY_CSS, MOTION, busyLabel } from '../signup/mascot.ts';

/** Weekday names come from the locale, not from a list in this file. */
const dayNames = (language: string, weekday: 'long' | 'short' = 'long'): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday, timeZone: 'UTC' });
  // 2026-09-06 was a Sunday, so index 0 is Sunday as everywhere else here.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Monday first, the way a week is written down here. Values stay Sunday-is-0. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * Every quarter hour from six to ten, the row the sign-up page offers, plus the
 * slot itself when it sits between them — a call moved by text to 07:15 must
 * still show as chosen, not as nothing.
 */
const timesFor = (minute: number): string[] => {
  const grid = Array.from({ length: 65 }, (_, i) => 360 + i * 15);
  return [...new Set([...grid, minute])].sort((a, b) => a - b).map(clock);
};

/** How the page was reached, and so what it may offer. */
export interface PageView {
  /**
   * `link` is a code from a text: the whole page. `browser` is the cookie on
   * the browser that signed up: everything but the copy and the deletion,
   * which stay behind a fresh link from a text. See control.ts.
   */
  via?: 'link' | 'browser';
  account?: AccountState;
  beforeFirst?: boolean;
  /**
   * When the first call is, if there has not been one yet. The page says that
   * instead of "move this week's call", and a time chosen on it moves the
   * booking rather than one week, because before the first call the booking
   * is the only week there is.
   */
  first?: Date;
  /** The actual occurrence shown by this page and targeted by its skip form. */
  next?: Date;
  /** Minutes after signing up: the page says it is done before offering anything. */
  fresh?: boolean;
  /**
   * Offer the contact card. Only before the first call, and only when there is
   * a number to put on it: a card with no number, or the wrong one, is worse
   * than none — it is saved, and then never matches.
   */
  contact?: boolean;
  /** Offer the field for adding to this year's goals. Only once a call has made the list. */
  goals?: boolean;
  /** A `page.goals.*` key, when the last attempt to add said something. */
  goalsNote?: string;
  scheduleNote?: string;
}

/**
 * The page a text points at, and the page the sign-up browser lands on.
 *
 * Deliberately plain and deliberately small. It shows the slot and offers the
 * things somebody would come here to do, and it shows nothing else — no name,
 * no commitment, no goals, no history. The link may sit in a message thread for
 * years and be opened by whoever has the phone, so the page is designed for a
 * stranger to find boring. What they can add, they can add without being shown
 * what is already there.
 *
 * No client-side framework, no fetch, no JSON. Forms that post and reload. It
 * has to work on a bad train connection with one thumb, which is exactly the
 * situation somebody is in when they miss a call.
 *
 * The time is picked the way it was picked at sign-up: a row of day chips and
 * a row of times you swipe. Somebody moving their call should recognise the
 * control they chose it with.
 */
export function reschedulePage(
  slot: Slot,
  script: ScriptLines,
  language = 'en',
  /** The delivery address is masked and never inserted into an input or hidden field. */
  email?: string,
  /** A `page.email.*` key, when the last attempt to save one said something. */
  note?: string,
  view: PageView = {},
): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const days = dayNames(language);
  const short = dayNames(language, 'short');
  const via = view.via ?? 'link';
  const state = view.account;
  const active = !state || (state.canCall && !state.paused);
  const arranging = active && !state?.onHold;
  const first = arranging ? view.first : undefined;
  const booking = view.beforeFirst ?? !!first;
  const when = `${days[slot.weekday]} ${clock(slot.minute)}`;
  const time = clock(slot.minute);

  const appointment = arranging ? first ?? view.next : undefined;
  const locale = language === 'en' ? 'en-GB' : language;
  const appointmentDate = appointment ? new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: slot.timezone,
  }).format(appointment) : '';
  const appointmentTime = appointment ? new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', timeZone: slot.timezone, timeZoneName: 'short',
  }).formatToParts(appointment) : [];
  const appointmentClock = appointmentTime.filter(part => part.type !== 'timeZoneName').map(part => part.value).join('').trim();
  const appointmentZone = appointmentTime.find(part => part.type === 'timeZoneName')?.value ?? '';

  const head = state?.paused
    ? `<h1>${say('page.stopped')}</h1><p class="now">${say('page.paused.detail')}</p>`
    : state?.onHold
      ? `<h1>${say('page.held')}</h1><p class="now">${say('page.held.detail')}</p>`
    : state && !state.canCall
      ? `<h1>${say('page.ended')}</h1><p class="now">${say('page.ended.detail')}</p>`
      : `<h1>${say(first && view.fresh ? 'page.booked' : 'page.title')}</h1>`;

  // Before the first call, offer caller recognition above the time picker.
  // Keep it a secondary link so the appointment and reschedule control stand out.
  const contact = view.contact && arranging
    ? `
    <a class="contact-link" href="/contact.vcf" download="8and80.vcf">${say('page.contact')}</a>
    <p class="hint">${say('page.contact.detail')}</p>`
    : '';

  // Before the first call a new time is the booking, so "every week" is not
  // a question worth a checkbox: it is sent, and said on the button.
  const always = booking
    ? '<input type="hidden" name="always" value="1" />'
    : `<label class="always"><input type="checkbox" name="always" value="1" /> ${say('page.always')}</label>`;

  const goals = view.goals && arranging
    ? `
    <details class="change-time"${view.goalsNote ? ' open' : ''}>
    <summary>${say('page.goals.open')}</summary>
    <form method="post" class="move">
      <label for="goals">${say('page.goals.label')}</label>
      <textarea id="goals" name="goals" rows="3" maxlength="${GOALS_MAX}" required></textarea>
      <p class="hint">${say('page.goals.detail')}</p>
      <button name="action" value="goals">${busyLabel(say('page.goals.save'))}</button>
      ${view.goalsNote ? `<p class="now said">${say(view.goalsNote)}</p>` : ''}
    </form></details>`
    : '';

  const rest =
    via === 'link'
      ? `
    <form method="post" class="stop">
      <button name="action" value="export" class="quiet">${say('page.export')}</button>
    </form>

    <form method="post" class="stop">
      <button name="action" value="forget" class="quiet">${say('page.forget')}</button>
    </form>`
      : `<p class="hint centre">${say('page.browser.rest')} <a href="/access">${say('access.verify')}</a></p>`;

  const trialDate = state?.trialEnds
    ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: slot.timezone, timeZoneName: 'short' }).format(state.trialEnds)
    : undefined;
  const billingKey = state?.cancelAtPeriodEnd ? state.canCall ? 'page.paid.nonrenewing' : 'page.paid.ended' : state?.billing === 'trialing'
    ? !trialDate ? 'page.trial.unknown' : state.canCall ? 'page.trial' : 'page.trial.ended'
    : state?.billing === 'trial_ended' ? 'page.trial.ended'
    : state?.billing === 'active' ? 'page.paid'
      : state?.billing === 'past_due' ? 'page.payment_due'
        : state?.billing === 'comped' ? 'page.comped' : 'page.billing.ended';
  const paidDate = state?.paidUntil ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: slot.timezone, timeZoneName: 'short' }).format(state.paidUntil) : '';
  const renewal = state?.cancelAtPeriodEnd ? `<p class="now">${esc((script.get(state.canCall ? 'page.cancel.until' : 'page.cancel.ended') ?? '').replace('{{when}}', paidDate || (script.get('page.cancel.unknown') ?? '')))}</p>` : '';
  const billingControls = state ? state.subscribed && state.billing !== 'ended'
    ? via === 'link' ? `<form method="post"><button name="action" value="billing-portal">${say('page.billing.manage')}</button></form>${!state.cancelAtPeriodEnd ? `<form method="post"><button name="action" value="cancel-renewal">${say('page.cancel.action')}</button></form>` : ''}`
      : `<p><a href="/access">${say('page.billing.verify')}</a></p>`
    : ['trialing', 'trial_ended', 'ended'].includes(state.billing) ? checkoutLink('availability-check') ? `<form method="post"><button name="action" value="checkout"${!state.canCall ? ' class="primary"' : ''}>${say('page.billing.continue')}</button></form><p class="hint">${say('page.billing.price')}</p>` : `<p class="hint">${say('page.billing.unavailable')}</p>` : '' : '';
  const billing = state ? `<p class="hint">${esc((script.get(billingKey) ?? '').replace('{{when}}', trialDate ?? ''))}</p>` : '';
  const resume = state?.paused && state.canCall && !state.onHold
    ? `<form method="post"><button name="action" value="start" class="primary">${say('page.stopped.back')}</button></form>` : '';
  const support = state
    ? `<p><a${!state.canCall ? ' class="save"' : ''} href="mailto:${esc(config.company.supportEmail() || 'hei@8and80.me')}">${say('page.support')}</a></p>` : '';

  return shell(
    `
    ${MARK}
    ${head}
    <section class="account-section call-overview" aria-labelledby="call-heading">
      <h2 id="call-heading">${say(booking ? 'page.first' : 'page.section.call')}</h2>
      ${view.scheduleNote ? `<p role="status">${say(view.scheduleNote)}</p>` : ''}
      ${appointment ? `<time class="appointment" datetime="${esc(appointment.toISOString())}" aria-label="${esc(describeAppointment(appointment, slot.timezone, language))}">
        <span class="appointment-date">${esc(appointmentDate)}</span>
        <span class="appointment-time">${esc(appointmentClock)} <small>${esc(appointmentZone)}</small></span>
      </time>` : ''}
      ${arranging ? `<p class="hint usual-time">${esc((script.get('page.usually') ?? '').replace('{{when}}', when))}</p>` : ''}
      ${arranging && !appointment ? `<p class="now">${say(state?.trialEnds ? 'page.no_next.trial' : 'page.no_next')}</p>` : ''}
      ${resume}
      ${contact}
      ${arranging ? `<details id="move-call" class="change-time reschedule">
        <summary>${say(booking ? 'page.move.open.first' : 'page.move.open')}</summary>
        <form method="post" class="move">
          <fieldset>
            <legend>${say(booking ? 'page.first.pick' : 'page.pick')}</legend>
            <p class="zone">${esc(zoneLine(slot.timezone, script))}</p>
            <div class="days">
              ${WEEK.map(
                (i) => `<label class="pick">
                <input type="radio" name="weekday" value="${i}"${i === slot.weekday ? ' checked' : ''} />
                <span aria-hidden="true">${esc(short[i] as string)}</span><span class="sr">${esc(days[i] as string)}</span>
              </label>`,
              ).join('')}
            </div>
            <div class="times" id="times">
              ${timesFor(slot.minute).map((t) =>
                `<label class="pick"><input type="radio" name="time" value="${t}"${t === time ? ' checked' : ''} /><span>${t}</span></label>`,
              ).join('')}
            </div>
          </fieldset>
          ${always}
          ${booking ? '' : `<p class="hint">${say('page.move.detail')}</p>`}
          <button name="action" value="move" class="primary">${busyLabel(say('page.move'))}</button>
        </form>
      </details>` : ''}
      ${first ? `<p class="hint">${say(view.fresh ? 'signup.done.detail' : 'page.first.detail')}</p>` : ''}
      ${!arranging || booking || !view.next ? '' : `<form method="post" class="skip">
        <input type="hidden" name="skip_at" value="${esc(view.next.toISOString())}" />
        <button name="action" value="skip">${say('page.skip')}</button>
      </form>`}
      ${active ? `<form method="post" class="stop">
        <button name="action" value="stop">${say('page.stop')}</button>
      </form>` : ''}
    </section>

    <section class="account-section" aria-labelledby="notes-heading">
      <h2 id="notes-heading">${say('page.section.notes')}</h2>
      ${goals}
      <p class="hint">${say('page.notes.detail')}</p>
      <p><a href="/memory">${say('memory.title')}</a></p>
    </section>

    ${state ? `<section class="account-section" aria-labelledby="plan-heading">
      <h2 id="plan-heading">${say('page.section.plan')}</h2>
      ${billing}
      ${renewal}
      ${billingControls}
      ${support}
    </section>` : ''}

    <section class="account-section" aria-labelledby="preferences-heading">
      <h2 id="preferences-heading">${say('page.section.preferences')}</h2>
      <p class="hint">${email ? esc((script.get('page.email.current') ?? '').replace('{{email}}', maskEmail(email))) : say('page.email.none')}</p>
      <details class="change-time"${note ? ' open' : ''}>
        <summary>${say('page.email.open')}</summary>
      <form method="post">
        <label for="email">${say('page.email.label')}</label>
        <div class="row">
          <input type="email" id="email" name="email" value="" placeholder="you@example.com"
                 autocomplete="email" autocapitalize="off" spellcheck="false" />
        </div>
        <button name="action" value="email">${busyLabel(say('page.email.save'))}</button>
        ${note ? `<p class="now said">${say(note)}</p>` : ''}
      </form></details>
      ${state ? `<form method="post"><p class="hint">${say('page.feedback.detail')}</p><button name="action" value="${state.feedbackOptOut ? 'feedback-on' : 'feedback-off'}">${say(state.feedbackOptOut ? 'page.feedback.on' : 'page.feedback.off')}</button></form>` : ''}
    </section>

    <section class="account-section" aria-labelledby="data-heading">
      <h2 id="data-heading">${say('page.section.data')}</h2>
      ${rest}
    </section>
    <script>
      try {
        var row = document.getElementById('times');
        var move = document.getElementById('move-call');
        var centre = function (el, smooth) {
          var box = el.getBoundingClientRect(), track = row.getBoundingClientRect();
          row.scrollTo({ left: row.scrollLeft + box.left - track.left - (row.clientWidth - box.width) / 2, behavior: smooth ? 'smooth' : 'auto' });
        };
        move.addEventListener('toggle', function () {
          var on = row.querySelector('input:checked');
          if (move.open && on) centre(on.parentNode, false);
        });
        row.addEventListener('change', function (e) { centre(e.target.parentNode, true); });
      } catch (e) {}
    </script>
  `,
    language,
  );
}

/** Which clock the times are on: "Norwegian time", or the slot's own place. SCRIPT.md §19. */
function zoneLine(timezone: string, script: ScriptLines): string {
  if (timezone === 'Europe/Oslo') return script.get('time.zone.home') ?? '';
  const city = (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ');
  return (script.get('time.zone.other') ?? '').replace('{{zone}}', city);
}

/** A line added to the goals from the page. Long enough for a sentence or two, not an essay. */
export const GOALS_MAX = 400;

/**
 * The Forever mark, still. brand/assets/mark.svg, inlined so the page makes
 * no second request; the line is `currentColor` so it follows the theme and
 * the dot stays Gold. It does not turn here: this page is for doing something
 * and leaving, and a moving logo is one more thing competing for the thumb.
 */
export const MARK = `<header class="lockup"><span class="sr">8&amp;80</span><svg class="mark" viewBox="12 31 96 58" aria-hidden="true" focusable="false"><path d="M51 60C46 50 37 46 31 46C23 46 17 52 17 60C17 68 23 74 31 74C37 74 46 70 51 60C57 46 69 36 81 36C95 36 103 47 103 60C103 73 95 84 81 84C69 84 57 74 51 60Z" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><circle cx="31" cy="60" r="5" fill="#E2B653"/></svg></header>`;

/**
 * Where a browser that does not know anybody lands.
 *
 * The cookie is gone, lapsed, or was never there. Not an error, and not a
 * sign-in: the way in is the link in any text, and the page says so.
 */
export function unknownBrowserPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(`${MARK}<h1>${say('page.browser.gone')}</h1><p class="now">${say('page.browser.gone.detail')}</p><a class="save" href="/access">${say('access.title')}</a>`, language);
}

/**
 * Asked before the calls end, and only here.
 *
 * The one control on this page a mis-tap must not be able to finish the
 * arrangement with — it is opened one-thumbed, often walking. Everything else
 * here is undoable next Tuesday; this is not, without coming back.
 *
 * It is still one tap away and says plainly what it does. A confirm step is a
 * courtesy; three of them, a survey and a "we're sorry to see you go" are a
 * product arguing with somebody who has already decided.
 */
export function confirmStopPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(
    `<h1>${say('page.stop.confirm')}</h1>
     <p class="now">${say('page.stop.detail')}</p>
     <form method="post">
       <button name="action" value="stop-confirm" class="primary">${busyLabel(say('page.stop.yes'))}</button>
     </form>
     <form method="post">
       <button name="action" value="stop-cancel">${busyLabel(say('page.stop.no'))}</button>
     </form>`,
    language,
  );
}

/**
 * After the calls have stopped, with the way back on it.
 *
 * Somebody who stopped by texting STOP has a number the carrier will not
 * deliver to, so START can never reach them and the way back cannot live only
 * in a message. This link still works.
 */
export function stoppedPage(script: ScriptLines, language = 'en', via: 'link' | 'browser' = 'link'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(
    `<h1>${say('page.stopped')}</h1>
     <form method="post" class="skip">
       <button name="action" value="start" class="quiet">${say('page.stopped.back')}</button>
     </form>
     ${
       via === 'link'
         ? `<form method="post" class="stop">
       <button name="action" value="forget" class="quiet">${say('page.forget')}</button>
     </form>`
         : ''
     }`,
    language,
  );
}

/**
 * Asked before everything is deleted.
 *
 * Stopping and deleting are different and the page has to say which is which:
 * stopping keeps the record so starting again is one tap, and this does not
 * keep anything. The detail line says so in the words somebody would use.
 */
export function confirmForgetPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(
    `<h1>${say('page.forget.confirm')}</h1>
     <p class="now">${say('page.forget.detail')}</p>
     <form method="post">
       <button name="action" value="forget-confirm" class="primary">${busyLabel(say('page.forget.yes'))}</button>
     </form>
     <form method="post">
       <button name="action" value="stop-cancel">${busyLabel(say('page.forget.no'))}</button>
     </form>`,
    language,
  );
}

/**
 * After. There is no link back on this page because there is nothing to go
 * back to — the token it was reached by has been deleted along with everything
 * else, so this is the last page that link will ever render.
 */
export function forgottenPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(`<h1>${say('page.forgotten')}</h1>`, language);
}

export function donePage(message: string, script: ScriptLines, language = 'en', back = '/me'): string {
  return shell(`<h1>${esc(message)}</h1><p class="now">${esc(script.get('page.close') ?? '')}</p><a class="save" href="${esc(back)}">${esc(script.get('page.back') ?? '')}</a>`, language);
}

export function exportFailedPage(script: ScriptLines, language = 'en', back = '/me'): string {
  return shell(`<h1>${esc(script.get('page.export.failed.title') ?? '')}</h1><p class="now">${esc(script.get('page.export.failed') ?? '')}</p><a class="save" href="${esc(back)}">${esc(script.get('page.back') ?? '')}</a><p><a href="mailto:${esc(config.company.supportEmail() || 'hei@8and80.me')}">${esc(script.get('page.support') ?? '')}</a></p>`, language);
}

export function gonePage(script: ScriptLines, language = 'en'): string {
  return shell(
    `<h1>${esc(script.get('page.expired') ?? '')}</h1>
     <p class="now">${esc(script.get('page.expired.detail') ?? '')}</p>
     <a class="save" href="/access">${esc(script.get('access.title') ?? '')}</a>`,
    language,
  );
}

export function shell(body: string, language = 'en'): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>8&amp;80</title>
<style>
  /*
   * BRAND.md §6. Light is the default here and only here: this page is opened in
   * daylight, one-thumbed, usually within a minute of the text arriving, whereas
   * the call itself is an evening thing. Gold fails on Paper at 1.6:1, so the
   * filled button is Pine on light and Gold on dark — the one place the two
   * accents swap jobs.
   */
  :root {
    color-scheme: light dark;
    --ink: #2F4A3A;        /* Pine on Paper, 8.4:1 */
    --bg: #F4EDE1;         /* Paper */
    --line: #D9D6C9;
    --quiet: #5A695E;      /* 5.0:1 on Paper */
    --accent: #2F4A3A;     /* Pine — the filled button */
    --on-accent: #F4EDE1;  /* Paper on Pine, 8.4:1 */
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #F4F1E8;      /* Chalk on Night, 13.5:1 */
      --bg: #1A2920;       /* Night */
      --line: #414D44;
      --quiet: #9DA198;    /* 5.8:1 on Night */
      --accent: #E2B653;   /* Gold, 8.0:1 on Night */
      --on-accent: #1A2920;/* Night on Gold, 8.0:1 */
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--ink);
    font: 17px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 26rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 .35rem; letter-spacing: -0.01em; }
  h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .9rem; }
  .account-section { border-top: 1px solid var(--line); padding-top: 1.25rem; margin-top: 1.5rem; }
  .account-section .move { border-top: 0; padding-top: 0; margin-top: 1rem; }
  .call-overview { border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 1rem; padding: 1.25rem; margin-top: 1.25rem; }
  .call-overview h2 { margin-bottom: .65rem; }
  .appointment { display: block; }
  .appointment-date { display: block; font-size: 1.5rem; font-weight: 600; line-height: 1.3; letter-spacing: -.02em; }
  .appointment-time { display: block; margin-top: .25rem; font-size: 3rem; font-weight: 600; line-height: 1.2; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .appointment-time small { font-size: 1rem; font-weight: 400; letter-spacing: 0; }
  .call-overview .usual-time { margin: .5rem 0 1.25rem; }
  .contact-link { display: inline-block; font-weight: 600; }
  .change-time { margin-bottom: 1rem; }
  .change-time summary { padding: .85rem 1rem; border: 1px solid var(--line); border-radius: .5rem; cursor: pointer; }
  .change-time summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .reschedule summary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
  .now { color: var(--quiet); margin: 0 0 2rem; }
  form { margin: 0 0 1rem; }
  .row { display: flex; gap: .5rem; margin: .4rem 0 .75rem; }
  label { display: block; font-size: .95rem; color: var(--quiet); }
  select, input[type=time] {
    flex: 1; padding: .7rem .6rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .5rem;
  }
  button {
    width: 100%; padding: .85rem 1rem; font: inherit; border-radius: .5rem; cursor: pointer;
    border: 1px solid var(--line); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.quiet { border: 0; color: var(--quiet); }
  /* A link, because a download is not a form post; dressed as the filled button. */
  a.save {
    display: block; padding: .85rem 1rem; border-radius: .5rem; text-align: center; text-decoration: none;
    font-weight: 600; background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent);
  }
  a.save + .hint { margin-bottom: 1.5rem; }
  ${BUSY_CSS}
  .always { display: flex; align-items: center; gap: .5rem; margin: .75rem 0 .75rem; }
  .always input { width: auto; }
  .move { border-top: 1px solid var(--line); padding-top: 1.25rem; margin-top: 1.25rem; }
  .skip, .stop.first { margin-top: 1.5rem; }
  /* Below the things somebody came here to do, and still plainly named. */
  .stop { margin-top: .25rem; }
  .hint { color: var(--quiet); font-size: .9rem; margin: .4rem 0 .75rem; }
  .centre { text-align: center; }
  .said { margin: .75rem 0 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .lockup { display: flex; justify-content: center; margin: 0 0 1.75rem; }
  .mark { width: 3rem; height: auto; display: block; }
  textarea {
    display: block; width: 100%; margin: .4rem 0 0; padding: .7rem .75rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .5rem; resize: vertical;
  }
  a { color: var(--ink); }
  input[type=tel], input[type=text] { display: block; width: 100%; margin: .4rem 0 1rem; }
  input[type=email], input[type=tel], input[type=text] {
    flex: 1; min-width: 0; padding: .7rem .6rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .5rem;
  }

  /*
   * The day and the time, as the sign-up page picks them: radios under pills,
   * so a tap is a native choice and moving a call needs no script.
   */
  fieldset { border: 0; padding: 0; margin: 0 0 .75rem; min-width: 0; }
  legend { padding: 0; margin: 0 0 .15rem; font-size: .95rem; color: var(--quiet); }
  .zone { margin: 0 0 .5rem; font-size: .85rem; color: var(--quiet); }
  .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: .3rem; }
  .times {
    display: flex; gap: .3rem; margin-top: .5rem; padding: .1rem 1.5rem; scroll-padding-inline: 1.5rem;
    overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; overscroll-behavior-x: contain;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent);
  }
  .times::-webkit-scrollbar { display: none; }
  .times .pick { flex: 0 0 4.4rem; scroll-snap-align: center; }
  .pick { position: relative; display: block; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .pick input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  .pick span:first-of-type {
    display: flex; align-items: center; justify-content: center; min-height: 2.9rem;
    border: 1px solid var(--line); border-radius: .75rem; color: var(--ink);
    font-size: .95rem; font-variant-numeric: tabular-nums;
  }
  .pick input:checked + span { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
  .pick input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body><main>${body}</main>${BUSY}${MOTION}</body>
</html>`;
}


export function confirmBillingPage(script: ScriptLines, action: string, back: string): string {
  return shell(`<h1>${esc(script.get('page.cancel.title') ?? '')}</h1><p class="now">${esc(script.get('page.cancel.detail') ?? '')}</p>
    <form method="post"><button name="action" value="${esc(action)}" class="primary">${esc(script.get('page.cancel.confirm') ?? '')}</button></form>
    <p><a href="${esc(back)}">${esc(script.get('page.cancel.back') ?? '')}</a></p>`);
}
