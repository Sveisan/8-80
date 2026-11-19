import { BRAND_HEAD } from '../design-system/head.ts';
import { ACCOUNT_CSS } from '../design-system/pages.ts';
import { FOUNDATION_CSS, CONTROL_CSS } from '../design-system/styles.ts';
import { checkoutLink } from '../billing/notice.ts';
import { config } from '../config.ts';
import { beliefConfig } from '../beliefs/config.ts';
import { femaleVoiceReady, sameMessageNumber } from '../agent/voices.ts';
import { maskEmail, type AccountState } from './account.ts';
import { encouragementSection, type EncouragementView } from '../encouragement/page.ts';
import type { ScriptLines } from '../script.ts';
import { describeAppointment, nextSlotAfter, type Slot } from '../schedule/time.ts';
import { BUSY, MOTION, busyLabel } from '../signup/mascot.ts';
import { bookingDay, bookingDays, dayValue, moveVersion, type MoveDraft } from './move.ts';
import { feedbackWidget } from '../product-feedback/widget.ts';
import { googleCalendarConfig, googleCalendarReady } from '../calendar/google-config.ts';

/** Weekday names come from the locale, not from a list in this file. */
const dayNames = (language: string): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' });
  // 2026-09-06 was a Sunday, so index 0 is Sunday as everywhere else here.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Monday first, the way a week is written down here. Values stay Sunday-is-0. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** How the page was reached, and so what it may offer. */
export interface PageView {
  encouragement?: EncouragementView;
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
   * Offer the contact card before and after the first call, only when there is
   * a number to put on it: a card with no number, or the wrong one, is worse
   * than none — it is saved, and then never matches.
   */
  contact?: boolean;
  /** Offer the field for adding to this year's goals. Only once a call has made the list. */
  goals?: boolean;
  /** A `page.goals.*` key, when the last attempt to add said something. */
  goalsNote?: string;
  scheduleNote?: string;
  scheduleMessage?: string;
  preferenceNote?: string;
  moveDraft?: MoveDraft;
  now?: Date;
}

