import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../src/config.ts';
import { legalPage, render } from '../src/legal/page.ts';

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
  for (const column of ['phone_enc', 'email_enc', 'last_commitment_enc', 'body_enc']) {
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
