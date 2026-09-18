import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReschedule, resolveSpokenTime } from '../src/call/reschedule.ts';
import { loadScript } from '../src/script.ts';

const script = loadScript();
const OSLO = 'Europe/Oslo';

test('the time comes from the mentor agreeing, not from the caller asking', () => {
  // The caller's own words are never parsed: somebody thinking out loud about
  // half five must not move a call the mentor never agreed to move.
  assert.equal(extractReschedule('Could you call me back at 17:30 instead?', script), undefined);
  const agreed = extractReschedule("Fine. I'll ring you back at 17:30 today.", script);
  assert.deepEqual(agreed, { hour: 17, minute: 30, day: 'today' });
});

test('a clock time elsewhere in the call does not move the week', () => {
  const spoken = "That's us. I'll call you Friday at 08:30. There's an email coming.";
  assert.equal(extractReschedule(spoken, script), undefined);
});

test('am and pm are honoured, and tomorrow is understood', () => {
  assert.deepEqual(extractReschedule("Fine. I'll ring you back at 9 am tomorrow.", script), {
    hour: 9,
    minute: 0,
    day: 'tomorrow',
  });
  assert.deepEqual(extractReschedule("Fine. I'll ring you back at 5:30 pm today.", script), {
    hour: 17,
    minute: 30,
    day: 'today',
  });
});

test('a weekday is understood', () => {
  const out = extractReschedule("Fine. I'll ring you back at 14:00 Wednesday.", script);
  assert.equal(out?.day, 3);
});

test('a vague agreement moves nothing', () => {
  // SCRIPT.md §9c: "half five" and "later this afternoon" are not times this
  // can act on, and inventing one is how somebody gets rung at the wrong hour.
  for (const vague of [
    "Fine. I'll ring you back at half five.",
    "Fine. I'll ring you back later this afternoon.",
    "Fine. I'll ring you back at some point.",
  ]) {
    assert.equal(extractReschedule(vague, script), undefined, vague);
  }
});

test('an impossible clock time is refused rather than clamped', () => {
  assert.equal(extractReschedule("Fine. I'll ring you back at 99:99 today.", script), undefined);
});

test('the resolved instant is always in the future', () => {
  // Said at 18:05, "today at 17:30" cannot have meant twenty minutes ago — and
  // a past instant would be claimed by the very next tick.
  const during = new Date('2026-09-18T16:05:00Z'); // 18:05 in Oslo
  const when = resolveSpokenTime({ hour: 17, minute: 30, day: 'today' }, OSLO, during);
  assert.ok(when.getTime() > during.getTime());
  assert.equal(when.toISOString(), '2026-09-19T15:30:00.000Z', 'the next 17:30 Oslo');
});

test('a time later today stays today', () => {
  const during = new Date('2026-09-18T08:00:00Z'); // 10:00 Oslo
  const when = resolveSpokenTime({ hour: 17, minute: 30, day: 'today' }, OSLO, during);
  assert.equal(when.toISOString(), '2026-09-18T15:30:00.000Z');
});

test('tomorrow means tomorrow, across a timezone that is not the server', () => {
  const during = new Date('2026-09-18T20:00:00Z'); // 22:00 Oslo
  const when = resolveSpokenTime({ hour: 9, minute: 0, day: 'tomorrow' }, OSLO, during);
  assert.equal(when.toISOString(), '2026-09-19T07:00:00.000Z');
});

test('a callback across the autumn clock change lands at the hour it was promised', () => {
  // Oslo leaves summer time on 25 October 2026. A callback promised for 09:00
  // must be 09:00 on the caller's own clock, not on the one the server kept.
  const before = new Date('2026-10-24T12:00:00Z');
  const when = resolveSpokenTime({ hour: 9, minute: 0, day: 1 /* Monday */ }, OSLO, before);
  assert.equal(when.toISOString(), '2026-10-26T08:00:00.000Z', '09:00 Oslo once the clocks go back');
});

test('a weekday that is today but already past goes to next week', () => {
  const friday = new Date('2026-09-18T16:00:00Z'); // Friday 18:00 Oslo
  const when = resolveSpokenTime({ hour: 9, minute: 0, day: 5 /* Friday */ }, OSLO, friday);
  assert.equal(when.toISOString(), '2026-09-25T07:00:00.000Z');
});
