import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSlotAfter, parseLocalTime, parseWeekday, zonedTimeToUtc, type Slot } from '../src/schedule/time.ts';

const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };

const iso = (d: Date) => d.toISOString();

test('a slot lands on the named weekday at the named local time', () => {
  // Monday 2026-09-07, 10:00 UTC.
  const next = nextSlotAfter(new Date('2026-09-07T10:00:00Z'), OSLO);
  // Oslo is UTC+2 in September, so 08:00 local is 06:00Z, on the Tuesday.
  assert.equal(iso(next), '2026-09-08T06:00:00.000Z');
});

test('the slot advances to next week rather than firing twice', () => {
  const at = new Date('2026-09-08T06:00:00Z');
  assert.equal(iso(nextSlotAfter(at, OSLO)), '2026-09-15T06:00:00.000Z');
});

test('later the same day still finds this week', () => {
  // Tuesday 04:00Z is 06:00 in Oslo, before the 08:00 slot.
  assert.equal(iso(nextSlotAfter(new Date('2026-09-08T04:00:00Z'), OSLO)), '2026-09-08T06:00:00.000Z');
});

test('the call stays at 08:00 local across the autumn clock change', () => {
  // Europe/Oslo leaves summer time on 2026-10-25. The Tuesday before is the
  // 20th and the Tuesday after is the 27th; 08:00 local is 06:00Z then 07:00Z.
  const before = nextSlotAfter(new Date('2026-10-19T12:00:00Z'), OSLO);
  const after = nextSlotAfter(before, OSLO);
  assert.equal(iso(before), '2026-10-20T06:00:00.000Z');
  assert.equal(iso(after), '2026-10-27T07:00:00.000Z');
  // Seven days apart on the clock, eight hours more than 7×24 in UTC terms.
  assert.equal(after.getTime() - before.getTime(), 7 * 24 * 3600_000 + 3600_000);
});

test('the call stays at 08:00 local across the spring clock change', () => {
  // Oslo enters summer time on 2026-03-29. Tuesdays either side: 24th and 31st.
  const before = nextSlotAfter(new Date('2026-03-23T12:00:00Z'), OSLO);
  const after = nextSlotAfter(before, OSLO);
  assert.equal(iso(before), '2026-03-24T07:00:00.000Z');
  assert.equal(iso(after), '2026-03-31T06:00:00.000Z');
});

test('a local time that does not exist lands after the jump, not never', () => {
  // 02:30 on 2026-03-29 in Oslo is skipped entirely by the clock change.
  const at = zonedTimeToUtc(2026, 3, 29, 2 * 60 + 30, 'Europe/Oslo');
  assert.ok(at.getTime() > 0);
  assert.equal(iso(at), '2026-03-29T01:30:00.000Z'); // 03:30 local, the instant after the gap
});

test('zones far from Oslo work the same way', () => {
  const tokyo: Slot = { weekday: 1, minute: 9 * 60, timezone: 'Asia/Tokyo' };
  // Monday 09:00 JST is Monday 00:00Z. Japan has no daylight saving.
  assert.equal(iso(nextSlotAfter(new Date('2026-09-06T00:00:00Z'), tokyo)), '2026-09-07T00:00:00.000Z');
});

test('weekdays and times are read the way someone would type them', () => {
  assert.equal(parseWeekday('Tuesday'), 2);
  assert.equal(parseWeekday('tue'), 2);
  assert.equal(parseWeekday('2'), 2);
  assert.equal(parseWeekday('someday'), undefined);
  assert.equal(parseLocalTime('08:00'), 480);
  assert.equal(parseLocalTime('8:05'), 485);
  assert.equal(parseLocalTime('24:00'), undefined);
  assert.equal(parseLocalTime('eight'), undefined);
});
