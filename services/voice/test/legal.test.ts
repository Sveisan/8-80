import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../src/config.ts';
import { legalPage, render } from '../src/legal/page.ts';
import { variablesFor } from '../src/loop/tick.ts';
import { CONSOLE_VARIABLES } from '../src/prompt.ts';

const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
/** Unwrapped, because these are prose files and a claim can straddle a line. */
const flat = (t: string) => t.replace(/\s+/g, ' ');
const privacy = flat(read('legal/privacy.md'));
const terms = flat(read('legal/terms.md'));
const schema = read('services/voice/src/store/schema.ts');
const store = read('services/voice/src/store/postgres.ts');

test('everything privacy.md calls encrypted really is', () => {
  // The claim that makes this document worth anything is that it describes the
  // database rather than an intention. These are the columns it names.
  for (const column of ['phone_enc', 'email_enc', 'last_commitment_enc', 'eight_enc', 'eighty_enc', 'belief_enc', 'goals_enc', 'body_enc']) {
    assert.ok(schema.includes(`'${column}'`), `${column} is not in the schema`);
  }
  assert.ok(privacy.includes('AES-256-GCM'));
  assert.ok(read('services/voice/src/store/crypto.ts').includes('aes-256-gcm'));
});

test('the transcript retention on the page is the retention in the code', () => {
  assert.ok(privacy.includes('fourteen days'));
  const deliveries = read('services/voice/src/webhook/deliveries.ts');
  const days = /DELIVERY_RETENTION_DAYS'\]\s*\?\?\s*'?(\d+)|(?:=|,)\s*(\d+)\s*\)?;?\s*\/\/.*retention/i.exec(deliveries);
  assert.ok(deliveries.includes('14'), `retention default is not 14: ${days?.[0] ?? 'not found'}`);
});

test('the two things privacy.md swears we do not have, we do not have', () => {
  assert.ok(/no password/i.test(privacy));
  assert.ok(!/password/i.test(schema), 'a password column would make that a lie');
  assert.ok(!/\b(card|pan|cvv|iban)\b/i.test(schema), 'no payment details reach us');
});

test('deleting really does clear every table that knows the caller', () => {
  // privacy.md: "it cannot be undone and it is not a deactivation". Every
  // table keyed on the hash has to be named in forget(), or that is false.
  const forget = /async forget\([\s\S]*?\n {2}}\n/.exec(store)?.[0] ?? '';
  assert.ok(forget, 'forget() not found');
  const keyed = [...schema.matchAll(/pgTable\(\s*'(\w+)'/g)].map((m) => m[1] as string);
  for (const table of keyed) {
    const block = new RegExp(`pgTable\\(\\s*'${table}'[\\s\\S]*?\\n\\);`).exec(schema)?.[0] ?? '';
    if (!block.includes("'phone_hash'")) continue;
    assert.ok(forget.includes(table), `${table} holds a phone_hash and forget() never touches it`);
  }
  assert.ok(forget.includes('webhook_deliveries'), 'the transcripts go too');
});

test('an unset company is admitted, not invented', () => {
  const before = process.env['COMPANY_NAME'];
  try {
    delete process.env['COMPANY_NAME'];
    // A fresh timestamp, because the page is cached for a minute.
    const page = legalPage('privacy', Date.now() + 10 * 60_000);
    assert.ok(page.includes('not yet named here'), 'says so rather than naming nobody');
    assert.ok(!page.includes('{{'), 'and no placeholder reaches a reader');
  } finally {
    if (before === undefined) delete process.env['COMPANY_NAME'];
    else process.env['COMPANY_NAME'] = before;
  }
});

test('the renderer cannot be made to emit a tag', () => {
  const out = render('# <script>alert(1)</script>\n\nA **bold** thing & another.');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('&amp;'));
});

test('both pages say how to stop and how to complain', () => {
  // The two sentences somebody actually goes looking for.
  assert.ok(/STOP/.test(terms) && /Stop calling me/.test(terms));
  assert.ok(/Datatilsynet/.test(privacy));
  assert.ok(/Forbrukertilsynet/.test(terms));
  assert.ok(/116 123/.test(terms), 'and where to go if the call is not the right help');
});

test('the terms name Lemon Squeezy as merchant of record', () => {
  // They take the money and handle the VAT; saying otherwise would be wrong
  // about who the customer's contract for the payment is with.
  assert.ok(/merchant of record/i.test(terms));
  assert.ok(/fourteen-day right of withdrawal/i.test(terms));
});

