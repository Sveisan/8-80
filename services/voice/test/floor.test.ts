import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoiseFloor } from '../src/audio/floor.ts';

test('a quiet line keeps the configured threshold', () => {
  const f = new NoiseFloor(0.035);
  for (let i = 0; i < 100; i++) f.observe(0.001);
  assert.ok(f.threshold <= 0.036, `threshold drifted to ${f.threshold}`);
  assert.equal(f.observe(0.08), true, 'speech must still register');
  assert.equal(f.observe(0.01), false, 'and quiet must still be quiet');
});

test('a noisy line lifts the threshold above the noise', () => {
  // A café: the background alone sits above the fixed threshold, so with a
  // fixed threshold the line is never silent and the turn never ends.
  const f = new NoiseFloor(0.035);
  for (let i = 0; i < 100; i++) f.observe(0.05 + Math.random() * 0.01);
  assert.ok(f.threshold > 0.05, `threshold ${f.threshold} is still inside the noise`);
  assert.equal(f.observe(0.055), false, 'background must not read as speech');
  assert.equal(f.observe(0.25), true, 'the caller must still be heard over it');
});

test('the floor follows the room when it goes quiet again', () => {
  const f = new NoiseFloor(0.035);
  for (let i = 0; i < 100; i++) f.observe(0.06);
  const noisy = f.threshold;
  for (let i = 0; i < 100; i++) f.observe(0.002);
  assert.ok(f.threshold < noisy, 'leaving the café should lower the bar again');
});

test('continuous speech with no gaps never makes the line deaf to itself', () => {
  // The floor is only meaningful once the window has heard some quiet. Someone
  // who talks without pausing would otherwise become their own noise floor.
  const f = new NoiseFloor(0.035);
  for (let i = 0; i < 100; i++) f.observe(0.9);
  assert.equal(f.observe(0.9), true, 'the speaker must still be heard');
});
