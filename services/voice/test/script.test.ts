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
  const lines = parseScript(SCRIPT);
  const disclosure = lines.get('open.first.disclosure') ?? '';
  assert.match(disclosure, /I'm an AI, not a person/);
  assert.match(disclosure, /say stop and I'll go/);
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
  }
});

test('the rewritten variant B no longer claims nobody is listening', () => {
  const lines = parseScript(SCRIPT);
  assert.ok(!/nobody here to be impressive for/i.test(lines.get('next.ask.b') ?? ''));
});
