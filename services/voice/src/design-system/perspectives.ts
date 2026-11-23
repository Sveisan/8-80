const left = 'M80 92 C132 38 177 38 220 92';
const right = 'M220 92 C263 38 308 38 360 92';

export function perspectiveGraphic(today: string): string {
  return `<svg viewBox="0 0 440 170" aria-hidden="true" focusable="false">
    <path d="${left} ${right}" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
    <path d="M80 100 C140 156 300 156 360 100" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
    <path class="perspective-trace perspective-trace--first" d="${left}" pathLength="1" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linecap="round"/>
    <path class="perspective-trace perspective-trace--second" d="${right}" pathLength="1" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="80" cy="92" r="43" fill="var(--gold)"/><circle cx="360" cy="92" r="43" fill="var(--ink)"/>
    <text x="80" y="108" text-anchor="middle" fill="#1A2920" font-size="48">8</text>
    <text x="360" y="108" text-anchor="middle" fill="var(--bg)" font-size="43">80</text>
    <circle cx="220" cy="92" r="5" fill="currentColor"/>
    <text x="220" y="121" text-anchor="middle" fill="currentColor" font-size="14">${today}</text>
  </svg>`;
}

export const PERSPECTIVE_MOTION = `<script>
  (function () {
    var figure = document.querySelector('.perspectives');
    if (!figure || !('IntersectionObserver' in window)) return;
    var motion = matchMedia('(prefers-reduced-motion: reduce)');
    var stop = function () { figure.classList.remove('perspectives--playing'); };
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].intersectionRatio < .45) return;
      observer.disconnect();
      if (!motion.matches) figure.classList.add('perspectives--playing');
    }, { threshold: .45 });
    figure.addEventListener('animationend', function (event) {
      if (event.target.matches('.perspective-trace--second')) stop();
    });
    var onPreference = function () { if (motion.matches) stop(); };
    if (motion.addEventListener) motion.addEventListener('change', onPreference);
    else motion.addListener(onPreference);
    observer.observe(figure);
  })();
</script>`;
