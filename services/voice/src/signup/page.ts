import type { ScriptLines } from '../script.ts';
import type { Invalid, Signup } from './form.ts';

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

/** One tap each. Numbers, so there is no English to put in SCRIPT.md. */
const TIMES = ['07:30', '12:00', '17:00', '20:00'];

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
 * Mobile first and short on purpose: a headline, the honesty line, and a form
 * that fits a phone screen. Everything the product could say about itself is
 * said on the first call instead. The day is one tap on a chip rather than a
 * dropdown, and the common times are one tap too, with the native picker for
 * anything else.
 *
 * The honesty line is above the form rather than in a footer. SCRIPT.md §11
 * spends an entire call refusing to pretend to be a person; a sign-up page that
 * let somebody find that out later would undo it before the first call.
 *
 * Errors sit under the field they belong to, so somebody who mistyped their
 * number on a small screen does not have to scroll to find out which one.
 */
export function signupPage(script: ScriptLines, state: SignupFormState = {}, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const long = dayNames(language, 'long');
  const short = dayNames(language, 'short');
  const v = state.values ?? {};
  const wrong = new Map((state.errors ?? []).map((e) => [e.field as string, ERROR_KEY[e.why]]));
  const note = (field: string): string => {
    const key = wrong.get(field);
    return key ? `<p class="wrong" id="${field}-wrong">${say(key)}</p>` : '';
  };
  const weekday = v.weekday || '2';
  const time = v.time || '08:00';

  const field = (name: string, label: string, type: string, extra = ''): string => `
      <label for="${name}">${say(label)}</label>
      <input id="${name}" name="${name}" type="${type}" value="${esc(v[name as keyof typeof v] ?? '')}"
             ${wrong.has(name) ? `class="bad" aria-invalid="true" aria-describedby="${name}-wrong"` : ''} ${extra} />
      ${note(name)}`;

  return shell(
    `
    <header>${MARK}</header>
    <h1>${say('signup.title')}</h1>
    <p class="honest">${say('signup.honest')}</p>

    ${note('timezone')}

    <form method="post" action="/start" novalidate>
      ${field('name', 'signup.name', 'text', 'autocomplete="given-name" autocapitalize="words" enterkeyhint="next" required')}
      ${field('phone', 'signup.phone', 'tel', 'autocomplete="tel" inputmode="tel" placeholder="+47 900 33 575" enterkeyhint="next" required')}
      ${field('email', 'signup.email', 'email', 'autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done" required')}

      <fieldset>
        <legend>${say('signup.when')}</legend>
        <div class="days">
          ${WEEK.map(
            (i) => `<label class="chip" title="${esc(long[i] as string)}">
            <input type="radio" name="weekday" value="${i}"${String(i) === weekday ? ' checked' : ''} />
            <span aria-hidden="true">${esc(short[i] as string)}</span><span class="sr">${esc(long[i] as string)}</span>
          </label>`,
          ).join('')}
        </div>
        ${note('weekday')}
        <div class="times" id="times" hidden>
          ${TIMES.map((t) => `<button type="button" class="chip${t === time ? ' on' : ''}" data-time="${t}">${t}</button>`).join('')}
        </div>
        <input type="time" id="time" name="time" value="${esc(time)}" aria-label="${say('signup.when')}" required
               ${wrong.has('minute') ? 'class="bad" aria-invalid="true" aria-describedby="minute-wrong"' : ''} />
        ${note('minute')}
      </fieldset>

      <input type="hidden" name="timezone" id="tz" value="Europe/Oslo" />
      <button class="primary">${say('signup.submit')}</button>
      <p class="quiet small centre">${say('signup.free')}</p>
    </form>
    <p class="quiet small centre legal"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
    <script>
      // Fills the timezone and wires the time chips. The form works without it:
      // the zone falls back to Oslo and the native time picker is always there.
      try { document.getElementById('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      try {
        var times = document.getElementById('times'), input = document.getElementById('time');
        var mark = function () {
          times.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.time === input.value); });
        };
        times.hidden = false;
        times.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-time]');
          if (b) { input.value = b.dataset.time; mark(); }
        });
        input.addEventListener('input', mark);
      } catch (e) {}
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
    <form method="post" action="/start/verify" id="verify">
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <label for="code" class="sr">${say('signup.code.label')}</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]*" maxlength="6" required autofocus class="code" enterkeyhint="go" />
      <button class="primary">${say('signup.code.submit')}</button>
    </form>
    <form method="get" action="/">
      <button class="quiet">${say('signup.code.again')}</button>
    </form>
    <script>
      // When the phone autofills the code from the text, send it. The button
      // is still there for anyone who types it, or has scripts off.
      try {
        var code = document.getElementById('code'), sent = false;
        code.addEventListener('input', function () {
          if (!sent && /^\\d{6}$/.test(code.value)) { sent = true; document.getElementById('verify').submit(); }
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
    `<header>${MARK}</header>
     <h1>${esc((script.get('signup.done.title') ?? '').replace('{{when}}', when))}</h1>
     <p class="quiet">${say('signup.done.detail')}</p>`,
    language,
  );
}

/**
 * brand/assets/mark.svg, inlined so the page makes no second request. Shown at
 * 44px, above BRAND.md §4's 32px floor for the primary mark. Decorative here:
 * the page title already names the product.
 */
const MARK = `<svg class="mark" viewBox="0 0 400 400" aria-hidden="true" focusable="false"><circle cx="200" cy="200" r="190" fill="#E2B653"/><g transform="translate(200,200) scale(0.5342) translate(-111.0,-138.1)" fill="none" stroke="#4A6656" stroke-width="34"><ellipse cx="0" cy="70" rx="62" ry="56" transform="rotate(18 0 250)"/><ellipse cx="0" cy="184" rx="74" ry="66" transform="rotate(18 0 250)"/><ellipse cx="222" cy="70" rx="62" ry="56" transform="rotate(-18 222 250)"/><ellipse cx="222" cy="184" rx="74" ry="66" transform="rotate(-18 222 250)"/></g></svg>`;

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
    --line: #CFCBBC;
    --quiet: #5A695E;      /* 5.0:1 on Paper */
    --accent: #2F4A3A;     /* Pine — the filled button and the chosen chip */
    --on-accent: #F4EDE1;  /* Paper on Pine, 8.4:1 */
    --gold: #E2B653;       /* a rule, never text on Paper */
    --bad: #8C3A2B;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #F4F1E8;      /* Chalk on Night, 13.5:1 */
      --bg: #1A2920;       /* Night */
      --line: #4A574D;
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
  header { margin: 0 0 1rem; }
  .mark { width: 44px; height: 44px; display: block; }
  h1 { font-size: 1.6rem; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 .6rem; }
  .quiet { color: var(--quiet); margin: 0 0 1rem; }
  .small { font-size: .9rem; }
  .centre { text-align: center; }
  .honest {
    color: var(--quiet); font-size: .95rem; margin: 0 0 1.5rem;
    border-left: 2px solid var(--gold); padding-left: .75rem;
  }
  .wrong { color: var(--bad); font-size: .95rem; margin: .35rem 0 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  form { margin: 0 0 1rem; }
  fieldset { border: 0; padding: 0; margin: 1rem 0 0; min-width: 0; }
  fieldset legend { margin-top: 0; }
  label, legend { display: block; font-size: .95rem; color: var(--quiet); margin: 1rem 0 .35rem; padding: 0; }
  input, select {
    width: 100%; min-height: 3rem; padding: .7rem .75rem; font: inherit; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: .6rem;
  }
  input:focus-visible, button:focus-visible, .chip:has(input:focus-visible) {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  input.bad { border-color: var(--bad); }
  input.code { font-size: 1.75rem; letter-spacing: .35em; text-align: center; font-variant-numeric: tabular-nums; }
  input[type=time] { text-align: left; }

  /* The day and the common times: one tap each, 44px tall at the least. */
  .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: .3rem; }
  .times { display: grid; grid-template-columns: repeat(4, 1fr); gap: .3rem; margin: .5rem 0; }
  .times[hidden] { display: none; }
  .chip {
    position: relative; margin: 0; min-height: 2.75rem; display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--line); border-radius: .6rem; color: var(--ink); background: transparent;
    font: inherit; font-size: .9rem; cursor: pointer; padding: 0; width: auto;
    -webkit-tap-highlight-color: transparent; font-variant-numeric: tabular-nums;
  }
  .chip input { position: absolute; opacity: 0; inset: 0; margin: 0; min-height: 0; cursor: pointer; }
  .chip:has(input:checked), .chip.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .days + .wrong { margin-bottom: .25rem; }
  .days ~ input[type=time] { margin-top: .5rem; }

  button {
    width: 100%; min-height: 3.25rem; margin-top: 1.5rem; padding: .85rem 1rem; font: inherit; font-weight: 600;
    border-radius: .6rem; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--ink);
  }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.quiet { border: 0; color: var(--quiet); margin-top: .25rem; font-weight: 400; }
  .times .chip { margin: 0; min-height: 2.75rem; font-weight: 400; }
  form + .quiet, button.primary + .quiet { margin-top: .75rem; }
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
<body><main>${body}</main></body>
</html>`;
}
