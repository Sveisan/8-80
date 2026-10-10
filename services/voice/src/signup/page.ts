import type { ScriptLines } from '../script.ts';
import { readBookingSlot, type Invalid, type Signup } from './form.ts';
import { describeAppointment, nextSlotAfter } from '../schedule/time.ts';
import { BUSY, BUSY_CSS, MOTION, busyLabel, mascot } from './mascot.ts';

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
};

export interface SignupFormState {
  errors?: Invalid[];
  note?: string;
  appointmentChecked?: boolean;
  values?: Partial<Record<'name' | 'phone' | 'email' | 'weekday' | 'time' | 'timezone', string>>;
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
    ${LOCKUP}
    <h1>${say(headline)}${second}</h1>
    ${inFaq('signup.honest') ? '' : `<p class="honest">${say('signup.honest')}</p>`}

    <p class="honest">${say('signup.summary')}</p>
    ${state.note ? `<p class="wrong" role="alert">${say(state.note)}</p>` : ''}
    ${note('timezone')}

    <form method="post" action="/start" novalidate>
      <div class="fields">
        ${field('name', say('signup.name'), 'text', 'autocomplete="given-name" autocapitalize="words" maxlength="80" enterkeyhint="next"')}
        ${field('phone', say('signup.phone'), 'tel', 'autocomplete="tel" inputmode="tel" enterkeyhint="next" required')}
        ${field('email', say(script.get('signup.email.short') ? 'signup.email.short' : 'signup.email'), 'email', 'autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done" required')}
      </div>

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
        <div class="times" id="times">
          ${TIMES.map(
            (t) => `<label class="pick"><input type="radio" name="time" value="${t}"${t === time ? ' checked' : ''} /><span>${t}</span></label>`,
          ).join('')}
        </div>
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
      <p class="quiet small" id="signup-verify">${say('signup.verify.detail')}</p>
      <button class="primary" aria-describedby="signup-verify">${busyLabel(say('signup.submit'))}</button>
      ${inFaq('signup.free') ? '' : `<p class="quiet small centre">${say('signup.free')}</p>`}
      <p class="quiet small centre">${say('signup.terms.summary')}</p>
    </form>
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
      try {
        var row = document.getElementById('times');
        var centre = function (el, smooth) {
          var box = el.getBoundingClientRect(), track = row.getBoundingClientRect();
          row.scrollTo({ left: row.scrollLeft + box.left - track.left - (row.clientWidth - box.width) / 2, behavior: smooth ? 'smooth' : 'auto' });
        };
        var on = row.querySelector('input:checked');
        if (on) centre(on.parentNode, false);
        row.addEventListener('change', function (e) { centre(e.target.parentNode, true); });
      } catch (e) {}
    </script>
  `,
    language,
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
    ${notice ? `<p class="wrong">${say(notice)}</p>` : ''}
    <form method="post" action="/start/verify" id="verify">
      <input type="hidden" name="phone" value="${esc(phone)}" />
      ${draft ? `<input type="hidden" name="draft" value="${esc(draft.id)}" />` : ''}
      <label for="code" class="sr">${say('signup.code.label')}</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]{6}" maxlength="6" required autofocus class="code" enterkeyhint="go" />
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
function shell(body: string, language = 'en'): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F4EDE1" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1A2920" media="(prefers-color-scheme: dark)" />
<title>8&amp;80</title>
<style>
  :root {
    color-scheme: light dark;
    --ink: #2F4A3A;        /* Pine on Paper, 8.4:1 */
    --bg: #F4EDE1;         /* Paper */
    --line: #CFC7B6;
    --card: #F8F3EA;       /* the field card, a shade off Paper */
    /* Forever pairs a serif display with the sans body. Fraunces is the face;
       until it is self-hosted (BRAND.md §7) this is the system's own serif. */
    --serif: 'Fraunces', ui-serif, 'New York', 'Iowan Old Style', Georgia, serif;
    --quiet: #5A695E;      /* 5.0:1 on Paper */
    --accent: #2F4A3A;     /* Pine — the filled button and the chosen day and time */
    --on-accent: #F4EDE1;  /* Paper on Pine, 8.4:1 */
    --gold: #E2B653;       /* a rule, never text on Paper */
    --bad: #8C3A2B;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #F4F1E8;      /* Chalk on Night, 13.5:1 */
      --bg: #1A2920;       /* Night */
      --line: #4A574D;
      --card: #203328;
      --quiet: #9DA198;    /* 5.8:1 on Night */
      --accent: #E2B653;   /* Gold, 8.0:1 on Night */
      --on-accent: #1A2920;/* Night on Gold, 8.0:1 */
      --bad: #E6A08F;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    padding: max(1.5rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right))
             max(2.5rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
    font: 17px/1.5 ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 26rem; }
  .lockup { display: flex; align-items: center; justify-content: center; margin: 0 0 2.25rem; color: var(--ink); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .mark { width: 3.1rem; height: auto; display: block; }
  ${BUSY_CSS}
  .wordmark { font: 600 1.25rem/1 var(--serif); letter-spacing: -0.01em; }
  h1 { font: 600 2.15rem/1.08 var(--serif); letter-spacing: -0.025em; margin: 0 0 .6rem; }
  /* The second sentence turns the first one over, so it is set lighter and on
     its own line — the weight is the punctuation. */
  h1 span { display: block; font-weight: 300; }
  .quiet { color: var(--quiet); margin: 0 0 1rem; }
  h1 + form, h1 + .wrong { margin-top: 1.75rem; }
  .small { font-size: .9rem; }
  .centre { text-align: center; }
  .honest { color: var(--quiet); font-size: .9rem; margin: 0 0 1.75rem; }
  .wrong { color: var(--bad); font-size: .95rem; margin: .35rem 0 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  form { margin: 0 0 1rem; }
  fieldset { border: 0; padding: 0; min-width: 0; }
  fieldset legend { margin-top: 0; }
  #when legend, #when .zone { width: 100%; text-align: center; }
  /* Which clock, directly under the question, quiet enough not to be a second question. */
  .zone { margin: -.2rem 0 .5rem; font-size: .85rem; color: var(--quiet); }
  label, legend { display: block; font-size: .95rem; color: var(--quiet); margin: 1rem 0 .35rem; padding: 0; }
  input, select {
    width: 100%; min-height: 3rem; padding: .7rem .75rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .6rem;
  }
  input:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  input.bad { border-color: var(--bad); }
  input.code { font-size: 1.75rem; letter-spacing: .35em; text-align: center; font-variant-numeric: tabular-nums; }

  /* Contact fields as one card, so the form reads as one thing to fill in. */
  .fields { border: 1px solid var(--line); border-radius: 1.1rem; overflow: hidden; background: var(--card); }
  .fields input { border: 0; border-radius: 0; min-height: 3.4rem; padding: .9rem 1rem; }
  .fields label { margin: 0; padding: .7rem 1rem 0; font-size: .85rem; }
  .fields label:not(:first-child) { border-top: 1px solid var(--line); }
  .fields input { padding-top: .35rem; }
  .fields input:focus-visible { outline: 0; box-shadow: inset 3px 0 0 var(--accent); }
  .fields input.bad { box-shadow: inset 3px 0 0 var(--bad); }
  .fields .wrong { padding: 0 1rem .75rem; margin: 0; }
  .appointment { margin-top: .75rem; font-weight: 600; }
  [hidden] { display: none !important; }
  input::placeholder { color: var(--quiet); opacity: 1; }

  /*
   * The day and the time. Radios under the pills, so a tap is a native choice
   * and the form needs no script; the pill is the span beside the radio.
   */
  fieldset { margin-top: 1.75rem; }
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
  .pick input { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; margin: 0; }
  .pick span:first-of-type {
    display: flex; align-items: center; justify-content: center; min-height: 2.9rem;
    border: 1px solid var(--line); border-radius: .75rem; color: var(--ink);
    font-size: .95rem; font-variant-numeric: tabular-nums;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease;
  }
  .pick input:checked + span { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
  .pick input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .pick span { transition: none; } }

  /* Everything the page used to say above the form, for whoever asks. */
  .faq { margin-top: 2.5rem; border-top: 1px solid var(--line); }
  .faq details { border-bottom: 1px solid var(--line); }
  .faq summary {
    list-style: none; cursor: pointer; padding: 1rem 2rem 1rem 0; position: relative; font-size: .95rem;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: '+'; position: absolute; right: .25rem; top: .9rem; color: var(--quiet); }
  .faq details[open] summary::after { content: '\\2212'; }
  .faq details p { margin: 0 0 1rem; color: var(--quiet); font-size: .95rem; }

  button {
    width: 100%; min-height: 3.25rem; margin-top: 1.5rem; padding: .85rem 1rem; font: inherit; font-weight: 600;
    border-radius: .6rem; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.quiet { border: 0; color: var(--quiet); margin-top: .25rem; font-weight: 400; }
  form + .quiet, button.primary + .quiet { margin-top: .75rem; }
  .returning { margin-top: 1.75rem; text-align: center; }
  .returning p { margin: 0 0 .6rem; color: var(--quiet); font-size: .85rem; }
  .returning a {
    display: inline-flex; align-items: center; justify-content: center; gap: .6rem;
    min-height: 2.75rem; padding: .65rem 1.25rem; border: 1px solid var(--line); border-radius: .6rem;
    background: transparent; color: var(--ink); font-size: .9rem; font-weight: 600; text-decoration: none;
  }
  .returning a:hover { background: var(--card); border-color: var(--ink); }
  .returning a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  /* Named, not hidden. A sign-up page that does not say where its terms are is
     a sign-up page hoping nobody looks. */
  .legal { margin-top: 2rem; }
  .legal a { color: var(--quiet); }
  @media (min-width: 40rem) {
    body { padding-top: 4rem; }
    h1 { font-size: 2rem; }
  }
</style>
</head>
<body><main>${body}</main>${BUSY}${MOTION}</body>
</html>`;
}
