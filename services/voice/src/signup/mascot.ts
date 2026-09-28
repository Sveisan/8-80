/**
 * The Forever mark in motion: the two loops trade sizes.
 *
 * The small loop swells into the big one while the big one draws in, so the
 * eight and the eighty take turns, and the gold dot — the child — rides through
 * the crossing into whichever loop is small. Halfway it is a plain, symmetric
 * infinity. BRAND.md §8.
 *
 * The morph works where a morph against the mirror image does not because the
 * second drawing is traced in the same order as the first: left loop, then
 * right, each from the crossing, over the top, round and back. Every point
 * moves only within its own loop, so the in-between frames are all real
 * infinities rather than an average that collapses onto the axis.
 *
 * SMIL, because Safari cannot animate a path's shape from CSS, and the phone
 * this page is opened on is most often an iPhone. SMIL cannot be switched off
 * from inside the file, so every animation here waits for `begin="indefinite"`
 * and MOTION starts them only when the reader has not asked for less motion.
 * Without the script, or with the request, the mark stands still and is
 * complete standing still.
 */

/** The mark as drawn in brand/assets/mark.svg: small loop left, big loop right. */
const EIGHT_FIRST =
  'M51 60C46 50 37 46 31 46C23 46 17 52 17 60C17 68 23 74 31 74C37 74 46 70 51 60' +
  'C57 46 69 36 81 36C95 36 103 47 103 60C103 73 95 84 81 84C69 84 57 74 51 60Z';

/**
 * The same mark with the loops traded, traced in the same order: the left loop
 * (now big) is the right loop mirrored, and the right loop (now small) is the
 * left one mirrored. Derived rather than written out, so it cannot drift.
 */
function traded(d: string, axis = 60): string {
  const n = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const pt = (i: number): string => `${2 * axis - (n[i] as number)} ${n[i + 1]}`;
  // n[0..1] is the crossing; then eight cubics of three points each.
  const seg = (k: number): string => `C${pt(2 + k * 6)} ${pt(4 + k * 6)} ${pt(6 + k * 6)}`;
  return `M${pt(0)}${[4, 5, 6, 7].map(seg).join('')}${[0, 1, 2, 3].map(seg).join('')}Z`;
}

const EIGHTY_FIRST = traded(EIGHT_FIRST);
const DOT_EIGHT = 31;
const DOT_EIGHTY = 89;

/**
 * What the mark is doing.
 *
 * - `rest`  — still. The mark.
 * - `idle`  — trades once and back every twelve seconds. The page header: alive,
 *             never busy.
 * - `wait`  — trades steadily, 2.8s a round trip. Loading, sending, "one moment".
 * - `talk`  — trades faster, 1.4s. The mentor is speaking or typing.
 * - `nudge` — one quick trade and back, then a long rest, again. Beside the one
 *             thing a person needs to do next.
 */
export type Mood = 'rest' | 'idle' | 'wait' | 'talk' | 'nudge';

const EASE = '0.45 0 0.55 1';

/** keyTimes, values index (0 = eight first, 1 = eighty first), duration. */
const TIMING: Record<Exclude<Mood, 'rest'>, { times: number[]; at: number[]; dur: number }> = {
  idle: { times: [0, 0.8, 0.9, 1], at: [0, 0, 1, 0], dur: 12 },
  wait: { times: [0, 0.5, 1], at: [0, 1, 0], dur: 2.8 },
  talk: { times: [0, 0.5, 1], at: [0, 1, 0], dur: 1.4 },
  nudge: { times: [0, 0.06, 0.12, 0.18, 0.24, 1], at: [0, 1, 0, 1, 0, 0], dur: 5 },
};

function animate(attr: 'd' | 'cx', mood: Exclude<Mood, 'rest'>): string {
  const { times, at, dur } = TIMING[mood];
  const values = at.map((i) => (attr === 'd' ? [EIGHT_FIRST, EIGHTY_FIRST] : [DOT_EIGHT, DOT_EIGHTY])[i]);
  return (
    `<animate attributeName="${attr}" begin="indefinite" dur="${dur}s" repeatCount="indefinite" ` +
    `calcMode="spline" keyTimes="${times.join(';')}" keySplines="${times.slice(1).map(() => EASE).join(';')}" ` +
    `values="${values.join(';')}"/>`
  );
}

/**
 * The mark, inline, in the given mood. The line is `currentColor`, so it follows
 * the theme — Pine on Paper, Chalk on Night — and the dot is Gold on both.
 * Decorative: whatever it sits beside carries the words.
 */
export function mascot(mood: Mood = 'rest', className = 'mark'): string {
  const moving = mood !== 'rest';
  return (
    `<svg class="${className}" viewBox="12 31 96 58" aria-hidden="true" focusable="false"${moving ? ` data-mood="${mood}"` : ''}>` +
    `<path d="${EIGHT_FIRST}" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round">` +
    `${moving ? animate('d', mood) : ''}</path>` +
    `<circle cx="${DOT_EIGHT}" cy="60" r="5" fill="#E2B653">${moving ? animate('cx', mood) : ''}</circle>` +
    `</svg>`
  );
}

/**
 * Starts every mascot on the page, unless the reader has asked for less motion.
 * One per page, after the last mascot.
 */
export const MOTION = `<script>
  try {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('svg[data-mood] animate').forEach(function (a) { a.beginElement(); });
    }
  } catch (e) {}
</script>`;

/**
 * A primary button's contents: its label, and the mark working in its place
 * once pressed. The label stays in the button, hidden, so a screen reader still
 * says what was pressed; `aria-busy` says it is under way. BUSY sets it.
 */
export const busyLabel = (label: string): string =>
  `<span class="label">${label}</span><span class="busy">${mascot('wait', 'busy-mark')}</span>`;

/**
 * Marks the pressed button busy (any button built with busyLabel) when the form is sent, and stops a second
 * tap sending it twice — which on the sign-up form would be a second text to
 * the same number. One per page.
 */
export const BUSY = `<script>
  try {
    document.querySelectorAll('form').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        if (f.dataset.sent) { e.preventDefault(); return; }
        f.dataset.sent = '1';
        var b = e.submitter || f.querySelector('button');
        if (!b || !b.querySelector('.busy')) return;
        b.setAttribute('aria-busy', 'true');
        // Started here, not with the rest: a browser does not run an
        // animation that was begun while its button hid it.
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          b.querySelectorAll('animate').forEach(function (a) { a.beginElement(); });
        }
      });
    });
  } catch (e) {}
</script>`;

/**
 * The styles BUSY needs, for a page's own style block. The busy mark takes the
 * button's text colour for its line; on a Gold button (the dark theme) the dot
 * turns Paper, because a Gold dot on Gold is a hole. BRAND.md §5.
 */
export const BUSY_CSS = `
  button .busy { display: none; }
  button[aria-busy="true"] { pointer-events: none; }
  button[aria-busy="true"] .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  button[aria-busy="true"] .busy { display: flex; justify-content: center; }
  .busy-mark { width: 2.75rem; height: auto; display: block; }
  @media (prefers-color-scheme: dark) { button.primary .busy-mark circle { fill: #F4EDE1; } }`;

/** For tests. */
export const PATHS = { EIGHT_FIRST, EIGHTY_FIRST };
