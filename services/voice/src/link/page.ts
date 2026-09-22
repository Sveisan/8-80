import type { ScriptLines } from '../script.ts';
import type { Slot } from '../schedule/time.ts';

/** Weekday names come from the locale, not from a list in this file. */
const dayNames = (language: string): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' });
  // 2026-09-06 was a Sunday, so index 0 is Sunday as everywhere else here.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * The page a missed-call text points at.
 *
 * Deliberately plain and deliberately small. It shows the slot and offers three
 * things, and it shows nothing else — no name, no commitment, no history. The
 * link may sit in a message thread for years and be opened by whoever has the
 * phone, so the page is designed for a stranger to find boring.
 *
 * No client-side framework, no fetch, no JSON. Three forms that post and
 * reload. It has to work on a bad train connection with one thumb, which is
 * exactly the situation somebody is in when they miss a call.
 */
export function reschedulePage(slot: Slot, script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const days = dayNames(language);
  const when = `${days[slot.weekday]} ${clock(slot.minute)}`;

  return shell(
    `
    <h1>${say('page.title')}</h1>
    <p class="now">${esc((script.get('page.usually') ?? '').replace('{{when}}', when))}</p>

    <form method="post">
      <button name="action" value="later" class="primary">${say('page.later')}</button>
    </form>

    <form method="post" class="move">
      <label for="weekday">${say('page.pick')}</label>
      <div class="row">
        <select id="weekday" name="weekday">
          ${days.map((d, i) => `<option value="${i}"${i === slot.weekday ? ' selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
        <input type="time" name="time" value="${clock(slot.minute)}" required />
      </div>
      <button name="action" value="move">${say('page.move')}</button>
      <label class="always"><input type="checkbox" name="always" value="1" /> ${say('page.always')}</label>
    </form>

    <form method="post" class="skip">
      <button name="action" value="skip" class="quiet">${say('page.skip')}</button>
    </form>

    <form method="post" class="stop">
      <button name="action" value="stop" class="quiet">${say('page.stop')}</button>
    </form>
  `,
    language,
  );
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
       <button name="action" value="stop-confirm" class="primary">${say('page.stop.yes')}</button>
     </form>
     <form method="post">
       <button name="action" value="stop-cancel">${say('page.stop.no')}</button>
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
export function stoppedPage(script: ScriptLines, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(
    `<h1>${say('page.stopped')}</h1>
     <form method="post" class="skip">
       <button name="action" value="start" class="quiet">${say('page.stopped.back')}</button>
     </form>`,
    language,
  );
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
  .always { display: flex; align-items: center; gap: .5rem; margin-top: .6rem; }
  .always input { width: auto; }
  .move { border-top: 1px solid var(--line); padding-top: 1.25rem; }
  .skip { margin-top: 1.5rem; }
  /* Below the things somebody came here to do, and still plainly named. */
  .stop { margin-top: .25rem; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
