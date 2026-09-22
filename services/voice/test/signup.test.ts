import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { readSignup } from '../src/signup/form.ts';
import { Limiter } from '../src/signup/limit.ts';
import { signupPage, codePage } from '../src/signup/page.ts';

const script = loadScript();
const form = (o: Record<string, string>) => new URLSearchParams(o);
const good = {
  name: 'Eirik',
  phone: '+4790033575',
  email: 'e@eirikn.com',
  weekday: '2',
  time: '08:00',
  timezone: 'Europe/Oslo',
};

test('a Norwegian number typed the way Norwegians type it', () => {
  for (const typed of ['90033575', '900 33 575', '+47 900 33 575', '0047 90033575', '+47-900-33-575']) {
    const read = readSignup(form({ ...good, phone: typed }));
    assert.ok(read.ok, typed);
    assert.equal(read.signup.phone, '+4790033575', typed);
  }
});

test('a number we cannot dial does not get a text', () => {
  // The cost of being lax here is a text to a stranger, and the stranger is
  // the one who pays for it.
  for (const bad of ['90033', 'not a number', '+0123', '', '12345678901234567890']) {
    const read = readSignup(form({ ...good, phone: bad }));
    assert.equal(read.ok, false, bad);
  }
});

test('every wrong field is reported at once', () => {
  // Somebody fat-fingering two fields on a phone should learn that once.
  const read = readSignup(form({ ...good, phone: 'x', email: 'y' }));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.deepEqual(
    read.errors.map((e) => e.field).sort(),
    ['email', 'phone'],
  );
});

test('an unknown timezone is refused rather than thrown on', () => {
  // It reaches Intl.DateTimeFormat, which throws — and a throw here is a 500
  // on the one page where a 500 costs a customer.
  const read = readSignup(form({ ...good, timezone: 'Middle/Earth' }));
  assert.equal(read.ok, false);
  assert.ok(readSignup(form({ ...good, timezone: 'America/New_York' })).ok);
});

test('an empty timezone falls back rather than failing', () => {
  const read = readSignup(form({ ...good, timezone: '' }));
  assert.ok(read.ok);
  assert.equal(read.signup.timezone, 'Europe/Oslo');
});

test('one number cannot be texted over and over by a form', () => {
  const l = new Limiter(3, 3600_000);
  const t = 1_000_000;
  assert.deepEqual([l.take('n', t), l.take('n', t), l.take('n', t), l.take('n', t)], [true, true, true, false]);
  // A different number is unaffected, and an hour later the first is free.
  assert.equal(l.take('other', t), true);
  assert.equal(l.take('n', t + 3600_001), true);
});

test('the sign-up page says it is an AI before it asks for anything', () => {
  // SCRIPT.md §11 spends a whole call refusing to pretend to be a person.
  const page = signupPage(script);
  const honest = page.indexOf('is an AI');
  const firstInput = page.indexOf('<input');
  assert.ok(honest > 0 && honest < firstInput, 'above the form, not in a footer');
  assert.ok(page.includes("ask for a card"), "the free month is stated near the button");
});

test('nothing on the sign-up page asks for a password', () => {
  // There is no account in this product and there is not going to be.
  const page = signupPage(script);
  assert.ok(!page.includes('type="password"'));
  assert.ok(!/sign in|log in|login/i.test(page));
});

test('the code page carries the number so a reload does not lose it', () => {
  const page = codePage('+4790033575', script);
  assert.ok(page.includes('value="+4790033575"'));
  assert.ok(page.includes('autocomplete="one-time-code"'), 'so the phone offers to fill it');
});

test('every line the sign-up flow says is in SCRIPT.md', () => {
  for (const key of [
    'signup.title', 'signup.what', 'signup.after', 'signup.free', 'signup.honest',
    'signup.name', 'signup.phone', 'signup.email', 'signup.when', 'signup.when.detail',
    'signup.submit', 'signup.error.name', 'signup.error.number', 'signup.error.email',
    'signup.error.weekday', 'signup.error.time', 'signup.error.timezone',
    'signup.code.title', 'signup.code.detail', 'signup.code.label', 'signup.code.submit',
    'signup.code.again', 'signup.code.wrong', 'signup.code.expired', 'signup.code.toomany',
    'signup.code.unknown', 'signup.done.title', 'signup.done.detail', 'sms.code',
  ]) {
    assert.ok(script.get(key), `${key} is missing`);
  }
});

test('the code text is shaped so a phone will autofill it', () => {
  // Code first, product named, nothing else. iOS and Android both look for
  // this shape and both give up on a sentence.
  const line = (script.get('sms.code') ?? '').replace('{{code}}', '123456');
  assert.match(line, /^\d{6}\b/);
  assert.ok(line.length < 60, line);
});
