/**
 * The Forever mark in motion: the two loops trade sizes, and the gold goes
 * with the child.
 *
 * The small loop swells into the big one while the big one draws in, so the
 * eight and the eighty take turns. While it moves, the small loop fills with
 * Gold — the child's sunlight, and the gold ball the mark used to be — and the
 * dot inside it turns ink so it still shows. As the loops trade, the gold flows
 * through the crossing into whichever loop is small. At rest it is the plain
 * mark: a line and a gold dot. BRAND.md §8.
 *
 * The morph works where a morph against the mirror image does not because the
 * second drawing is traced in the same order as the first: left loop, then
 * right, each from the crossing, over the top, round and back. Every point
 * moves only within its own loop, so the in-between frames are all real
 * infinities rather than an average that collapses onto the axis.
 *
 * SMIL, because Safari cannot animate a path's shape from CSS, and the phone
 * this page is opened on is most often an iPhone. SMIL cannot be switched off
 * from inside the file, so every inline animation waits for
 * `begin="indefinite"` and MOTION starts them only when the reader has not
 * asked for less motion. Without the script, or with the request, the mark
 * stands still and is complete standing still.
 */

/** The mark as drawn in brand/assets/mark.svg: small loop left, big loop right. */
const EIGHT_FIRST =
  'M51 60C46 50 37 46 31 46C23 46 17 52 17 60C17 68 23 74 31 74C37 74 46 70 51 60' +
  'C57 46 69 36 81 36C95 36 103 47 103 60C103 73 95 84 81 84C69 84 57 74 51 60Z';

const numbers = (d: string): number[] => (d.match(/-?[\d.]+/g) ?? []).map(Number);

/**
 * The same mark with the loops traded, traced in the same order: the left loop
 * (now big) is the right loop mirrored, and the right loop (now small) is the
 * left one mirrored. Derived rather than written out, so it cannot drift.
 */
function traded(d: string, axis = 60): string {
  const n = numbers(d);
  const pt = (i: number): string => `${2 * axis - (n[i] as number)} ${n[i + 1]}`;
  // n[0..1] is the crossing; then eight cubics of three points each.
  const seg = (k: number): string => `C${pt(2 + k * 6)} ${pt(4 + k * 6)} ${pt(6 + k * 6)}`;
  return `M${pt(0)}${[4, 5, 6, 7].map(seg).join('')}${[0, 1, 2, 3].map(seg).join('')}Z`;
}

/** Each loop on its own, closed, so one can be filled without the other. */
function loops(d: string): [left: string, right: string] {
  const n = numbers(d);
  const seg = (k: number): string => `C${n.slice(2 + k * 6, 8 + k * 6).join(' ')}`;
  const start = `M${n[0]} ${n[1]}`;
  return [`${start}${[0, 1, 2, 3].map(seg).join('')}Z`, `${start}${[4, 5, 6, 7].map(seg).join('')}Z`];
}

const EIGHTY_FIRST = traded(EIGHT_FIRST);
const LOOPS = [loops(EIGHT_FIRST), loops(EIGHTY_FIRST)] as const;
const DOT = [31, 89] as const;

/**
 * What the mark is doing.
 *
 * - `rest`  — still. The mark.
 * - `idle`  — once every twelve seconds the gold rises in the small loop, the
 *             loops trade and trade back, and the gold drains. Page headers:
 *             alive, never busy.
 * - `wait`  — trades steadily, 2.8s a round trip, the gold flowing from loop to
 *             loop. Loading, sending, "one moment".
 * - `talk`  — trades faster, 1.4s, and the dot swells each time it passes the
 *             crossing. The mentor is speaking or typing.
 * - `nudge` — two quick trades with the gold, then a long rest. Beside the one
 *             thing a person needs to do next.
 */
export type Mood = 'rest' | 'idle' | 'wait' | 'talk' | 'nudge';
type Moving = Exclude<Mood, 'rest'>;

/** One animated value over the cycle: key times and the value at each. */
interface Track {
  times: number[];
  values: number[];
}

