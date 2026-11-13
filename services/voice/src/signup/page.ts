import { BRAND_HEAD } from '../design-system/head.ts';
import { SIGNUP_CSS } from '../design-system/pages.ts';
import { FOUNDATION_CSS, CONTROL_CSS } from '../design-system/styles.ts';
import { femaleVoiceReady, sameMessageNumber } from '../agent/voices.ts';
import type { ScriptLines } from '../script.ts';
import { readBookingSlot, type Invalid, type Signup } from './form.ts';
import { describeAppointment, nextSlotAfter } from '../schedule/time.ts';
import { BUSY, MOTION, busyLabel, mascot } from './mascot.ts';
import { timePicker, TIME_PICKER_SCRIPT } from './time-picker.ts';
import { feedbackWidget } from '../product-feedback/widget.ts';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Short names for the chips, long ones for the screen reader. Sunday is 0. */
const dayNames = (language: string, weekday: 'long' | 'short' = 'long'): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

/** Monday first, the way a week is written down here. Values stay Sunday-is-0. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * Every quarter hour from six in the morning to ten at night, as one row of
 * radio buttons you swipe along. Numbers only, so there is no English here,
 * and radios, so it works with scripts off. A call outside these hours can be
 * moved to from the link in any text. Quarters rather than halves: the
 * owner's call on 2026-09-29, so "in twenty minutes" is on the row.
 */
const FIRST = 6 * 60;
const LAST = 22 * 60;
const TIMES = Array.from({ length: (LAST - FIRST) / 15 + 1 }, (_, i) => clock(FIRST + i * 15));

/** Where the page opens: today, in Norway, the way the product is run. */
const HOME = 'Europe/Oslo';

/**
 * Today, and the first quarter hour at least fifteen minutes from now, in
 * Oslo — what the day and time rows start on, so the page opens at "now"
 * rather than on a Tuesday somebody has to scroll away from.
 *
 * Fifteen minutes of margin because the code still has to arrive and be typed:
 * a time that has passed by the moment the sign-up completes would quietly
 * make the first call next week. After the row's final time, offer tomorrow
 * at 08:00 rather than a time that has already passed today.
 */
export function startingPoint(now: Date): { weekday: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOME,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const next = Math.max(FIRST, Math.ceil((minute + 15) / 15) * 15);
  return { weekday: String(next <= LAST ? weekday : (weekday + 1) % 7), time: next <= LAST ? clock(next) : '08:00' };
}

/**
 * Questions under the form, for anything the page used to say above it.
 * Each pairs a question key with an answer already in SCRIPT.md §15; a pair
 * renders only once its question exists, so nothing here is English of its own.
 */
const FAQ: Array<[question: string, answer: string]> = [
  ['signup.faq.ai', 'signup.honest'],
  ['signup.faq.what', 'signup.what'],
  ['signup.faq.recap', 'signup.after'],
  ['signup.faq.move', 'signup.when.detail'],
  ['signup.faq.cost', 'signup.free'],
];

/** Which error message belongs to which field. SCRIPT.md §15. */
const ERROR_KEY: Record<Invalid['why'], string> = {
  name: 'signup.error.name',
  number: 'signup.error.number',
  email: 'signup.error.email',
  weekday: 'signup.error.weekday',
  time: 'signup.error.time',
  timezone: 'signup.error.timezone',
  voice: 'page.voice.unavailable',
  nudges: 'signup.nudges.unavailable',
};

export interface SignupFormState {
  errors?: Invalid[];
  note?: string;
  appointmentChecked?: boolean;
  values?: Partial<Record<'name' | 'phone' | 'email' | 'weekday' | 'time' | 'timezone' | 'voice' | 'nudges' | 'calendar', string>>;
}