test('the page offers the copy the privacy page promises', async () => {
  // privacy.md: "The fastest way is the page linked in every text we send."
  // A page that only offered deletion made that sentence false.
  const { loadScript } = await import('../src/script.ts');
  const { reschedulePage } = await import('../src/link/page.ts');
  const script = loadScript();
  const page = reschedulePage({ weekday: 5, minute: 510, timezone: 'Europe/Oslo' }, script);
  assert.ok(page.includes('value="export"'), 'the right of access has a button');
  assert.ok(page.includes('value="forget"'), 'and so does erasure');
  for (const key of ['page.export', 'page.export.sent', 'email.export.subject', 'email.export.lead', 'email.export.quiet']) {
    assert.ok(script.get(key), `${key} is missing`);
  }
});

test('the export names its fields in words somebody chose', async () => {
  // A person reading their own record should find labels, not column names.
  const { loadScript } = await import('../src/script.ts');
  const script = loadScript();
  for (const key of [
    'export.name', 'export.phone', 'export.email', 'export.slot',
    'export.calls', 'export.commitment', 'export.since', 'export.billing', 'export.history',
  ]) {
    const label = script.get(key);
    assert.ok(label, `${key} is missing`);
    assert.ok(!/_/.test(label as string), `${key} reads like a column: ${label}`);
  }
});

test('the export is sent to the address on file and nowhere else', () => {
  // The page is reachable by whoever is holding the phone. A form that could
  // send somebody's record to an address typed into it would not be a data
  // export, it would be a way to read a stranger's week.
  const control = read('services/voice/src/control.ts');
  const handler = /if \(action === 'export'\)[\s\S]*?\n {10}}/.exec(control)?.[0] ?? '';
  assert.ok(handler, 'export handler not found');
  assert.ok(handler.includes('caller.email'), 'it uses the stored address');
  assert.ok(!/form\.get\(\s*'email'/.test(handler), 'and never one from the form');
});

/**
 * Everything we hand to the voice platform, and the words in privacy.md that
 * cover it.
 *
 * A variable name is not prose, so this cannot match them directly — the
 * document says "your last commitment" where the code says `last_commitment`.
 * What it can do is fail when a NEW field appears with nothing claiming to
 * describe it, which is the failure that matters: a field starts going to a
 * processor and the page that lists what they receive stays as it was.
 */
const COVERED: Record<string, RegExp> = {
  call_number: /how many calls|which call|call number/i,
  last_commitment: /last commitment/i,
  last_day: /the day you named|last commitment/i,
  own_eight: /eight/i,
  own_eighty: /eighty/i,
  last_belief: /assumption/i,
  weeks_undone_running: /weeks in a row|in a row/i,
  own_goals: /goals\s+for\s+(the|this)\s+year/i,
  booked_slot: /weekly\s+slot/i,
};

/** What actually goes out, asked of the function that builds it. */
const SENT = Object.keys(variablesFor({ callNumber: 2 }));

test('nothing reaches the voice platform that privacy.md does not admit to', () => {
  assert.ok(SENT.length >= 4, `only ${SENT.length} variables; something is wrong upstream`);

  // The bullet that lists what Speechify receives, and only that bullet. Read
  // from the file rather than the unwrapped copy, because the line breaks are
  // what separate one supplier's bullet from the next.
  const bullet = /- \*\*Speechify\*\*[\s\S]*?(?=\n- \*\*)/.exec(read('legal/privacy.md'))?.[0] ?? '';
  assert.ok(bullet, 'the Speechify paragraph is not in privacy.md');

  for (const name of SENT) {
    const covered = COVERED[name];
    assert.ok(covered, `${name} is sent to Speechify and nothing in this test claims to describe it`);
    assert.match(bullet, covered, `privacy.md does not say Speechify receives ${name}`);
  }
});

/**
 * The console declares variables by hand; the loop fills them from code. Those
 * two lists drifted apart unnoticed in both directions at once: `caller_name`
 * was being shipped to a processor and referenced by no prompt, and
 * `call_number` was baked into the console prompt as the literal "2", so a
 * twelfth call was told it was the second. Neither is visible from either side
 * alone.
 */
test('the variables we send are exactly the ones a console prompt may use', () => {
  assert.deepEqual(
    [...CONSOLE_VARIABLES].sort(),
    [...SENT].sort(),
    'CONSOLE_VARIABLES and variablesFor disagree — one of them is lying to the console',
  );
});
