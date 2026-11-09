import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAPTERS, CHAPTER_WEEKS, MAX_CALLS, callPlan, chapterFor, chapterOfMonth, chapterPos, chapterTheme, nextChapter } from '../src/unblock/chapters.ts';
import { readUnblockScript } from '../src/unblock/prompt-cli.ts';

// Guards the shape every chapter must keep so a new one can be added by editing
// CHAPTERS alone. Wording is the owner's; these are the lines it must not cross.

const SAVES = new Set(['step', 'block', 'light', 'wish', 'closing', 'reflect']);
const allText = (c: (typeof CHAPTERS)[number]) =>
  [c.title, c.analogy, c.milestone, c.question, ...[...c.themes, c.close].flatMap(w => [w.title, w.question, ...w.followUps])].join('\n');

test('chapters are numbered 1..n with unique slugs', () => {
  assert.deepEqual(CHAPTERS.map(c => c.number), CHAPTERS.map((_, i) => i + 1));
  assert.equal(new Set(CHAPTERS.map(c => c.slug)).size, CHAPTERS.length);
  assert.equal(nextChapter(CHAPTERS.length), undefined);
  assert.equal(chapterFor(2)?.slug, nextChapter(1)?.slug);
});

for (const c of CHAPTERS) {
  test(`chapter ${c.number}: three themes, a closing close, only existing capture commands`, () => {
    assert.equal(c.themes.length, CHAPTER_WEEKS - 1);
    assert.equal(c.close.saves, 'closing');
    for (const w of [...c.themes, c.close]) {
      assert.ok(SAVES.has(w.saves), `${w.title}: ${w.saves}`);
      assert.match(w.question, /\?$/);
    }
    for (const w of c.themes) assert.notEqual(w.saves, 'closing', 'only the close saves the closing');
    assert.equal(c.readback, c.number === CHAPTERS.length ? 'year' : 'chapter');
  });

  test(`chapter ${c.number}: no source author, no destiny vocabulary, no scoring`, () => {
    const text = allText(c);
    assert.doesNotMatch(text, /Coelho|Alchemist|Bayer|Personal Legend|Maktub|\btreasure|\bomens?\b/i);
    assert.doesNotMatch(text, /manifest|destiny|universe|unlock your potential|transform your life|streak|score|level up/i);
    assert.doesNotMatch(text, /\b(this|next|past|coming) week\b|\ba week to\b|free month/i, 'calls are not weekly for everyone');
  });

  test(`chapter ${c.number}: renders a theme for every call of a month of 1 to ${MAX_CALLS} calls`, () => {
    for (let calls = 1; calls <= MAX_CALLS; calls++) {
      const plan = callPlan(calls);
      for (let call = 1; call <= calls; call++) {
        const theme = chapterTheme(c, call, calls);
        const close = call === calls;
        assert.equal(theme.includes(c.close.question), close, 'only the last call is the close');
        assert.equal(theme.includes(c.analogy), close || call === 1, 'picture at the first call and as the close summary');
        assert.equal(theme.includes(c.milestone), close, 'milestone only in the close');
        assert.doesNotMatch(theme, /\{\{/);
        const step = plan[call - 1]!;
        if (step.kind === 'theme') assert.ok(theme.includes(c.themes[step.index]!.question));
      }
      assert.throws(() => chapterTheme(c, calls + 1, calls), RangeError);
    }
    assert.ok(chapterTheme(c, 1).includes(c.themes[0].question), 'default is the four-call month');
  });
}

test('the call plan: the last call is always the close; fewer calls spread the themes; more add open calls', () => {
  const kinds = (n: number) => callPlan(n).map(s => s.kind === 'theme' ? `t${s.index}` : s.kind);
  assert.deepEqual(kinds(1), ['close']);
  assert.deepEqual(kinds(2), ['t0', 'close']);
  assert.deepEqual(kinds(3), ['t0', 't2', 'close']);
  assert.deepEqual(kinds(4), ['t0', 't1', 't2', 'close']);
  assert.deepEqual(kinds(6), ['t0', 't1', 't2', 'open', 'open', 'close']);
  assert.deepEqual(kinds(8), ['t0', 't1', 't2', 'open', 'open', 'open', 'open', 'close']);
  for (let n = 1; n <= MAX_CALLS; n++) assert.equal(callPlan(n).filter(s => s.kind === 'close').length, 1);
  assert.match(chapterTheme(chapterFor(2)!, 5, 6), /OPEN CALL/);
});

test('after chapter 12 the months continue at chapter 2 with a year counter', () => {
  assert.deepEqual(chapterPos(1), { number: 1, year: 1 });
  assert.deepEqual(chapterPos(12), { number: 12, year: 1 });
  assert.deepEqual(chapterPos(13), { number: 2, year: 2 });
  assert.deepEqual(chapterPos(23), { number: 12, year: 2 });
  assert.deepEqual(chapterPos(24), { number: 2, year: 3 });
  assert.equal(chapterOfMonth(13).title, chapterFor(2)!.title);
});

test('chapter 1 stays verbatim with the weekly script', () => {
  const script = readUnblockScript('weekly');
  for (const w of [...chapterFor(1)!.themes, chapterFor(1)!.close]) for (const q of [w.question, ...w.followUps]) assert.ok(script.includes(q), q);
});

test('chapters.md lists every chapter', () => {
  const doc = readFileSync(resolve(import.meta.dirname, '../../../docs/unblock/chapters.md'), 'utf8');
  for (const c of CHAPTERS) assert.ok(doc.includes(`| ${c.number} | ${c.title} |`), c.title);
});
