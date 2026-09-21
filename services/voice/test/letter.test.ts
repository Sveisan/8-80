import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { composeRecap } from '../src/recap/compose.ts';
import { letterHtml } from '../src/recap/letter.ts';

/** The same escaping the letter does, so a test asserts on what a reader sees. */
const esc = (t: string): string =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const script = loadScript();
const call = { at: new Date().toISOString(), durationMs: 12 * 60_000 };
const withCommitment = composeRecap({ ...call, commitment: 'run three times', day: 'Wednesday' }, script, {
  nextSlot: 'Tuesday at nine',
});

test('the letter carries every word the text part does', () => {
  const html = letterHtml(withCommitment);
  for (const part of withCommitment.parts) assert.ok(html.includes(esc(part.text)), part.text);
});

test('the wordmark is live text, so the brand survives a blocked image', () => {
  // BRAND.md §9. Every mail client that blocks images by default — which is
  // most of them — still has to show a headed letter rather than a bare note.
  const html = letterHtml(withCommitment);
  assert.ok(!html.includes('<img'), 'no image without RECAP_MARK_URL');
  assert.ok(html.includes('8&amp;80'), 'the wordmark is text in the document');
});

test('the mark is included only when there is somewhere to load it from', () => {
  const html = letterHtml(withCommitment, { markUrl: 'https://example.test/mark.png' });
  assert.ok(html.includes('src="https://example.test/mark.png"'));
  assert.ok(html.includes('alt=""'), 'decorative — the wordmark beside it already says the name');
});

test('the one thing is set larger than the line about how long the call ran', () => {
  const html = letterHtml(withCommitment);
  const lead = html.indexOf('run three times, Wednesday.');
  const size = html.lastIndexOf('font-size:22px', lead);
  assert.ok(size > 0 && size > html.lastIndexOf('</p>', lead), 'the lead paragraph carries the lead style');
});

test("a commitment cannot break the markup, because it is somebody else's words", () => {
  // Transcribed from a phone call and dropped into an HTML document. This is
  // exactly the shape of thing that arrives one apostrophe away from broken.
  const nasty = composeRecap(
    { ...call, commitment: 'finish the <script>alert("x")</script> & "thing"', day: 'Friday' },
    script,
    { nextSlot: 'Tuesday at nine' },
  );
  const html = letterHtml(nasty);
  assert.ok(!html.includes('<script>alert'), 'no tag from a caller reaches the document');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp; &quot;thing&quot;'));
});

test('a week with no commitment still gets a whole letter', () => {
  const html = letterHtml(composeRecap({ at: '', durationMs: 600_000 }, script));
  assert.ok(html.includes('8&amp;80'), 'headed');
  assert.ok(html.includes('— 8&amp;80'), 'signed');
  assert.ok(!html.includes('{{'), 'no slot may reach a reader');
});

test('nothing in the letter asks to be clicked', () => {
  // It is a promise the call made, not a campaign. BRAND.md §1.
  const html = letterHtml(withCommitment, { markUrl: 'https://example.test/mark.png' });
  assert.ok(!html.includes('<a '), 'no link, no button, no view-in-browser');
  assert.ok(!/unsubscribe/i.test(html));
});

test('both grounds are stated, rather than left to the client to guess', () => {
  const html = letterHtml(withCommitment);
  assert.ok(html.includes('#ECF0EA'), 'Mist, the light ground');
  assert.ok(html.includes('#16211B'), 'Night, under prefers-color-scheme: dark');
  assert.ok(html.includes('prefers-color-scheme: dark'));
});
