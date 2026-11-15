import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { coverageReady, withinCoverage } from '../src/unblock/coverage.ts';

const keys = ['UNBLOCK_COVERAGE_START', 'UNBLOCK_COVERAGE_END', 'UNBLOCK_COVERAGE_DAYS'] as const;
const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
beforeEach(() => {
  process.env['UNBLOCK_COVERAGE_START'] = '09:00'; process.env['UNBLOCK_COVERAGE_END'] = '17:00';
  process.env['UNBLOCK_COVERAGE_DAYS'] = '1,2,3,4,5';
});
after(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });

test('weekday coverage follows Oslo time and rejects evenings and weekends', () => {
  assert.ok(coverageReady());
  assert.ok(withinCoverage(new Date('2026-11-16T08:00:00Z')));
  assert.ok(withinCoverage(new Date('2026-11-20T15:59:00Z')));
  for (const iso of ['2026-11-16T07:59:00Z', '2026-11-16T16:00:00Z', '2026-11-21T11:00:00Z', '2026-11-15T11:00:00Z']) assert.equal(withinCoverage(new Date(iso)), false, iso);
});
test('missing weekday configuration preserves existing all-week behaviour', () => {
  delete process.env['UNBLOCK_COVERAGE_DAYS'];
  assert.ok(withinCoverage(new Date('2026-11-15T11:00:00Z')));
});
test('invalid or repeated coverage days fail closed', () => {
  for (const value of ['7', '1,1', '1,,2', 'Monday', '-1']) {
    process.env['UNBLOCK_COVERAGE_DAYS'] = value;
    assert.equal(coverageReady(), false, value);
    assert.equal(withinCoverage(new Date('2026-11-16T11:00:00Z')), false, value);
  }
});
test('the selected day is the local calendar day, including UTC date boundaries', () => {
  process.env['UNBLOCK_COVERAGE_START'] = '00:00'; process.env['UNBLOCK_COVERAGE_END'] = '24:00'; process.env['UNBLOCK_COVERAGE_DAYS'] = '1';
  assert.ok(withinCoverage(new Date('2026-11-15T23:00:00Z')), 'Monday midnight in Oslo');
  assert.equal(withinCoverage(new Date('2026-11-16T23:00:00Z')), false, 'Tuesday midnight in Oslo');
});
