import type { ScriptLines } from '../script.ts';
import { MARK, esc, shell } from '../link/page.ts';
import { busyLabel } from '../signup/mascot.ts';
import { ANSWER_MAX, type Answers } from './feedback.ts';

/**
 * The feedback form: two questions and an open box, typed or said.
 *
 * The two questions are set identically — same label, same box, same size —
 * because the second one is the one that matters and a form that makes it
 * look like an afterthought gets afterthought answers. No scale, no stars, no
 * score: SCRIPT.md §20.
 *
 * Opened again, it shows what they wrote, to change. That is the one page in
 * this product that shows something personal, and it is bounded like every
 * link is: a fortnight, one person's answers, nothing else about them.
 *
 * Speaking is the browser's own dictation, filling the same box: the words
 * arrive, the recording never does. Without it — an older browser, scripts
 * off — the buttons stay hidden and the page is a form.
 */
export function feedbackPage(script: ScriptLines, answers: Answers, language = 'en'): string {
  const say = (id: string): string => esc(script.get(id) ?? '');
  const question = (name: keyof Answers, key: string): string => `
    <div class="q">
      <label for="${name}">${say(key)}</label>
      <textarea id="${name}" name="${name}" rows="4" maxlength="${ANSWER_MAX}">${esc(answers[name])}</textarea>
      <button type="button" class="speak" data-for="${name}" data-stop="${say('feedback.speak.stop')}" hidden>${say('feedback.speak')}</button>
    </div>`;

  return shell(
    `${MARK}
    <h1>${say('feedback.title')}</h1>
    <p class="now">${say('feedback.detail')}</p>
    <form method="post" class="feedback">
      <p class="hint" id="speak-note" hidden>${say('feedback.speak.note')}</p>
      ${question('pickup', 'feedback.pickup')}
      ${question('nearly', 'feedback.nearly')}
      ${question('else', 'feedback.else')}
      <button class="primary">${busyLabel(say('feedback.submit'))}</button>
    </form>
    <style>
      .feedback .q { margin: 0 0 1.5rem; }
      .feedback label { font-size: 1.05rem; color: var(--ink); margin-bottom: .4rem; }
      .feedback textarea { min-height: 7rem; }
      button.speak { width: auto; margin-top: .5rem; padding: .5rem .9rem; font-size: .9rem; color: var(--quiet); }
      button.speak.on { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
    </style>
    <script>
      // Dictation into the box, where the browser can. Nothing is recorded or
      // sent from here: the browser turns speech into words, and the words go
      // with the form like anything typed.
      try {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          document.getElementById('speak-note').hidden = false;
          var active = null;
          document.querySelectorAll('button.speak').forEach(function (b) {
            b.hidden = false;
            var label = b.textContent;
            b.addEventListener('click', function () {
              if (active) { active.stop(); return; }
              var box = document.getElementById(b.getAttribute('data-for'));
              var before = box.value ? box.value.replace(/\\s*$/, ' ') : '';
              var r = new SR();
              r.lang = document.documentElement.lang === 'en' ? (navigator.language || 'en') : document.documentElement.lang;
              r.continuous = true;
              r.interimResults = true;
              r.onresult = function (e) {
                var said = '';
                for (var i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
                box.value = (before + said).slice(0, ${ANSWER_MAX});
              };
              r.onend = function () { b.textContent = label; b.classList.remove('on'); active = null; };
              r.onerror = r.onend;
              b.textContent = b.getAttribute('data-stop');
              b.classList.add('on');
              active = r;
              r.start();
            });
          });
        }
      } catch (e) {}
    </script>`,
    language,
  );
}

/** After sending. Plain: no follow-up, no share, nothing to do next. */
export function feedbackThanksPage(script: ScriptLines, language = 'en'): string {
  return shell(`${MARK}<h1>${esc(script.get('feedback.thanks') ?? '')}</h1>`, language);
}

export function feedbackGonePage(script: ScriptLines, language = 'en'): string {
  return shell(`${MARK}<h1>${esc(script.get('feedback.expired') ?? '')}</h1>`, language);
}