/**
 * The only page a stranger sees.
 *
 * A headline, a service summary, contact fields, a day and a time. The fields keep visible labels after entry, the day is one tap, and the time is a row you
 * swipe and tap — nothing opens a picker. Everything else the page could say
 * waits in the questions at the bottom for whoever wants it.
 *
 * The honesty line sits above the form until `signup.faq.ai` exists, and then
 * becomes the first question at the bottom — the owner's call, made against
 * SCRIPT.md §15's "above the fold". It is first in the list so it is the first
 * thing anyone who opens the questions reads.
 *
 * Errors sit under the field they belong to, so somebody who mistyped their
 * number on a small screen does not have to scroll to find out which one.
 */
export function signupPage(
  script: ScriptLines,
  state: SignupFormState = {},
  language = 'en',
  now = new Date(),
): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const long = dayNames(language, 'long');
  const short = dayNames(language, 'short');
  const v = state.values ?? {};
  const wrong = new Map((state.errors ?? []).map((e) => [e.field as string, ERROR_KEY[e.why]]));
  const note = (field: string): string => {
    const key = wrong.get(field);
    return key ? `<p class="wrong" id="${field}-wrong">${say(key)}</p>` : '';
  };
  const start = startingPoint(now);
  const weekday = v.weekday || start.weekday;
  const time = TIMES.includes(v.time ?? '') ? (v.time as string) : start.time;
  const selection = readBookingSlot(new URLSearchParams({ weekday, time, timezone: v.timezone || HOME }), now);
  const appointment = selection.ok ? describeAppointment(nextSlotAfter(now, selection.slot), selection.slot.timezone, language) : '';
  const appointmentLine = (script.get('signup.appointment') ?? '').replace('{{when}}', appointment);
  const faq = FAQ.filter(([q, a]) => script.get(q) && script.get(a));
  const inFaq = (answer: string): boolean => faq.some(([, a]) => a === answer);
  const headline = script.get('signup.headline') ? 'signup.headline' : 'signup.title';
  // The claim, then its correction, set at different weights. Optional: without
  // it the headline is one line, which is what `signup.title` still is.
  const second = script.get('signup.headline.second') ? `<span>${say('signup.headline.second')}</span>` : '';

  const field = (name: string, label: string, type: string, extra = ''): string => {
    const describedBy = wrong.has(name) ? `${name}-wrong` : '';
    return `
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="${type}" value="${esc(v[name as keyof typeof v] ?? (name === 'phone' ? '+47 ' : ''))}"
             ${wrong.has(name) ? 'class="bad" aria-invalid="true"' : ''}
             ${describedBy ? `aria-describedby="${describedBy}"` : ''} ${extra} />
      ${note(name)}`;
  };

  return shell(
    `
    <div class="signup-layout">
    <section class="signup-intro" aria-labelledby="intro-heading">
    ${LOCKUP}
    <p class="eyebrow">${say('signup.eyebrow')}</p>
    <h1 id="intro-heading">${say(headline)}${second}</h1>
    ${inFaq('signup.honest') ? '' : `<p class="honest">${say('signup.honest')}</p>`}

    <p class="honest intro-summary">${say('signup.summary')}</p>
    <figure class="perspectives">
      <svg viewBox="0 0 440 170" aria-hidden="true" focusable="false">
        <path d="M80 100 C140 25 300 25 360 100" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
        <path d="M80 100 C140 156 300 156 360 100" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
        <circle cx="80" cy="92" r="43" fill="var(--gold)"/><circle cx="360" cy="92" r="43" fill="var(--ink)"/>
        <text x="80" y="108" text-anchor="middle" fill="#1A2920" font-size="48">8</text>
        <text x="360" y="108" text-anchor="middle" fill="var(--bg)" font-size="43">80</text>
        <circle cx="220" cy="92" r="5" fill="currentColor"/>
        <text x="220" y="121" text-anchor="middle" fill="currentColor" font-size="14">${say('signup.visual.today')}</text>
      </svg>
      <figcaption><span>${say('signup.visual.eight')}</span><span>${say('signup.visual.eighty')}</span></figcaption>
    </figure>
    <p class="intro-note">${say('signup.visual.detail')}</p>
    </section>
    <section class="booking-panel" aria-labelledby="booking-heading">
    <p class="eyebrow">${say('signup.booking.step')}</p>
    <h2 id="booking-heading">${say('signup.booking.title')}</h2>
    ${state.note ? `<p class="wrong" role="alert">${say(state.note)}</p>` : ''}
    ${note('timezone')}

    <form method="post" action="/start" novalidate>
      <div class="fields">
        ${field('name', say('signup.name'), 'text', 'autocomplete="given-name" autocapitalize="words" maxlength="80" enterkeyhint="next"')}
        ${field('phone', say('signup.phone'), 'tel', 'autocomplete="tel" inputmode="tel" enterkeyhint="next" required')}
        ${field('email', say(script.get('signup.email.short') ? 'signup.email.short' : 'signup.email'), 'email', 'autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done" required')}
      </div>

      ${femaleVoiceReady() ? `<fieldset class="voice-choice"><legend>${say('signup.voice')}</legend><div class="voice-options">
        ${(['male', 'female'] as const).map(voice => `<label class="pick"><input type="radio" name="voice" value="${voice}"${(v.voice || 'male') === voice ? ' checked' : ''}/><span>${say(`signup.voice.${voice}`)}</span></label>`).join('')}
      </div><p class="quiet small">${say('signup.voice.detail')}</p></fieldset>` : ''}
      ${note('voice')}
      <fieldset${v.weekday || v.time ? '' : ' data-auto'} id="when">
        <legend>${say('signup.when')}</legend>
        <p class="zone" id="zone" data-other="${say('time.zone.other')}">${say('time.zone.home')}</p>
        <div class="days">
          ${WEEK.map(
            (i) => `<label class="pick">
            <input type="radio" name="weekday" value="${i}"${String(i) === weekday ? ' checked' : ''} />
            <span aria-hidden="true">${esc(short[i] as string)}</span><span class="sr">${esc(long[i] as string)}</span>
          </label>`,
          ).join('')}
        </div>
        ${note('weekday')}
        ${timePicker(TIMES.map(
            (t) => `<label class="pick"><input type="radio" name="time" value="${t}"${t === time ? ' checked' : ''} /><span>${t}</span></label>`,
          ).join(''), script)}
        ${note('minute')}
      </fieldset>

      <input type="hidden" name="timezone" id="tz" value="${esc(v.timezone || HOME)}"${v.timezone ? ' data-preserved="1"' : ''} />
      <p class="quiet small appointment" id="first-appointment" aria-live="polite"
         data-format="${say('signup.appointment')}" data-pending="${say('signup.appointment.pending')}"
         data-unavailable="${say('signup.appointment.unavailable')}">${esc(appointmentLine)}</p>
      <noscript><style>#first-appointment { display: none; }</style>
        ${state.appointmentChecked && appointment ? `<p class="quiet small">${esc(appointmentLine)}</p>` : ''}
      </noscript>
      <div id="appointment-check">
        <p class="quiet small">${say('signup.appointment.check.detail')}</p>
        <button type="submit" formaction="/start/preview" formnovalidate>${say('signup.appointment.check')}</button>
      </div>
      <p class="quiet small">${say('signup.appointment.detail')}</p>
      ${sameMessageNumber() ? `<label class="nudge-choice"><input type="checkbox" name="nudges" value="yes"${v.nudges === 'yes' ? ' checked' : ''}/><span><strong>${say('signup.nudges')}</strong><small>${say('signup.nudges.detail')}</small></span></label>` : ''}
      ${note('nudges')}
      <label class="nudge-choice"><input type="checkbox" name="calendar" value="yes"${v.calendar === 'yes' ? ' checked' : ''}/><span><strong>${say('calendar.signup')}</strong><small>${say('calendar.preference.detail')}</small></span></label>
      <p class="quiet small" id="signup-verify">${say('signup.verify.detail')}</p>
      <button class="primary" aria-describedby="signup-verify">${busyLabel(say('signup.submit'))}</button>
      ${inFaq('signup.free') ? '' : `<p class="quiet small centre">${say('signup.free')}</p>`}
      <p class="quiet small centre">${say('signup.terms.summary')}</p>
    </form>
    </section>
    </div>
    <div class="returning">
      <p>${say('access.returning')}</p>
      <a href="/access">${say('access.title')} <span aria-hidden="true">&rarr;</span></a>
    </div>

    ${
      faq.length
        ? `<section class="faq">${faq
            .map(([q, a]) => `<details><summary>${say(q)}</summary><p>${say(a)}</p></details>`)
            .join('')}</section>`
        : ''
    }
    <p class="quiet small centre legal"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
    <script>
      // Fills the timezone and brings the chosen time to the middle of its row.
      // The form works without either: the zone falls back to Oslo, and the
      // row scrolls by hand.
      try { if (!document.getElementById('tz').hasAttribute('data-preserved')) document.getElementById('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      // Says which clock the times are on. Norwegian unless the phone is set
      // to somewhere else, and then that place — and, if nothing has been
      // picked yet, today and the next quarter hour on that clock instead of
      // Oslo's, so the zone named and the time marked always agree.
      try {
        var zone = document.getElementById('tz').value;
        if (zone && zone !== '${HOME}') {
          var label = document.getElementById('zone');
          var city = zone.split('/').pop().replace(/_/g, ' ');
          label.textContent = label.getAttribute('data-other').replace('{{zone}}', city);
          if (document.getElementById('when').hasAttribute('data-auto')) {
            var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
            var next = Math.max(${FIRST}, Math.ceil((m + 15) / 15) * 15);
            var t = next <= ${LAST} ? next : 480;
            var hhmm = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
            var nextDay = next <= ${LAST} ? d.getDay() : (d.getDay() + 1) % 7;
            var day = document.querySelector('input[name=weekday][value="' + nextDay + '"]');
            var time = document.querySelector('input[name=time][value="' + hhmm + '"]');
            if (day) day.checked = true;
            if (time) time.checked = true;
          }
        }
      } catch (e) {}
      // The server uses the same next-slot calculation as verified enrollment.
      // Only the slot travels in this request; contact details stay in the form.
      try {
        var preview = document.getElementById('first-appointment');
        var check = document.getElementById('appointment-check');
        var version = 0;
        var updateAppointment = function () {
          var request = ++version;
          var query = new URLSearchParams({
            weekday: document.querySelector('input[name=weekday]:checked').value,
            time: document.querySelector('input[name=time]:checked').value,
            timezone: document.getElementById('tz').value
          });
          preview.textContent = preview.getAttribute('data-pending');
          fetch('/start/appointment?' + query.toString(), { cache: 'no-store' })
            .then(function (response) { if (!response.ok) throw new Error('date unavailable'); return response.json(); })
            .then(function (answer) {
              if (request !== version) return;
              preview.textContent = preview.getAttribute('data-format').replace('{{when}}', answer.when);
              check.hidden = true;
            })
            .catch(function () {
              if (request !== version) return;
              preview.textContent = preview.getAttribute('data-unavailable');
              check.hidden = false;
            });
        };
        document.getElementById('when').addEventListener('change', updateAppointment);
        updateAppointment();
        setInterval(function () { if (!document.hidden) updateAppointment(); }, 60000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) updateAppointment(); });
      } catch (e) {}
      ${TIME_PICKER_SCRIPT}
    </script>
  `,
    language,
    true,
  );
}

