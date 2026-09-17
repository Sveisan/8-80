import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScript } from '../src/script.ts';

const SCRIPT = readFileSync(resolve(import.meta.dirname, '../../../SCRIPT.md'), 'utf8');

test('parses keyed lines out of SCRIPT.md', () => {
  const lines = parseScript(SCRIPT);
  assert.ok(lines.size > 25, `expected many lines, got ${lines.size}`);
  assert.equal(lines.get('nothing.c'), 'Mm.');
  assert.match(lines.get('open.return.callback') ?? '', /^Last week you said/);
});

test('joins multi-line quoted blocks into one utterance', () => {
  // Against a fixture, not against SCRIPT.md's wording. The parser's job is to
  // join; the copy is Eirik's to rewrite, and a test that fails when he warms a
  // sentence is a test that teaches people to stop warming sentences.
  // One opening quote and one closing quote across the whole block, which is how
  // SCRIPT.md wraps a long line — the quotes mark the utterance, not each row.
  const lines = parseScript('`x.y`\n> "first line\n> second line"\n');
  assert.equal(lines.get('x.y'), 'first line second line');
});

test('the disclosure still says the two things it exists to say', () => {
  const disclosure = parseScript(SCRIPT).get('open.first.disclosure') ?? '';
  // Not phrasing — these are the reasons the line exists at all, and a rewrite
  // that loses either of them is the one edit to this file that matters.
  assert.match(disclosure, /\bAI\b/, 'it must say it is an AI');
  assert.match(disclosure, /stop/i, 'it must say they can stop');
  assert.ok(!disclosure.includes('\n'));
});

test('every variant the config can select actually exists', () => {
  const lines = parseScript(SCRIPT);
  for (const id of ['nothing.a','nothing.b','nothing.c','next.ask.a','next.ask.b','next.ask.c','close.q.a','close.q.b','close.q.c','nothing.pattern','time.five_left','time.limit']) {
    assert.ok(lines.get(id), `missing script line ${id}`);
  }
});

test('the product voice rules hold across every spoken line', () => {
  const lines = parseScript(SCRIPT);
  for (const [id, text] of lines) {
    assert.ok(!text.includes('!'), `${id} contains an exclamation mark`);
    assert.ok(!/\b(amazing|great job|well done)\b/i.test(text), `${id} congratulates`);
    // A stray quote means somebody quoted each wrapped row instead of the block,
    // and the mentor would read the quote out loud.
    assert.ok(!text.includes('"'), `${id} has a stray quote mark`);
  }
});

test('the rewritten variant B no longer claims nobody is listening', () => {
  const lines = parseScript(SCRIPT);
  assert.ok(!/nobody here to be impressive for/i.test(lines.get('next.ask.b') ?? ''));
});
