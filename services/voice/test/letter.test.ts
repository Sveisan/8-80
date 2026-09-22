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

/** The px size of the cell a given sentence is set in. */
const sizeOf = (html: string, text: string): number => {
  const at = html.indexOf(esc(text));
  assert.ok(at > 0, `${text} is not in the letter`);
  const cell = html.lastIndexOf('<td', at);
  const size = /font-size:(\d+)px/.exec(html.slice(cell, at));
  assert.ok(size, `no font-size on the cell holding ${text}`);
  return Number(size[1]);
};

test('the one thing is set far larger than the line about how long the call ran', () => {
  // One focal point. The whole job of this email is to be findable on a
  // Thursday by somebody scrolling, so the step down has to be a step, not a
  // nudge — the first draft set them three pixels apart.
  const html = letterHtml(withCommitment);
  const lead = sizeOf(html, 'run three times, Wednesday.');
  const quiet = sizeOf(html, 'We spoke for 12 minutes.');
  assert.ok(lead >= quiet * 1.8, `lead ${lead}px vs quiet ${quiet}px`);
});

test('no style attribute is cut short by a quote inside it', () => {
  // A font stack written with "Segoe UI" closes the style attribute early. The
  // rest of the declaration is then parsed as stray attributes and the element
  // loses its size, weight and colour along with its font — which is what
  // happened to the first letter that went out, and it looked like plain text
  // in every client. Single quotes are valid CSS and survive the attribute.
  const html = letterHtml(withCommitment, { markUrl: 'https://example.test/m.png', date: '21 September' });
  for (let at = html.indexOf('style="'); at >= 0; at = html.indexOf('style="', at + 1)) {
    const end = html.indexOf('"', at + 7);
    assert.ok(end > 0, 'an unterminated style attribute');
    // What follows a properly closed attribute is a space, a > or a /.
    assert.ok(' >/'.includes(html[end + 1] ?? ''), `style attribute ends mid-value: ${html.slice(at, end + 1)}`);
  }
});

test('the letterhead carries the date, and survives not having one', () => {
  assert.ok(letterHtml(withCommitment, { date: '21 September' }).includes('21 September'));
  const undated = letterHtml(withCommitment);
  assert.ok(!undated.includes('undefined'), 'an absent date leaves no trace');
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
  assert.ok(html.includes('#F4EDE1'), 'Paper, the light ground');
  assert.ok(html.includes('#1A2920'), 'Night, under prefers-color-scheme: dark');
  assert.ok(html.includes('prefers-color-scheme: dark'));
});

test('the letterhead image is served by us, not by an image CDN', async () => {
  // A remote image in an email tells whoever serves it the moment somebody
  // opened their recap. On our own host that is a line we choose not to write.
  // On a third party's it is a record, on an account we may not even own, of
  // when private accountability emails were read.
  const { config } = await import('../src/config.ts');
  const before = { public: process.env['PUBLIC_URL'], mark: process.env['RECAP_MARK_URL'] };
  try {
    delete process.env['RECAP_MARK_URL'];
    process.env['PUBLIC_URL'] = 'https://8and80.me/';
    assert.equal(config.recap.markUrl(), 'https://8and80.me/mark.png', 'trailing slash and all');
    process.env['RECAP_MARK_URL'] = 'https://elsewhere.test/m.png';
    assert.equal(config.recap.markUrl(), 'https://elsewhere.test/m.png', 'still overridable');
    delete process.env['RECAP_MARK_URL'];
    delete process.env['PUBLIC_URL'];
    assert.equal(config.recap.markUrl(), '', 'no host means no image, not a broken one');
  } finally {
    if (before.public === undefined) delete process.env['PUBLIC_URL'];
    else process.env['PUBLIC_URL'] = before.public;
    if (before.mark === undefined) delete process.env['RECAP_MARK_URL'];
    else process.env['RECAP_MARK_URL'] = before.mark;
  }
});

test('the file that route serves is on disk and is a PNG', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repoRoot } = await import('../src/config.ts');
  const png = readFileSync(resolve(repoRoot, 'brand', 'assets', 'mark-email.png'));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Shown at 40px. Anything smaller than 2x is a smudge on a retina screen.
  assert.ok(png.readUInt32BE(16) >= 80, `${png.readUInt32BE(16)}px wide`);
});

test('the column is held to 500px in Outlook too', () => {
  // Outlook on Windows renders with Word, which ignores max-width. Without the
  // ghost table the letter runs the full width of a maximised window and the
  // one thing arrives as one very long line.
  const html = letterHtml(withCommitment);
  const open = html.indexOf('<!--[if mso]>');
  const close = html.indexOf('<![endif]-->', open);
  assert.ok(open > 0 && close > open, 'the ghost table is opened');
  assert.ok(html.slice(open, close).includes('width="500"'), 'and it fixes the width');
  assert.ok(html.includes('<!--[if mso]></td></tr></table><![endif]-->'), 'and it is closed');
  assert.ok(html.indexOf('max-width:500px') > open, 'the real table is still inside it');
});