/**
 * The choreography. `shape` is 0 for eight-first and 1 for eighty-first;
 * `goldLeft` and `goldRight` are the opacity of the gold in each loop; `ink` is
 * how far the dot has turned from gold to ink; `r` is the dot's radius.
 */
interface Choreography {
  dur: number;
  shape: Track;
  goldLeft: Track;
  goldRight: Track;
  ink: Track;
  r: Track;
}

const t = (times: number[], values: number[]): Track => ({ times, values });

/*
 * The gold never fades across both loops at once — half-strength Gold on Night
 * is olive, which is not in the palette. It drains from the small loop just
 * before the crossing, the dot turns back to gold and carries it through the
 * waist (and swells a little doing it), and the new small loop fills once the
 * dot has arrived. The crossings fall halfway through each trade.
 */
const WAIT_SHAPE = t([0, 0.5, 1], [0, 1, 0]); // crossings at 0.25 and 0.75
const WAIT_GOLD_LEFT = t([0, 0.19, 0.25, 0.75, 0.81, 1], [1, 1, 0, 0, 1, 1]);
const WAIT_GOLD_RIGHT = t([0, 0.25, 0.31, 0.69, 0.75, 1], [0, 0, 1, 1, 0, 0]);
const WAIT_BEATS = [0, 0.2, 0.25, 0.3, 0.7, 0.75, 0.8, 1];
const WAIT_INK = t(WAIT_BEATS, [1, 1, 0, 1, 1, 0, 1, 1]);

const MOODS: Record<Moving, Choreography> = {
  idle: {
    // Still until 0.76; the gold rises, one trade (crossing 0.85) and back
    // (crossing 0.935), the gold drains, still again.
    dur: 12,
    shape: t([0, 0.8, 0.9, 0.97, 1], [0, 0, 1, 0, 0]),
    goldLeft: t([0, 0.76, 0.79, 0.83, 0.85, 0.935, 0.95, 0.985, 1], [0, 0, 1, 1, 0, 0, 1, 1, 0]),
    goldRight: t([0, 0.85, 0.87, 0.915, 0.935, 1], [0, 0, 1, 1, 0, 0]),
    ink: t([0, 0.76, 0.79, 0.83, 0.85, 0.87, 0.915, 0.935, 0.95, 0.985, 1], [0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]),
    r: t([0, 0.83, 0.85, 0.87, 0.915, 0.935, 0.95, 1], [5, 5, 6.5, 5, 5, 6.5, 5, 5]),
  },
  wait: {
    dur: 2.8,
    shape: WAIT_SHAPE,
    goldLeft: WAIT_GOLD_LEFT,
    goldRight: WAIT_GOLD_RIGHT,
    ink: WAIT_INK,
    r: t(WAIT_BEATS, [5, 5, 6, 5, 5, 6, 5, 5]),
  },
  talk: {
    dur: 1.4,
    shape: WAIT_SHAPE,
    goldLeft: WAIT_GOLD_LEFT,
    goldRight: WAIT_GOLD_RIGHT,
    ink: WAIT_INK,
    r: t(WAIT_BEATS, [5, 5, 7.5, 5, 5, 7.5, 5, 5]),
  },
  nudge: {
    // The gold rises, one trade (crossing 0.15) and back (crossing 0.25), the
    // gold drains, and four seconds of rest.
    dur: 5,
    shape: t([0, 0.1, 0.2, 0.3, 1], [0, 0, 1, 0, 0]),
    goldLeft: t([0, 0.05, 0.13, 0.15, 0.25, 0.27, 0.34, 0.38, 1], [0, 1, 1, 0, 0, 1, 1, 0, 0]),
    goldRight: t([0, 0.15, 0.17, 0.23, 0.25, 1], [0, 0, 1, 1, 0, 0]),
    ink: t([0, 0.05, 0.13, 0.15, 0.17, 0.23, 0.25, 0.27, 0.34, 0.38, 1], [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0]),
    r: t([0, 0.13, 0.15, 0.17, 0.23, 0.25, 0.27, 1], [5, 5, 6.5, 5, 5, 6.5, 5, 5]),
  },
};

const EASE = '0.45 0 0.55 1';

