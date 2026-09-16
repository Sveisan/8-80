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
  `,
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
  :root { color-scheme: light dark; --ink: #1a1a1a; --bg: #faf9f7; --line: #dcd8d2; --quiet: #6b6560; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #ece9e4; --bg: #171614; --line: #3a3733; --quiet: #9a938c; }
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
  button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  button.quiet { border: 0; color: var(--quiet); }
  .always { display: flex; align-items: center; gap: .5rem; margin-top: .6rem; }
  .always input { width: auto; }
  .move { border-top: 1px solid var(--line); padding-top: 1.25rem; }
  .skip { margin-top: 1.5rem; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
