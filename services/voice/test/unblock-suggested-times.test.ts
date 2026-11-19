import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedLocal, suggestedTimes } from '../src/unblock/suggested-times.ts';

test('a Friday evening suggests a weekday opening after at least a day, with separated regular and light times', () => {
  const now = new Date('2026-11-20T16:00:00Z');
  const times = suggestedTimes(now);
  assert.equal(times.opening.toISOString(), '2026-11-23T14:00:00.000Z');
  assert.ok(+times.opening >= +now + 86400_000);
  assert.deepEqual(suggestedLocal(times.regular, 'Europe/Oslo'), { weekday: 1, time: '15:00' });
  assert.deepEqual(times.light.map(at => suggestedLocal(at, 'Europe/Oslo')), [{ weekday: 1, time: '16:00' }, { weekday: 3, time: '16:00' }, { weekday: 5, time: '16:00' }]);
});
test('summer suggestions preserve Oslo hours and convert into the caller\'s local day as well as their time', () => {
  const times = suggestedTimes(new Date('2026-06-26T15:00:00Z'));
  assert.equal(times.opening.toISOString(), '2026-06-29T13:00:00.000Z');
  assert.deepEqual(suggestedLocal(times.regular, 'Asia/Tokyo'), { weekday: 1, time: '22:00' });
  assert.deepEqual(suggestedLocal(times.light[0]!, 'Pacific/Auckland'), { weekday: 2, time: '02:00' });
  assert.deepEqual(suggestedLocal(times.light[0]!, 'Pacific/Honolulu'), { weekday: 1, time: '04:00' });
});