/**
 * One `<animate>`. Emitted even when the value holds still, because the resting
 * drawing underneath may differ: the ink dot is hidden at rest and shown for
 * the whole of `wait`. `start` is
 * `indefinite` inline, where MOTION decides, and omitted in a standalone file,
 * which plays when shown.
 */
function animate(attr: string, dur: number, track: Track, value: (v: number) => string | number, start: boolean): string {
  const values = track.values.map(value);
  return (
    `<animate attributeName="${attr}"${start ? ' begin="indefinite"' : ''} dur="${dur}s" repeatCount="indefinite" ` +
    `calcMode="spline" keyTimes="${track.times.join(';')}" keySplines="${track.times.slice(1).map(() => EASE).join(';')}" ` +
    `values="${values.join(';')}"/>`
  );
}

/**
 * The colours, as CSS so a page can theme them. Inline, the line is
 * `currentColor` and the rest read custom properties with the brand defaults;
 * a standalone file passes hexes, because an `<img>` inherits nothing.
 */
interface Paint {
  line: string;
  gold: string;
  dot: string;
  ink: string;
}

const INLINE: Paint = {
  line: 'currentColor',
  gold: 'var(--mark-gold, #E2B653)',
  dot: 'var(--mark-dot, #E2B653)',
  ink: 'var(--mark-ink, currentColor)',
};

function drawing(mood: Mood, paint: Paint, inline: boolean, width = 7): string {
  const m = mood === 'rest' ? undefined : MOODS[mood];
  const a = (attr: string, track: keyof Omit<Choreography, 'dur'>, value: (v: number) => string | number): string =>
    m ? animate(attr, m.dur, m[track], value, inline) : '';
  const [left, right] = LOOPS[0];
  const gold = (d: string, side: 0 | 1, track: 'goldLeft' | 'goldRight'): string =>
    m
      ? `<path d="${d}" style="fill:${paint.gold}" fill-opacity="0">` +
        a('d', 'shape', (v) => LOOPS[v ? 1 : 0][side]) +
        a('fill-opacity', track, (v) => v) +
        `</path>`
      : '';
  const dot = (colour: string, opacity: 'ink' | undefined): string =>
    `<circle cx="${DOT[0]}" cy="60" r="5" style="fill:${colour}"${opacity ? ' opacity="0"' : ''}>` +
    a('cx', 'shape', (v) => DOT[v ? 1 : 0]) +
    a('r', 'r', (v) => v) +
    (opacity ? a('opacity', 'ink', (v) => v) : '') +
    `</circle>`;
  return (
    gold(left, 0, 'goldLeft') +
    gold(right, 1, 'goldRight') +
    `<path d="${EIGHT_FIRST}" fill="none" style="stroke:${paint.line}" stroke-width="${width}" stroke-linejoin="round">` +
    a('d', 'shape', (v) => (v ? EIGHTY_FIRST : EIGHT_FIRST)) +
    `</path>` +
    dot(paint.dot, undefined) +
    (m ? dot(paint.ink, 'ink') : '')
  );
}

/**
 * The mark, inline, in the given mood. Themed by the page: the line is the text
 * colour, and `--mark-gold`, `--mark-dot` and `--mark-ink` set the gold, the
 * dot at rest and the dot inside the gold. MARK_CSS has the brand's settings.
 * Decorative: whatever it sits beside carries the words.
 */
export function mascot(mood: Mood = 'rest', className = 'mark'): string {
  return (
    `<svg class="${className}" viewBox="12 31 96 58" aria-hidden="true" focusable="false"${mood === 'rest' ? '' : ` data-mood="${mood}"`}>` +
    drawing(mood, INLINE, true) +
    `</svg>`
  );
}

/**
 * The colourways for the page, BRAND.md §5. The dot inside the gold is Night on
 * a dark page, where the Chalk line would be pale on Gold. On a Pine button the
 * line is Paper and the ink dot Night; on a Gold button (the dark theme) the
 * gold becomes Paper, because Gold on Gold is a hole.
 */