/** After the form, before the caller exists. The code is the whole page. */
export function codePage(phone: string, script: ScriptLines, wrong?: string, language = 'en', draft?: { id: string; signup: Signup }, now = new Date()): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const notice = !draft && ['signup.code.expired', 'signup.code.toomany'].includes(wrong ?? '') ? 'signup.code.restart' : wrong;
  return shell(
    `
    <header class="lockup">${mascot('nudge')}</header>
    <h1>${say('signup.code.title')}</h1>
    <p class="quiet">${esc((script.get(wrong ? 'signup.code.pending' : 'signup.code.detail') ?? '').replace('{{phone}}', phone))}</p>
    ${draft ? `<p class="quiet">${esc((script.get('signup.code.booking') ?? '').replace('{{when}}', describeAppointment(nextSlotAfter(now, draft.signup), draft.signup.timezone, language)))}</p>` : ''}
    ${notice ? `<p class="wrong" id="code-error" role="alert">${say(notice)}</p>` : ''}
    <form method="post" action="/start/verify" id="verify">
      <input type="hidden" name="phone" value="${esc(phone)}" />
      ${draft ? `<input type="hidden" name="draft" value="${esc(draft.id)}" />` : ''}
      <label for="code" class="sr">${say('signup.code.label')}</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]{6}" maxlength="6" required autofocus class="code" enterkeyhint="go"${notice ? ' aria-invalid="true" aria-describedby="code-error"' : ''} />
      <button class="primary">${busyLabel(say('signup.code.submit'))}</button>
    </form>
    ${draft ? `<form method="post" action="/start/resend">
      <input type="hidden" name="draft" value="${esc(draft.id)}" />
      <button>${say('signup.code.resend')}</button>
    </form><form method="post" action="/start/edit">
      <input type="hidden" name="draft" value="${esc(draft.id)}" />
      <button class="quiet">${say('signup.code.edit')}</button>
    </form>` : `<form method="get" action="/start"><button class="quiet">${say('signup.code.again')}</button></form>`}
    <script>
      // When the phone autofills the code from the text, send it. The button
      // is still there for anyone who types it, or has scripts off.
      try {
        var code = document.getElementById('code'), sent = false;
        code.addEventListener('input', function () {
          if (!sent && /^\\d{6}$/.test(code.value)) { sent = true; var f = document.getElementById('verify'); f.requestSubmit ? f.requestSubmit() : f.submit(); }
        });
      } catch (e) {}
    </script>
  `,
    language,
  );
}

