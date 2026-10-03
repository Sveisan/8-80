import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { readSignup } from '../src/signup/form.ts';
import { Limiter } from '../src/signup/limit.ts';
import { signupPage, codePage, startingPoint } from '../src/signup/page.ts';

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

test('the sign-up page says it is an AI, first among its questions', () => {
  // SCRIPT.md §11 spends a whole call refusing to pretend to be a person, and
  // §15 requires that nobody can reach the end of this page without having been
  // able to read that. The line used to sit above the form; the owner moved it
  // into the questions under the button on 2026-09-27, on the condition that it
  // comes first there. So the requirement is unchanged and this test is how it
  // is held: a page that buries it fourth fails, as does one that drops it.
  const page = signupPage(script);
  assert.match(page, /\ban AI\b/i, 'the page no longer says what is on the other end');

  const first = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(page)?.[1] ?? '';
  assert.ok(first, 'no questions on the page — this test is checking nothing');
  assert.match(first, /Who&#39;s on the other end\?/, `the first question is "${first.trim()}"`);
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
    // The shortened page: one headline, a label inside the email field, and the
    // five questions under the button that carry what the page used to say.
    'signup.headline', 'signup.headline.second', 'signup.email.short',
    'signup.faq.ai', 'signup.faq.what', 'signup.faq.recap', 'signup.faq.move', 'signup.faq.cost',
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

test('the form will not open without a way to send the code', async () => {
  // Without Twilio, /start takes somebody's number, writes the code to a file
  // on a server they will never see, and says "check your texts". A dead end
  // that looks like success is the worst failure this page has available.
  const { config } = await import('../src/config.ts');
  const before = {
    open: process.env['SIGNUP_OPEN'],
    sid: process.env['TWILIO_ACCOUNT_SID'],
    token: process.env['TWILIO_AUTH_TOKEN'],
    from: process.env['SMS_FROM_NUMBER'],
  };
  try {
    process.env['SIGNUP_OPEN'] = '1';
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']) delete process.env[k];
    assert.equal(config.signup.open(), false, 'no SMS at all');

    process.env['TWILIO_ACCOUNT_SID'] = 'AC1';
    process.env['TWILIO_AUTH_TOKEN'] = 'tok';
    assert.equal(config.signup.open(), false, 'half configured is still closed');

    process.env['SMS_FROM_NUMBER'] = '+15074805619';
    assert.equal(config.signup.open(), true);

    process.env['SIGNUP_OPEN'] = '';
    assert.equal(config.signup.open(), false, 'and the switch still has to be on');
  } finally {
    for (const [k, v] of Object.entries({
      SIGNUP_OPEN: before.open,
      TWILIO_ACCOUNT_SID: before.sid,
      TWILIO_AUTH_TOKEN: before.token,
      SMS_FROM_NUMBER: before.from,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('a messaging service silently overrides the number it owns', async () => {
  // The number page goes on showing its own webhook, so this is invisible from
  // the console: set correctly, displayed correctly, and every STOP swallowed.
  const { effectiveInbound } = await import('../src/outside.ts');
  const ours = 'https://8and80.me/webhooks/sms';
  assert.equal(effectiveInbound({ onNumber: false, serviceUrl: ours, numberUrl: 'https://else.where' }), ours);
  assert.equal(
    effectiveInbound({ onNumber: false, serviceUrl: '', numberUrl: ours }),
    '',
    'a service with no inbound URL means inbound texts go nowhere, whatever the number says',
  );
  assert.equal(effectiveInbound({ onNumber: true, serviceUrl: 'https://else.where', numberUrl: ours }), ours);
});

test('a text that failed to send is said so, not left as a silence', () => {
  // The page used to say "check your texts" whether or not a text had left the
  // building, so the first real sign-up sat waiting for a message that was
  // never coming — and, as far as they knew, had worked.
  const told = codePage('+4790033575', script, 'signup.code.notsent');
  assert.ok(told.includes('couldn') && told.includes('text'), told.slice(0, 400));
  assert.ok(told.includes('hei@8and80.me'), 'and a human to write to when it keeps failing');
  // The rate-limited case renders the plain page on purpose: telling a script
  // which numbers are limited tells it which numbers it has reached.
  assert.ok(!codePage('+4790033575', script).includes('hei@8and80.me'));
});

test('config imports nothing of ours, because a cycle through it took the site down', async () => {
  // config.ts imported smsConfigured from sms/index.ts, which imports
  // sms/file.ts, which imports repoRoot from config.ts. With ESM a cycle
  // through a `const` is a live grenade: whichever module the process
  // evaluates first wins and the other reads an uninitialised binding. It ran
  // in development and killed the control plane on deploy.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repoRoot } = await import('../src/config.ts');
  const source = readFileSync(resolve(repoRoot, 'services/voice/src/config.ts'), 'utf8');
  const ours = [...source.matchAll(/^import .* from '(\.[^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(ours, [], `config.ts must stay a leaf; it imports ${ours.join(', ')}`);
});

test('/health answers HEAD, because that is what asks', async () => {
  // Every uptime monitor uses HEAD, and `curl -I` is how a person checks by
  // hand — so the one command somebody reaches for to ask "is it up" was the
  // one command guaranteed to answer 404.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repoRoot } = await import('../src/config.ts');
  const control = readFileSync(resolve(repoRoot, 'services/voice/src/control.ts'), 'utf8');
  const health = /url\.pathname === '\/health'[\s\S]{0,400}/.exec(control)?.[0] ?? '';
  assert.ok(health.includes("'HEAD'"), '/health must accept HEAD as well as GET');
});

test('the reachability probe retries a 5xx, because a deploy makes one', async () => {
  // systemctl restart returns before the process is listening, so the
  // documented deploy lands the probe inside a window where Caddy is right to
  // say 502. A diagnostic that cries during a normal deploy is one somebody
  // learns to ignore.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { repoRoot } = await import('../src/config.ts');
  const outside = readFileSync(resolve(repoRoot, 'services/voice/src/outside.ts'), 'utf8');
  assert.match(outside, /res\.status < 500/, 'a sub-500 answer is returned immediately');
  assert.match(outside, /ATTEMPTS = [2-9]/, 'and a 5xx is tried again');
});

test('the day and time rows open on today and the next quarter hour, in Norway', () => {
  // 10:07 in Oslo on a Tuesday (CEST): fifteen minutes on is 10:22, so 10:30.
  assert.deepEqual(startingPoint(new Date('2026-09-29T08:07:00Z')), { weekday: '2', time: '10:30' });
  // Winter time, an hour behind summer's offset: 10:00 in Oslo is 10:15.
  assert.deepEqual(startingPoint(new Date('2026-12-01T09:00:00Z')), { weekday: '2', time: '10:15' });
  // Before the row starts, its first time, today.
  assert.deepEqual(startingPoint(new Date('2026-09-29T02:00:00Z')), { weekday: '2', time: '06:00' });
  // After it ends, tomorrow morning is offered rather than this morning next week.
  assert.deepEqual(startingPoint(new Date('2026-09-29T20:50:00Z')), { weekday: '3', time: '08:00' });
  assert.deepEqual(startingPoint(new Date('2026-10-02T20:00:00Z')), { weekday: '6', time: '08:00' });
  assert.deepEqual(startingPoint(new Date('2026-10-03T20:00:00Z')), { weekday: '0', time: '08:00' });
  // Just before midnight UTC is already Wednesday in Oslo.
  assert.equal(startingPoint(new Date('2026-09-29T22:30:00Z')).weekday, '3');

  const page = signupPage(script, {}, 'en', new Date('2026-09-29T08:07:00Z'));
  assert.match(page, /name="weekday" value="2" checked/, 'today is marked');
  assert.match(page, /name="time" value="10:30" checked/, 'and the next quarter hour');
  assert.match(page, /value="10:45"/, 'quarter hours, not halves');
});

test('the times say which clock they are on', async () => {
  // A time with no zone is a time somebody abroad reads as theirs and is
  // booked as ours. Norwegian by default; the page's script names another.
  const page = signupPage(script);
  assert.ok(page.includes(script.get('time.zone.home') ?? '\u0000'));
  assert.ok(page.includes(`data-other="${script.get('time.zone.other')}"`), 'the other-zone line is on the page for the script');

  const { reschedulePage } = await import('../src/link/page.ts');
  assert.ok(reschedulePage({ weekday: 2, minute: 480, timezone: 'Europe/Oslo' }, script).includes('Norwegian time'));
  assert.ok(reschedulePage({ weekday: 2, minute: 480, timezone: 'America/New_York' }, script).includes('New York time'));
});

test('an expired booking draft never claims its choices are still saved', () => {
  for (const reason of ['signup.code.expired', 'signup.code.toomany']) {
    const page = codePage('+4790000000', script, reason);
    assert.match(page, /Return to booking below/);
    assert.doesNotMatch(page, /choices are saved|action="\/start\/resend"/);
  }
});