export const MARK_CSS = `
  @media (prefers-color-scheme: dark) { :root { --mark-ink: #1A2920; } }
  button.primary { --mark-ink: #1A2920; }
  @media (prefers-color-scheme: dark) { button.primary { --mark-gold: #F4EDE1; --mark-dot: #F4EDE1; } }`;

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
 * A button's contents: its label, and the mark working in its place once
 * pressed. The label stays in the button, hidden, so a screen reader still says
 * what was pressed; `aria-busy` says it is under way. BUSY sets it.
 */
export const busyLabel = (label: string): string =>
  `<span class="label">${label}</span><span class="busy">${mascot('wait', 'busy-mark')}</span>`;

/**
 * Marks the pressed button busy (any button built with busyLabel), and stops a
 * second tap sending the form twice — which on the sign-up form would be a
 * second text to the same number. One per page.
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

/** The styles BUSY needs, and the mark's colourways, for a page's own style block. */
export const BUSY_CSS = `
  button .busy { display: none; }
  button[aria-busy="true"] { pointer-events: none; }
  button[aria-busy="true"] .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  button[aria-busy="true"] .busy { display: flex; justify-content: center; }
  .busy-mark { width: 2.75rem; height: auto; display: block; }
  ${MARK_CSS}`;

/**
 * The standalone animated files in brand/assets, for anywhere that cannot run
 * the page's script: each colourway in the `idle` and `wait` moods. They play
 * as soon as they are shown and cannot see a request for less motion, so a
 * page that uses one shows the static mark under
 * `prefers-reduced-motion: reduce`. Written by `npm run animate-mark`.
 */
export const FILES: Record<string, { mood: Moving; paint: Paint; badge?: boolean }> = {
  'mark-animated.svg': { mood: 'idle', paint: { line: '#2F4A3A', gold: '#E2B653', dot: '#E2B653', ink: '#2F4A3A' } },
  'mark-loading.svg': { mood: 'wait', paint: { line: '#2F4A3A', gold: '#E2B653', dot: '#E2B653', ink: '#2F4A3A' } },
  'mark-on-night-animated.svg': { mood: 'idle', paint: { line: '#F4F1E8', gold: '#E2B653', dot: '#E2B653', ink: '#1A2920' } },
  'mark-on-night-loading.svg': { mood: 'wait', paint: { line: '#F4F1E8', gold: '#E2B653', dot: '#E2B653', ink: '#1A2920' } },
  'mark-on-gold-animated.svg': { mood: 'idle', paint: { line: '#1A2920', gold: '#F4EDE1', dot: '#F4EDE1', ink: '#1A2920' } },
  'mark-on-gold-loading.svg': { mood: 'wait', paint: { line: '#1A2920', gold: '#F4EDE1', dot: '#F4EDE1', ink: '#1A2920' } },
  'mark-badge-animated.svg': { mood: 'idle', badge: true, paint: { line: '#2F4A3A', gold: '#E2B653', dot: '#E2B653', ink: '#2F4A3A' } },
  'mark-badge-loading.svg': { mood: 'wait', badge: true, paint: { line: '#2F4A3A', gold: '#E2B653', dot: '#E2B653', ink: '#2F4A3A' } },
};

export function markFile(name: string): string {
  const f = FILES[name];
  if (!f) throw new Error(`no animated mark called ${name}`);
  const head =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
    (f.badge ? '0 0 120 120' : '12 31 96 58') +
    '" role="img" aria-label="8&amp;80"><title>8&amp;80</title>' +
    '<!-- Generated from services/voice/src/signup/mascot.ts by `npm run animate-mark`. Do not hand-edit. -->';
  // The badge is the mark at 0.8 on its own Paper disc, as in mark-badge.svg.
  return f.badge
    ? `${head}<circle cx="60" cy="60" r="58" fill="#F4EDE1"/><g transform="translate(60 60) scale(0.8) translate(-60 -60)">${drawing(f.mood, f.paint, false, 10)}</g></svg>`
    : `${head}${drawing(f.mood, f.paint, false)}</svg>`;
}

/** For tests. */
export const PATHS = { EIGHT_FIRST, EIGHTY_FIRST };