/** Verified, scheduled, and told when. */
export function welcomePage(signup: Signup, first: Date, script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const when = first.toLocaleString(language === 'en' ? 'en-GB' : language, {
    timeZone: signup.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return shell(
    `${LOCKUP}
     <h1>${esc((script.get('signup.done.title') ?? '').replace('{{when}}', when))}</h1>
     <p class="quiet">${say('signup.done.detail')}</p>`,
    language,
  );
}

/**
 * The mark alone, centred.
 *
 * It carried the name beside it, on the reasoning that this is the page where
 * nobody knows it yet. The owner's call on 2026-09-27 is that the headline
 * directly underneath already says what this is, and the name set twice within
 * an inch reads as a letterhead rather than a product. The mark keeps the
 * accessible name, so a screen reader still announces it.
 */
const LOCKUP = `<header class="lockup"><span class="visually-hidden">8&amp;80</span>${mascot('idle')}</header>`;

export { clock };

/**
 * BRAND.md §6. Paper and Pine on light, Chalk and Gold on Night, the same
 * tokens as the reschedule page. Written for a 360px screen first; a wider one
 * only gets more margin.
 */
function shell(body: string, language = 'en', wide = false): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>${BRAND_HEAD}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>8&amp;80</title>
<style>
${FOUNDATION_CSS}${CONTROL_CSS}${SIGNUP_CSS}
</style>
</head>
<body><main${wide ? ' class="signup-wide"' : ''}>${body}</main>${BUSY}${MOTION}${feedbackWidget()}</body>
</html>`;
}
