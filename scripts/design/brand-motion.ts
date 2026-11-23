import { SIGNUP_CSS } from '../../services/voice/src/design-system/pages.ts';
import { perspectiveGraphic, PERSPECTIVE_MOTION } from '../../services/voice/src/design-system/perspectives.ts';
import { FOUNDATION_CSS, CONTROL_CSS } from '../../services/voice/src/design-system/styles.ts';
import { themeControl, themeInit, themeSwitch } from '../../services/voice/src/design-system/theme.ts';
import { brandLockup } from '../../services/voice/src/signup/mascot.ts';

export function brandMotionPreview(): string {
  return `<!doctype html><html lang="en" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>8&amp;80 · Logo and motion</title>
${themeInit}
<style>
${FOUNDATION_CSS}${CONTROL_CSS}${SIGNUP_CSS}
body { display: block; padding: clamp(1rem, 5vw, 4rem) clamp(1rem, 4vw, 3rem); }
main { max-width: 62rem; margin: 0 auto; }
.masthead { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem 1rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--line); }
.masthead button, .demo-controls button { margin: 0; width: auto; }
.intro { padding: clamp(1.5rem, 6vw, 3.5rem) 0 1.5rem; }
.intro h1 { font-size: var(--text-display); }
.intro p, .panel p { color: var(--quiet); margin: .5rem 0 0; }
.compare, .demos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); gap: 1rem; }
.panel { background: var(--card); border: 1px solid var(--control-border); border-radius: var(--radius-panel); padding: clamp(1rem, 3vw, 1.5rem); min-width: 0; }
.panel h2 { margin: 0; font-size: var(--text-small); }
.example { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .65rem 0; border-bottom: 1px solid var(--line); margin-top: 1.1rem; }
.example small { font-size: var(--text-caption); color: var(--quiet); text-align: right; }
.motion-title { margin: 2rem 0 1rem; }
.panel .perspectives { margin: .5rem 0 .75rem; max-width: none; }
.demo-controls { margin-top: .75rem; }
.appointment-sample { min-block-size: 8rem; padding: .55rem 0; }
.appointment-sample .clock { display: block; font: 500 clamp(3rem, 8vw, 4rem)/1 var(--font-display); font-variant-numeric: tabular-nums; }
.appointment-sample p { margin: 0 0 .5rem; font-size: var(--text-caption); }
</style></head>
<body><main>
  <header class="masthead">${brandLockup()}${themeSwitch}</header>
  <section class="intro"><h1>Logo and motion</h1><p>One refined infinity mark. Two ways to present it.</p></section>
  <div class="compare">
    <section class="panel"><h2>Mark-led</h2><div class="example">${brandLockup('mark')}<small>Your calls</small></div><p>The infinity mark leads the lockup.</p></section>
    <section class="panel"><h2>Wordmark-led</h2><div class="example">${brandLockup()}<small>Your calls</small></div><p>The chosen lockup for booking and account headers.</p></section>
  </div>
  <h2 class="motion-title">Motion in use</h2>
  <div class="demos">
    <section class="panel"><h2>Two perspectives</h2>
      <figure class="perspectives">${perspectiveGraphic('You, today')}<figcaption><span>What makes you feel alive?</span><span>What will matter in the long run?</span></figcaption></figure>
      <div class="demo-controls"><button id="replay" type="button">Replay illustration</button></div>
    </section>
    <section class="panel"><h2>Your next call</h2>
      <div class="appointment-sample" role="status"><p>Thursday 26 November · Norwegian time</p><time class="clock" datetime="2026-11-26T17:30:00+01:00">17:30</time></div>
      <div class="demo-controls"><button id="move" type="button">Preview reschedule</button></div>
    </section>
  </div>
</main>
${themeControl}${PERSPECTIVE_MOTION}
<script>
  const diagram = document.querySelector('.perspectives');
  const sample = document.querySelector('.appointment-sample');
  const time = sample.querySelector('time');
  function replay(element, className) {
    element.classList.remove(className);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void element.getBoundingClientRect();
    element.classList.add(className);
  }
  document.getElementById('replay').addEventListener('click', () => replay(diagram, 'perspectives--playing'));
  document.getElementById('move').addEventListener('click', () => {
    const update = time.textContent === '17:30' ? '18:00' : '17:30';
    time.textContent = update;
    time.dateTime = '2026-11-26T' + update + ':00+01:00';
    replay(sample, 'motion-highlight');
  });
</script>
</body></html>`;
}
