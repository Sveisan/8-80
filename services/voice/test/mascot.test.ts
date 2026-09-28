import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS, mascot } from '../src/signup/mascot.ts';

const points = (d: string): Array<[number, number]> => {
  const n = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i] as number, n[2 * i + 1] as number]);
};

test('the traded mark is traced in the same order, so the warp never collapses', () => {
  // The first attempt morphed the mark against its plain mirror, and halfway
  // every x landed on the axis: a vertical bar. Tracing the traded drawing
  // left loop first keeps every point inside its own loop.
  const a = points(PATHS.EIGHT_FIRST);
  const b = points(PATHS.EIGHTY_FIRST);
  assert.equal(a.length, b.length, 'the same number of points, or SMIL cannot interpolate');
  assert.equal(PATHS.EIGHT_FIRST.replace(/[^MCZ]/g, ''), PATHS.EIGHTY_FIRST.replace(/[^MCZ]/g, ''));
  const xs = a.map(([x], i) => (x + (b[i] as [number, number])[0]) / 2);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 70, 'halfway is still as wide as the mark');
});

test('the mark only moves once a page says it may', () => {
  // SMIL cannot see prefers-reduced-motion, so nothing begins on its own.
  const moving = mascot('wait');
  assert.ok(moving.includes('<animate'));
  assert.ok(!/<animate(?![^>]*begin="indefinite")/.test(moving), 'every animation waits to be started');
  assert.ok(!mascot('rest').includes('<animate'), 'at rest it is just the mark');
});

test('the gold is never in both loops at once', () => {
  // Half-strength Gold over Night is olive, which is not in the palette. The
  // gold hands over through the dot instead, so at every moment of every mood
  // at most one loop holds any.
  for (const mood of ['idle', 'wait', 'talk', 'nudge'] as const) {
    const svg = mascot(mood);
    const tracks = [...svg.matchAll(/attributeName="fill-opacity"[^>]*keyTimes="([^"]+)"[^>]*values="([^"]+)"/g)].map(
      ([, times, values]) => ({ times: times!.split(';').map(Number), values: values!.split(';').map(Number) }),
    );
    assert.equal(tracks.length, 2, `${mood} fills each loop`);
    const at = (tr: { times: number[]; values: number[] }, x: number): number => {
      const i = tr.times.findIndex((t) => t >= x);
      if (tr.times[i] === x) return tr.values[i]!;
      // Between keys a spline stays between its two ends, so the larger end bounds it.
      return Math.max(tr.values[i - 1]!, tr.values[i]!);
    };
    for (let x = 0; x <= 1; x += 0.001) {
      const [l, r] = tracks.map((tr) => at(tr, x));
      assert.ok(l === 0 || r === 0, `${mood} has gold in both loops at ${x.toFixed(3)}`);
    }
  }
});
