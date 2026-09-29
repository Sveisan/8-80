import type { ScriptLines } from '../script.ts';
import type { Slot } from '../schedule/time.ts';
import { BUSY, BUSY_CSS, MOTION, busyLabel } from '../signup/mascot.ts';

/** Weekday names come from the locale, not from a list in this file. */
const dayNames = (language: string, weekday: 'long' | 'short' = 'long'): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday, timeZone: 'UTC' });
  // 2026-09-06 was a Sunday, so index 0 is Sunday as everywhere else here.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

const esc = (s: string): string =>
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
  /**
   * When the first call is, if there has not been one yet. The page says that
   * instead of "move this week's call", and a time chosen on it moves the
   * booking rather than one week, because before the first call the booking
   * is the only week there is.
   */
  first?: Date;
  /** Minutes after signing up: the page says it is done before offering anything. */
  fresh?: boolean;
  /** Offer the field for adding to this year's goals. Only once a call has made the list. */
  goals?: boolean;
  /** A `page.goals.*` key, when the last attempt to add said something. */
  goalsNote?: string;
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
  /**
   * The address on file, or nothing. Shown filled so somebody changing one can
   * see what they are changing, and empty when the call never had one to send
   * the recap to — which is the case this field exists for.
   */
  email?: string,
  /** A `page.email.*` key, when the last attempt to save one said something. */
  note?: string,
  view: PageView = {},
): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const days = dayNames(language);
  const short = dayNames(language, 'short');
  const via = view.via ?? 'link';
  const first = view.first;
  const when = `${days[slot.weekday]} ${clock(slot.minute)}`;
  const time = clock(slot.minute);

  const head = first
    ? view.fresh
      ? `<h1>${esc((script.get('signup.done.title') ?? '').replace('{{when}}', whenOf(first, slot.timezone, language)))}</h1>
    <p class="now">${say('signup.done.detail')}</p>`
      : `<h1>${esc((script.get('page.first') ?? '').replace('{{when}}', whenOf(first, slot.timezone, language)))}</h1>
    <p class="now">${say('page.first.detail')}</p>`
    : `<h1>${say('page.title')}</h1>
    <p class="now">${esc((script.get('page.usually') ?? '').replace('{{when}}', when))}</p>

    <form method="post">
      <button name="action" value="later" class="primary">${busyLabel(say('page.later'))}</button>
    </form>`;

  // Before the first call a new time is the booking, so "every week" is not
  // a question worth a checkbox: it is sent, and said on the button.
  const always = first
    ? '<input type="hidden" name="always" value="1" />'
    : `<label class="always"><input type="checkbox" name="always" value="1" /> ${say('page.always')}</label>`;

  const goals = view.goals
    ? `
    <form method="post" class="move">
      <label for="goals">${say('page.goals.label')}</label>
      <textarea id="goals" name="goals" rows="3" maxlength="${GOALS_MAX}" required></textarea>
      <p class="hint">${say('page.goals.detail')}</p>
      <button name="action" value="goals">${busyLabel(say('page.goals.save'))}</button>
      ${view.goalsNote ? `<p class="now said">${say(view.goalsNote)}</p>` : ''}
    </form>`
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
      : `<p class="hint centre">${say('page.browser.rest')}</p>`;

  return shell(
    `
    ${MARK}
    ${head}

    <form method="post" class="move">
      <fieldset>
        <legend>${say(first ? 'page.first.pick' : 'page.pick')}</legend>
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
          ${timesFor(slot.minute)
            .map(
              (t) =>
                `<label class="pick"><input type="radio" name="time" value="${t}"${t === time ? ' checked' : ''} /><span>${t}</span></label>`,
            )
            .join('')}
        </div>
      </fieldset>
      ${always}
      <button name="action" value="move">${busyLabel(say('page.move'))}</button>
    </form>
    ${goals}

    <form method="post" class="move">
      <label for="email">${say('page.email.label')}</label>
      <div class="row">
        <input type="email" id="email" name="email" value="${esc(email ?? '')}" placeholder="you@example.com"
               autocomplete="email" autocapitalize="off" spellcheck="false" />
      </div>
      <button name="action" value="email">${busyLabel(say('page.email.save'))}</button>
      ${note ? `<p class="now said">${say(note)}</p>` : ''}
    </form>

    ${
      // Not before the first call. SKIP writes nothing — after a missed call
      // the next one is already a week away, so there is nothing to write —
      // and offered here it would say "skipped" and then ring them anyway.
      first
        ? ''
        : `<form method="post" class="skip">
      <button name="action" value="skip" class="quiet">${say('page.skip')}</button>
    </form>`
    }

    <form method="post" class="stop${first ? ' first' : ''}">
      <button name="action" value="stop" class="quiet">${say('page.stop')}</button>
    </form>
    ${rest}
    <script>
      // Brings the chosen time to the middle of its row, as on the sign-up
      // page. The form works without it: the row scrolls by hand.
      try {
        var row = document.getElementById('times');
        var centre = function (el, smooth) {
          row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
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

/** Which clock the times are on: "Norwegian time", or the slot's own place. SCRIPT.md §19. */
function zoneLine(timezone: string, script: ScriptLines): string {
  if (timezone === 'Europe/Oslo') return script.get('time.zone.home') ?? '';
  const city = (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ');
  return (script.get('time.zone.other') ?? '').replace('{{zone}}', city);
}

/** A line added to the goals from the page. Long enough for a sentence or two, not an essay. */
export const GOALS_MAX = 400;

/** "Tuesday 08:00", in their zone. The first call is always inside a week, so the day is enough. */
function whenOf(at: Date, timezone: string, language: string): string {
  return at.toLocaleString(language === 'en' ? 'en-GB' : language, {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The Forever mark, still. brand/assets/mark.svg, inlined so the page makes
 * no second request; the line is `currentColor` so it follows the theme and
 * the dot stays Gold. It does not turn here: this page is for doing something
 * and leaving, and a moving logo is one more thing competing for the thumb.
 */
const MARK = `<header class="lockup"><span class="sr">8&amp;80</span><svg class="mark" viewBox="12 31 96 58" aria-hidden="true" focusable="false"><path d="M51 60C46 50 37 46 31 46C23 46 17 52 17 60C17 68 23 74 31 74C37 74 46 70 51 60C57 46 69 36 81 36C95 36 103 47 103 60C103 73 95 84 81 84C69 84 57 74 51 60Z" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><circle cx="31" cy="60" r="5" fill="#E2B653"/></svg></header>`;

/**
 * Where a browser that does not know anybody lands.
 *
 * The cookie is gone, lapsed, or was never there. Not an error, and not a
 * sign-in: the way in is the link in any text, and the page says so.
 */
export function unknownBrowserPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(`${MARK}<h1>${say('page.browser.gone')}</h1><p class="now">${say('page.browser.gone.detail')}</p>`, language);
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

export function donePage(message: string, script: ScriptLines, language = 'en'): string {
  return shell(`<h1>${esc(message)}</h1><p class="now">${esc(script.get('page.close') ?? '')}</p>`, language);
}

export function gonePage(script: ScriptLines, language = 'en'): string {
  return shell(
    `<h1>${esc(script.get('page.expired') ?? '')}</h1>
     <p class="now">${esc(script.get('page.expired.detail') ?? '')}</p>`,
    language,
  );
}

function shell(body: string, language = 'en'): string {
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
  input[type=email] {
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
