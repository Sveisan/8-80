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
