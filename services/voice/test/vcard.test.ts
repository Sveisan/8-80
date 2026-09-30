import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { contactNumber, vcard } from '../src/link/vcard.ts';
import { reschedulePage } from '../src/link/page.ts';
import { controlPlane } from '../src/control.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

/**
 * The contact card: the name on the call screen exists only if it is in their
 * address book. ARCHITECTURE.md, "The vCard is the only branding channel".
 */

const script = loadScript();
const OSLO = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };

afterEach(() => {
  for (const k of ['SMS_FROM_NUMBER', 'SPEECHIFY_CALLER_ID_NUMBER', 'PUBLIC_URL']) delete process.env[k];
});

test('the number on the card is E.164 exactly, or there is no card', () => {
  assert.equal(contactNumber({ SMS_FROM_NUMBER: '+47 900 08 800' }), '+4790008800', 'spaces would fail the handset match');
  assert.equal(contactNumber({ SPEECHIFY_CALLER_ID_NUMBER: '+4790008800' }), '+4790008800', 'the call number without a text one');
  assert.equal(contactNumber({ SMS_FROM_NUMBER: '+4790008800', SPEECHIFY_CALLER_ID_NUMBER: '+4740008800' }), '+4790008800');
  assert.equal(contactNumber({ SMS_FROM_NUMBER: '90008800' }), undefined, 'no country code is not a number a handset will match');
  assert.equal(contactNumber({}), undefined);
});

test('the card is vCard 3.0, named from SCRIPT.md, with the number and a photo', () => {
  const card = vcard(script, '+4790008800', 'https://8and80.me');
  assert.ok(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'), 'CRLF, 3.0');
  assert.ok(card.endsWith('END:VCARD\r\n'));
  assert.ok(card.includes(`FN:${script.get('contact.name')}\r\n`));
  assert.ok(card.includes('TEL;TYPE=CELL,VOICE:+4790008800\r\n'));
  assert.ok(card.includes('URL:https://8and80.me\r\n'));
  assert.ok(card.includes('PHOTO;ENCODING=b;TYPE=PNG:iVBOR'), 'a PNG, so something is where a face would be');
  for (const row of card.split('\r\n')) assert.ok(Buffer.byteLength(row) <= 75, `folded at 75 octets: ${row.slice(0, 20)}…`);
  // Unfolded, the photo is still one intact PNG.
  const photo = card.replace(/\r\n /g, '').match(/PHOTO;ENCODING=b;TYPE=PNG:([A-Za-z0-9+/=]+)/)?.[1] ?? '';
  assert.equal(Buffer.from(photo, 'base64').subarray(1, 4).toString(), 'PNG');
});

test('a name with a comma or semicolon does not break the card', () => {
  const card = vcard(new Map([['contact.name', 'Eight, and; eighty']]), '+4790008800');
  assert.ok(card.includes('FN:Eight\\, and\\; eighty\r\n'));
});

test('the page offers the card before the first call, and only when asked to', () => {
  const first = new Date('2026-10-06T06:00:00Z');
  const offered = reschedulePage(OSLO, script, 'en', undefined, undefined, { first, contact: true });
  assert.ok(offered.includes('href="/contact.vcf"'));
  assert.ok(offered.indexOf('href="/contact.vcf"') < offered.indexOf('name="weekday"'), 'above the time, not under it');
  const without = reschedulePage(OSLO, script, 'en', undefined, undefined, { first });
  assert.ok(!without.includes('/contact.vcf'));
});

test('/contact.vcf is served as an attachment, and is not there without a number', async () => {
  const deps = { script } as unknown as LoopDeps;
  const server = controlPlane(deps, 'whsec_x');
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/contact.vcf`)).status, 404, 'a card with no number is worse than none');

    process.env['SMS_FROM_NUMBER'] = '+4790008800';
    process.env['PUBLIC_URL'] = 'https://8and80.me';
    const res = await fetch(`${base}/contact.vcf`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/vcard/);
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="8and80\.vcf"/);
    assert.ok((await res.text()).includes('TEL;TYPE=CELL,VOICE:+4790008800'));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
