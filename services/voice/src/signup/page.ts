import type { ScriptLines } from '../script.ts';
import type { Invalid, Signup } from './form.ts';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const dayNames = (language: string): string[] => {
  const fmt = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 6 + i))));
};

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
  values?: Partial<Record<'name' | 'phone' | 'email' | 'weekday' | 'time', string>>;
}

/**
 * The only page a stranger sees.
 *
 * One column, one form, and the product described once. It is built to be read
 * on a phone held in one hand on a train, which is where a link to it will be
 * opened, so the whole thing is a single scroll with no tabs, no carousel and
 * no second call to action further down.
 *
 * The honesty line is above the button rather than in a footer. SCRIPT.md §11
 * spends an entire call refusing to pretend to be a person; a sign-up page that
 * let somebody find that out later would undo it before the first call.
 */
export function signupPage(script: ScriptLines, state: SignupFormState = {}, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const days = dayNames(language);
  const v = state.values ?? {};
  const failed = new Set((state.errors ?? []).map((e) => e.field));
  const notes = (state.errors ?? [])
    .map((e) => ERROR_KEY[e.why])
    .filter((k): k is string => Boolean(k))
    .map((k) => `<p class="wrong">${say(k)}</p>`)
    .join('');

  const field = (
    name: string,
    label: string,
    type: string,
    extra = '',
  ): string => `
      <label for="${name}">${say(label)}</label>
      <input id="${name}" name="${name}" type="${type}" value="${esc(v[name as keyof typeof v] ?? '')}"
             class="${failed.has(name === 'time' ? 'minute' : (name as never)) ? 'bad' : ''}" ${extra} />`;

  return shell(
    `
    <h1>${say('signup.title')}</h1>
    <p class="lede">${say('signup.what')}</p>
    <p class="quiet">${say('signup.after')}</p>
    <p class="quiet honest">${say('signup.honest')}</p>

    ${notes}

    <form method="post" action="/start">
      ${field('name', 'signup.name', 'text', 'autocomplete="given-name" required')}
      ${field('phone', 'signup.phone', 'tel', 'autocomplete="tel" inputmode="tel" required')}
      ${field('email', 'signup.email', 'email', 'autocomplete="email" required')}

      <label for="weekday">${say('signup.when')}</label>
      <div class="row">
        <select id="weekday" name="weekday">
          ${days.map((d, i) => `<option value="${i}"${String(i) === (v.weekday ?? '2') ? ' selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
        <input type="time" name="time" value="${esc(v.time ?? '08:00')}" required />
      </div>
      <p class="quiet small">${say('signup.when.detail')}</p>

      <input type="hidden" name="timezone" id="tz" value="Europe/Oslo" />
      <button class="primary">${say('signup.submit')}</button>
      <p class="quiet small centre">${say('signup.free')}</p>
    </form>
    <p class="quiet small centre legal"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
    <script>
      // The only script on the page, and it fills one hidden field. Everything
      // else works with it blocked, which on a page like this is the point.
      try { document.getElementById('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    </script>
  `,
    language,
  );
}

/** After the form, before the caller exists. The code is the whole page. */
export function codePage(phone: string, script: ScriptLines, wrong?: string, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  return shell(
    `
    <h1>${say('signup.code.title')}</h1>
    <p class="quiet">${esc((script.get('signup.code.detail') ?? '').replace('{{phone}}', phone))}</p>
    ${wrong ? `<p class="wrong">${say(wrong)}</p>` : ''}
    <form method="post" action="/start/verify">
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <label for="code">${say('signup.code.label')}</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]*" maxlength="6" required class="code" />
      <button class="primary">${say('signup.code.submit')}</button>
    </form>
    <form method="get" action="/">
      <button class="quiet">${say('signup.code.again')}</button>
    </form>
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
    `<h1>${esc((script.get('signup.done.title') ?? '').replace('{{when}}', when))}</h1>
     <p class="quiet">${say('signup.done.detail')}</p>`,
    language,
  );
}

export { clock };

/**
 * BRAND.md §6. Paper and Pine, the same tokens as the reschedule page, with a
 * wider measure because this one has something to say before it asks anything.
 */
function shell(body: string, language = 'en'): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>8&amp;80</title>
<style>
  :root {
    color-scheme: light dark;
    --ink: #2F4A3A; --bg: #F4EDE1; --line: #D9D6C9; --quiet: #5A695E;
    --accent: #2F4A3A; --on-accent: #F4EDE1; --gold: #E2B653; --bad: #8C3A2B;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #F4F1E8; --bg: #1A2920; --line: #414D44; --quiet: #9DA198;
      --accent: #E2B653; --on-accent: #1A2920; --bad: #E6A08F;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
    font: 17px/1.6 ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 30rem; }
  h1 { font-size: 1.85rem; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .9rem; }
  .lede { margin: 0 0 1rem; }
  .quiet { color: var(--quiet); margin: 0 0 1rem; }
  .small { font-size: .9rem; }
  .centre { text-align: center; }
  .honest { border-left: 2px solid var(--gold); padding-left: .9rem; margin-bottom: 2rem; }
  .wrong { color: var(--bad); margin: 0 0 .75rem; }
  form { margin: 0 0 1rem; }
  label { display: block; font-size: .95rem; color: var(--quiet); margin: 1.1rem 0 .35rem; }
  input, select {
    width: 100%; padding: .75rem .65rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .5rem;
  }
  input.bad { border-color: var(--bad); }
  input.code { font-size: 1.5rem; letter-spacing: .3em; text-align: center; }
  .row { display: flex; gap: .5rem; }
  button {
    width: 100%; margin-top: 1.4rem; padding: .9rem 1rem; font: inherit; border-radius: .5rem;
    cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.quiet { border: 0; color: var(--quiet); margin-top: .4rem; }
  /* Named, not hidden. A sign-up page that does not say where its terms are is
     a sign-up page hoping nobody looks. */
  .legal { margin-top: 2.5rem; }
  .legal a { color: var(--quiet); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