function moveEditor(
  scope: MoveDraft['scope'], slot: Slot, script: ScriptLines, language: string, view: PageView, appointment?: Date,
): string {
  const say = (id: string) => esc(script.get(id) ?? '');
  const now = view.now ?? new Date();
  const draft = view.moveDraft?.scope === scope ? view.moveDraft : undefined;
  const current = appointment ?? nextSlotAfter(now, slot);
  const currentTime = scope === 'weekly' ? clock(slot.minute) : new Intl.DateTimeFormat('en-GB', {
    timeZone: slot.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(current);
  const selectedDay = draft?.day ?? (scope === 'weekly' ? String(slot.weekday) : dayValue(bookingDay(current, slot.timezone)));
  const selectedTime = draft?.time ?? currentTime;
  const option = (value: string, label: string, initial: string) =>
    `<option value="${esc(value)}"${value === initial ? ' selected' : ''}>${esc(label)}</option>`;
  const calendar = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const names = dayNames(language);
  const days = scope === 'weekly'
    ? WEEK.map(day => option(String(day), names[day]!, selectedDay))
    : bookingDays(now, slot.timezone, current).map(date => option(dayValue(date), calendar.format(date), selectedDay));
  // Keep the familiar calling hours while preserving bookings made by text at other times.
  const earliest = currentTime < '06:00' ? currentTime : '06:00';
  const latest = currentTime > '22:00' ? currentTime : '22:00';
  const heading = scope === 'weekly' ? 'page.move.open.weekly' : scope === 'first' ? 'page.move.open.first'
    : appointment ? 'page.move.open' : 'page.move.open.unscheduled';
  return `<details id="${scope === 'weekly' ? 'move-weekly' : 'move-call'}" class="change-time ${scope === 'weekly' ? 'weekly-editor' : 'reschedule'}"${draft ? ' open' : ''}>
        <summary>${say(heading)}</summary>
        <form method="post" action="?" class="move">
          <input type="hidden" name="scope" value="${scope}" />
          <input type="hidden" name="version" value="${esc(moveVersion(slot, view.account?.scheduledAt))}" />
          <p class="zone" id="${scope}-zone">${esc(zoneLine(slot.timezone, script))}</p>
          <div class="move-fields">
            <div>
              <label for="${scope}-day">${say(scope === 'weekly' ? 'page.move.weekday' : 'page.move.date')}</label>
              <select id="${scope}-day" name="day" aria-describedby="${scope}-zone">${days.join('')}</select>
            </div>
            <div>
              <label for="${scope}-time">${say('page.move.time')}</label>
              <input type="time" id="${scope}-time" name="time" value="${esc(selectedTime)}"
                     min="${earliest}" max="${latest}" aria-describedby="${scope}-zone" required />
            </div>
          </div>
          <p class="hint">${say(`page.move.scope.${scope}`)}</p>
          <button name="action" value="move-review" class="primary">${busyLabel(say('page.move.review'))}</button>
        </form>
      </details>`;
}

export function reviewMovePage(draft: MoveDraft, at: Date, slot: Slot, version: string, script: ScriptLines, language = 'en'): string {
  const say = (id: string) => esc(script.get(id) ?? '');
  const when = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    timeZone: slot.timezone, weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at);
  return shell(`<h1>${say('page.move.review')}</h1>
    <p class="review-appointment"><time datetime="${esc(at.toISOString())}">${esc(when)}</time></p>
    <p class="zone">${esc(zoneLine(slot.timezone, script))}</p>
    <p class="hint">${say(`page.move.scope.${draft.scope}`)}</p>
    <form method="post" action="?" class="review-actions">
      <input type="hidden" name="scope" value="${draft.scope}" />
      <input type="hidden" name="day" value="${esc(draft.day)}" />
      <input type="hidden" name="time" value="${esc(draft.time)}" />
      <input type="hidden" name="version" value="${esc(version)}" />
      <input type="hidden" name="proposed_at" value="${esc(at.toISOString())}" />
      <button name="action" value="move-save" class="primary">${busyLabel(say('page.move'))}</button>
      <button name="action" value="move-edit">${say('page.move.edit')}</button>
    </form>`, language);
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
 * Dated and weekly changes each start from the time they edit, then show the
 * resulting date and scope in a server-rendered review before saving.
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
  const via = view.via ?? 'link';
  const state = view.account;
  const active = !state || (state.canCall && !state.paused);
  const arranging = active && !state?.onHold;
  const first = arranging ? view.first : undefined;
  const booking = view.beforeFirst ?? !!first;
  const when = `${days[slot.weekday]} ${clock(slot.minute)}`;

  const appointment = arranging ? first ?? view.next : undefined;
  const locale = language === 'en' ? 'en-GB' : language;
  const appointmentDate = appointment ? new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: slot.timezone,
  }).format(appointment) : '';
  const appointmentClock = appointment ? new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: slot.timezone,
  }).format(appointment) : '';
  const appointmentZone = zoneLine(slot.timezone, script);

  const title = state?.onHold ? 'page.held' : state && !state.canCall ? 'page.ended'
    : state?.paused ? 'page.account.paused' : first && view.fresh ? 'page.booked' : 'page.title';
  const supportHref = `mailto:${esc(config.company.supportEmail() || 'hei@8and80.me')}`;
  const priorityContact = booking && !!appointment;
  const contact = view.contact
    ? `<a class="${priorityContact ? 'save' : 'account-link'}" href="/contact.vcf" download="8and80.vcf"${priorityContact ? ' aria-describedby="contact-help"' : ''}>${say('page.contact.save')}</a>` : '';

  const goals = view.goals && arranging
    ? `
    <details class="change-time goal-editor"${view.goalsNote ? ' open' : ''}>
    <summary>${say('page.goals.open')}</summary>
    <form method="post" class="move">
      <label for="goals">${say('page.goals.label')}</label>
      <textarea id="goals" name="goals" rows="3" maxlength="${GOALS_MAX}" placeholder="${say('page.goals.example')}" aria-describedby="goals-detail" required></textarea>
      <p class="hint" id="goals-detail">${say('page.goals.detail')}</p>
      <button name="action" value="goals">${busyLabel(say('page.goals.save'))}</button>
      ${view.goalsNote ? `<p role="status" class="now said">${say(view.goalsNote)}</p>` : ''}
    </form></details>`
    : '';

  const rest =
    via === 'link'
      ? `
    <form method="post" class="stop">
      <button name="action" value="export">${say('page.export')}</button>
    </form>

    <form method="post" class="stop">
      <button name="action" value="forget" class="danger">${say('page.forget')}</button>
    </form>`
      : `<p class="hint">${say('page.browser.rest')}</p><a class="account-link" href="/access">${say('access.verify')}</a>`;

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
  const renewal = state?.cancelAtPeriodEnd ? `<p class="hint">${esc((script.get(state.canCall ? 'page.cancel.until' : 'page.cancel.ended') ?? '').replace('{{when}}', paidDate || (script.get('page.cancel.unknown') ?? '')))}</p>` : '';
  const billingControls = state ? state.subscribed && state.billing !== 'ended'
    ? via === 'link' ? `<form method="post" action="?"><button name="action" value="billing-portal">${say('page.billing.manage')}</button></form>${!state.cancelAtPeriodEnd ? `<form method="post" action="?"><button name="action" value="cancel-renewal">${say('page.cancel.action')}</button></form>` : ''}`
      : `<a class="account-link" href="/access">${say('page.billing.verify')}</a>`
    : ['trialing', 'trial_ended', 'ended'].includes(state.billing) ? checkoutLink('availability-check') ? `<form method="post"><button name="action" value="checkout"${!state.canCall ? ' class="primary"' : ''}>${say('page.billing.continue')}</button></form><p class="hint">${say('page.billing.price')}</p>` : `<p class="hint">${say('page.billing.unavailable')}</p>` : '' : '';
  const billing = state ? `<p class="hint">${esc((script.get(billingKey) ?? '').replace('{{when}}', trialDate ?? ''))}</p>` : '';
  const plan = state || active ? `<section class="account-section plan-section" aria-labelledby="plan-heading">
    <h2 id="plan-heading">${say('page.account.plan')}</h2>
    ${billing}
    ${renewal}
    ${state?.paused && state.subscribed && !state.cancelAtPeriodEnd && ['active', 'past_due'].includes(state.billing)
      ? `<p class="hint">${say('page.account.paused.billing')}</p>` : ''}
    ${billingControls}
    ${active ? `<form method="post" action="?"><button name="action" value="stop">${say('page.account.pause')}</button></form>` : ''}
    <a class="account-link" href="${supportHref}">${say('page.support')}</a>
  </section>` : '';
  const planFirst = !arranging || state?.cancelAtPeriodEnd || state?.billing === 'past_due';
  const status = view.scheduleMessage ?? (view.scheduleNote ? script.get(view.scheduleNote) : undefined);
  const preferenceState = (enabled: boolean | undefined) => say(enabled ? 'page.account.on' : 'page.account.off');
  const preferencesOpen = note || view.preferenceNote || view.encouragement?.note;

  return shell(
    `
    <header class="account-header">
      <a class="account-brand" href="/start">${MARK_ICON}<span>8&amp;80</span></a>
      <a href="${supportHref}">${say('page.account.help')}</a>
    </header>
    <h1>${say(title)}</h1>
    ${status ? `<p class="account-notice" role="status">${esc(status)}</p>` : ''}
    ${state?.onHold ? `<p class="account-intro">${say('page.held.detail')}</p>`
      : state && !state.canCall ? `<p class="account-intro">${say('page.ended.detail')}</p>`
      : state?.paused ? `<p class="account-intro">${say('page.account.resume.detail')}</p>
        <form method="post" action="?" class="resume"><button name="action" value="start" class="primary">${say('page.account.resume')}</button></form>` : ''}
    ${arranging ? `<section class="account-section call-overview" aria-labelledby="call-heading">
      <h2 id="call-heading">${say(booking ? 'page.first' : 'page.section.call')}</h2>
      ${appointment ? `<time class="appointment" datetime="${esc(appointment.toISOString())}" aria-label="${esc(describeAppointment(appointment, slot.timezone, language))}"
        data-timezone="${esc(slot.timezone)}" data-locale="${esc(locale)}" data-home="${say('time.zone.home')}" data-other="${say('time.zone.other')}">
        <span class="appointment-date">${esc(appointmentDate)}</span>
        <span class="appointment-time"><span class="appointment-clock">${esc(appointmentClock)}</span> <small class="appointment-zone">${esc(appointmentZone)}</small></span>
      </time>
      <p class="hint booking-clock" hidden>${say('page.account.booking_clock')} · ${esc(appointmentDate)} · ${esc(appointmentClock)} · ${esc(appointmentZone)}</p>`
        : `<p class="account-intro">${say(state?.trialEnds ? 'page.no_next.trial' : 'page.no_next')}</p>`}
      ${booking && appointment ? `<div class="first-call">
        <p class="hint" id="contact-help">${say('page.account.incoming')}${contact ? ` ${say('page.contact.first')}` : ''}</p>
        ${contact}
      </div>` : ''}
      ${moveEditor(booking ? 'first' : 'once', slot, script, language, view, appointment)}
      ${booking || !view.next ? '' : `<form method="post" action="?" class="skip">
        <input type="hidden" name="skip_at" value="${esc(view.next.toISOString())}" />
        <button name="action" value="skip">${say('page.skip')}</button>
      </form>`}
      <div class="weekly-time">
        <h3>${say('page.account.weekly')}</h3>
        <p class="hint usual-time">${esc(when)} · ${esc(appointmentZone)}</p>
        ${booking ? '' : moveEditor('weekly', slot, script, language, view)}
      </div>
    </section>` : ''}

    ${planFirst ? plan : ''}
    ${view.goals ? `<section class="account-section notes-section" aria-labelledby="notes-heading">
      <h2 id="notes-heading">${say('page.section.notes')}</h2>
      <p class="hint">${say('page.notes.detail')}</p>
      <a class="account-link" href="/memory">${say('page.account.notes')}</a>
      ${goals}
    </section>` : ''}
    ${planFirst ? '' : plan}

    <details id="preferences" class="account-disclosure"${preferencesOpen ? ' open' : ''}>
      <summary>${say('page.account.preferences')}</summary>
      <div class="settings-content">
        ${view.preferenceNote ? `<p role="status" class="account-notice">${say(view.preferenceNote)}</p>` : ''}
        <p class="hint">${email ? esc((script.get('page.email.current') ?? '').replace('{{email}}', maskEmail(email))) : say('page.email.none')}</p>
        <details class="change-time"${note ? ' open' : ''}>
          <summary>${say('page.email.open')}</summary>
          <form method="post" action="?#preferences">
            <label for="email">${say('page.email.label')}</label>
            <div class="row">
              <input type="email" id="email" name="email" value="" placeholder="you@example.com"
                     autocomplete="email" autocapitalize="off" spellcheck="false" />
            </div>
            <button name="action" value="email">${busyLabel(say('page.email.save'))}</button>
            ${note ? `<p role="status" class="now said">${say(note)}</p>` : ''}
          </form>
        </details>
        ${state ? `<form method="post" action="?#preferences" class="settings-item">
          <h3>${say('page.account.calendar')} <small>${preferenceState(state.calendarInvitesEnabled)}</small></h3>
          <p class="hint">${say(state.googleCalendarInvites ? 'calendar.google.invite' : 'calendar.preference.detail')}</p>
          <button name="action" value="${state.calendarInvitesEnabled ? 'calendar-off' : 'calendar-on'}"${!email && !state.calendarInvitesEnabled ? ' disabled' : ''}>${say(state.calendarInvitesEnabled ? 'calendar.preference.off' : 'calendar.preference.on')}</button>
          ${!email ? `<p class="hint">${say('calendar.preference.email')}</p>` : ''}
        </form>` : ''}
        ${state?.calendarInvitesEnabled && !state.googleCalendarInvites && googleCalendarConfig().enabled && googleCalendarReady()
          ? `<form method="post" action="?#preferences"><p class="hint">${say('calendar.google.upgrade.detail')}</p><button name="action" value="calendar-google">${say('calendar.google.upgrade')}</button></form>` : ''}
        ${state && (femaleVoiceReady() || state.voice === 'female') ? `<form method="post" action="?#preferences" class="settings-item">
          <label for="voice">${say('page.account.voice')}</label>
          <select id="voice" name="voice"><option value="male"${state.voice !== 'female' ? ' selected' : ''}>${say('signup.voice.male')}</option><option value="female"${state.voice === 'female' ? ' selected' : ''}${!femaleVoiceReady() ? ' disabled' : ''}>${say('signup.voice.female')}</option></select>
          <button name="action" value="voice">${say('page.voice.save')}</button>
        </form>` : ''}
        ${state && (sameMessageNumber() || state.nudgesEnabled) ? `<form method="post" action="?#preferences" class="settings-item">
          <h3>${say('page.account.nudges')} <small>${preferenceState(state.nudgesEnabled)}</small></h3>
          <p class="hint">${say('signup.nudges.detail')}</p>
          <button name="action" value="${state.nudgesEnabled ? 'nudges-off' : 'nudges-on'}">${say(state.nudgesEnabled ? 'page.nudges.off' : 'page.nudges.on')}</button>
        </form>` : ''}
        ${state ? `<form method="post" action="?#preferences" class="settings-item">
          <h3>${say('page.account.feedback')} <small>${preferenceState(!state.feedbackOptOut)}</small></h3>
          <p class="hint">${say('page.feedback.detail')}</p>
          <button name="action" value="${state.feedbackOptOut ? 'feedback-on' : 'feedback-off'}">${say(state.feedbackOptOut ? 'page.feedback.on' : 'page.feedback.off')}</button>
        </form>` : ''}
        ${view.encouragement ? `<details class="change-time"${view.encouragement.note ? ' open' : ''}>
          <summary>Encouragement by SMS</summary>${encouragementSection(view.encouragement)}
        </details>` : ''}
        ${priorityContact ? '' : contact}
      </div>
    </details>

    <details class="account-disclosure">
      <summary>${say('page.account.data')}</summary>
      <div class="settings-content">${rest}<a class="account-link" href="/privacy">${say('access.privacy')}</a></div>
    </details>
    ${beliefConfig().enabled ? '<footer class="account-footer"><a class="account-link" href="/beliefs">Explore Belief practice</a></footer>' : ''}
    <script>
      // Display the booked instant on the viewer's clock. The stored weekly
      // slot and its picker keep their explicitly labelled booking timezone.
      // Without JavaScript or a usable local zone, the server-rendered booking
      // timezone remains readable (Oslo is the booking default).
      try {
        var appointment = document.querySelector('time.appointment');
        if (appointment) {
          var at = new Date(appointment.getAttribute('datetime'));
          var locale = appointment.getAttribute('data-locale');
          var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || appointment.getAttribute('data-timezone') || 'Europe/Oslo';
          var date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(at);
          var time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(at);
          var label = zone === 'Europe/Oslo' ? appointment.getAttribute('data-home') : appointment.getAttribute('data-other').replace('{{zone}}', zone.split('/').pop().replace(/_/g, ' '));
          appointment.querySelector('.appointment-date').textContent = date;
          appointment.querySelector('.appointment-clock').textContent = time;
          appointment.querySelector('.appointment-zone').textContent = label;
          appointment.setAttribute('aria-label', date + ' ' + time + ' ' + label);
          var original = document.querySelector('.booking-clock');
          if (original) original.hidden = zone === appointment.getAttribute('data-timezone');
        }
      } catch (e) {}
    </script>
  `,
    language,
    'weekly-account',
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
const MARK_ICON = `<svg class="mark" viewBox="12 31 96 58" aria-hidden="true" focusable="false"><path d="M51 60C46 50 37 46 31 46C23 46 17 52 17 60C17 68 23 74 31 74C37 74 46 70 51 60C57 46 69 36 81 36C95 36 103 47 103 60C103 73 95 84 81 84C69 84 57 74 51 60Z" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><circle cx="31" cy="60" r="5" fill="#E2B653"/></svg>`;
export const MARK = `<header class="lockup"><span class="sr">8&amp;80</span>${MARK_ICON}</header>`;

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
    `<h1>${say('page.account.pause.confirm')}</h1>
     <p class="now">${say('page.stop.detail')}</p>
     <form method="post">
       <button name="action" value="stop-confirm" class="primary">${busyLabel(say('page.account.pause'))}</button>
     </form>
     <form method="post">
       <button name="action" value="stop-cancel">${busyLabel(say('page.account.pause.keep'))}</button>
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

export function shell(body: string, language = 'en', bodyClass?: 'weekly-account'): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>${BRAND_HEAD}
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
${FOUNDATION_CSS}${CONTROL_CSS}${ACCOUNT_CSS}
</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}><!--email_off--><main>${body}</main>${BUSY}${MOTION}${feedbackWidget()}<!--/email_off--></body>
</html>`;
}


export function confirmBillingPage(script: ScriptLines, action: string, back: string): string {
  return shell(`<h1>${esc(script.get('page.cancel.title') ?? '')}</h1><p class="now">${esc(script.get('page.cancel.detail') ?? '')}</p>
    <form method="post"><button name="action" value="${esc(action)}" class="primary">${esc(script.get('page.cancel.confirm') ?? '')}</button></form>
    <p><a href="${esc(back)}">${esc(script.get('page.cancel.back') ?? '')}</a></p>`);
}
