import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAPTERS, CHAPTER_WEEKS, chapterFor, chapterTheme, nextChapter } from '../src/unblock/chapters.ts';
import { readUnblockScript } from '../src/unblock/prompt-cli.ts';

// Guards the shape every chapter must keep so a new one can be added by editing
// CHAPTERS alone. Wording is the owner's; these are the lines it must not cross.

const SAVES = new Set(['step', 'block', 'light', 'wish', 'closing', 'reflect']);
const allText = (c: (typeof CHAPTERS)[number]) =>
  [c.title, c.analogy, c.milestone, c.question, ...c.weeks.flatMap(w => [w.title, w.question, ...w.followUps])].join('\n');

test('chapters are numbered 1..n with unique slugs', () => {
  assert.deepEqual(CHAPTERS.map(c => c.number), CHAPTERS.map((_, i) => i + 1));
  assert.equal(new Set(CHAPTERS.map(c => c.slug)).size, CHAPTERS.length);
  assert.equal(nextChapter(CHAPTERS.length), undefined);
  assert.equal(chapterFor(2)?.slug, nextChapter(1)?.slug);
});

for (const c of CHAPTERS) {
  test(`chapter ${c.number}: four weeks, closing last, only existing capture commands`, () => {
    assert.equal(c.weeks.length, CHAPTER_WEEKS);
    assert.equal(c.weeks.at(-1)!.saves, 'closing');
    for (const w of c.weeks) {
      assert.ok(SAVES.has(w.saves), `${w.title}: ${w.saves}`);
      assert.match(w.question, /\?$/);
    }
    assert.equal(c.readback, c.number === CHAPTERS.length ? 'year' : 'chapter');
  });

  test(`chapter ${c.number}: no source author, no destiny vocabulary, no scoring`, () => {
    const text = allText(c);
    assert.doesNotMatch(text, /Coelho|Alchemist|Bayer|Personal Legend|Maktub|\btreasure|\bomens?\b/i);
    assert.doesNotMatch(text, /manifest|destiny|universe|unlock your potential|transform your life|streak|score|level up/i);
  });

  test(`chapter ${c.number}: renders a theme for every week`, () => {
    for (let w = 1; w <= CHAPTER_WEEKS; w++) {
      const theme = chapterTheme(c, w);
      assert.ok(theme.includes(c.weeks[w - 1]!.question));
      assert.equal(theme.includes(c.analogy), w === 1, 'picture only in week 1');
      assert.equal(theme.includes(c.milestone), w === CHAPTER_WEEKS, 'milestone only in the close');
      assert.doesNotMatch(theme, /\{\{/);
    }
    assert.throws(() => chapterTheme(c, CHAPTER_WEEKS + 1), RangeError);
  });
}

test('chapter 1 stays verbatim with the weekly script', () => {
  const script = readUnblockScript('weekly');
  for (const w of chapterFor(1)!.weeks) for (const q of [w.question, ...w.followUps]) assert.ok(script.includes(q), q);
});

test('chapters.md lists every chapter', () => {
  const doc = readFileSync(resolve(import.meta.dirname, '../../../docs/unblock/chapters.md'), 'utf8');
  for (const c of CHAPTERS) assert.ok(doc.includes(`| ${c.number} | ${c.title} |`), c.title);
});
