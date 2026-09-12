import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, parseScript } from '../src/script.ts';
import { composeRecap } from '../src/recap/compose.ts';

const script = loadScript();
const call = { at: new Date().toISOString(), durationMs: 12 * 60_000 };

test('the one thing leads, because that is why anyone opens this', () => {
  const r = composeRecap({ ...call, commitment: 'run three times', day: 'Wednesday' }, script, {
    nextSlot: 'Tuesday at nine',
  });
  assert.ok(r.body.startsWith('run three times, Wednesday.'), r.body);
  assert.ok(r.subject.includes('Wednesday'));
  assert.ok(r.body.includes('12 minutes'));
  assert.ok(r.body.includes('Tuesday at nine'));
  assert.ok(!r.body.includes('{{'), 'no slot may reach a reader');
});

test('a week with no commitment gets a different email, not an apology', () => {
  const r = composeRecap(call, script, { nextSlot: 'Tuesday at nine' });
  assert.ok(!r.body.includes("that's okay"), 'the call declined to forgive it and neither does this');
  assert.ok(!r.body.includes('undefined'));
  assert.ok(!r.body.includes('{{'));
  assert.equal(r.subject, "This week's call");
});

test('nothing in it congratulates anyone', () => {
  const r = composeRecap({ ...call, commitment: 'phone my brother', day: 'Friday' }, script, {});
  for (const banned of ['!', 'great', 'amazing', 'well done', 'proud']) {
    assert.ok(!r.body.toLowerCase().includes(banned), `"${banned}" must not appear: ${r.body}`);
    assert.ok(!r.subject.toLowerCase().includes(banned));
  }
});

test('a commitment with no day does not leave a dangling comma or dash', () => {
  const r = composeRecap({ ...call, commitment: 'start the thing' }, script, { nextSlot: 'next week' });
  assert.ok(!/,\s*\./.test(r.body), r.body);
  assert.ok(!/[—–-]\s*$/.test(r.subject), r.subject);
});

test('a broken SCRIPT.md shortens the email rather than breaking the send', () => {
  const partial = parseScript('`email.body.commitment`\n> "{{commitment}}, {{day}}."\n');
  const r = composeRecap({ ...call, commitment: 'run three times', day: 'Wednesday' }, partial, {});
  assert.equal(r.body, 'run three times, Wednesday.');
  assert.equal(r.subject, '');
});

test('a very short call still reads as a number of minutes', () => {
  const r = composeRecap({ ...call, durationMs: 20_000, commitment: 'x', day: 'Monday' }, script, {});
  assert.ok(r.body.includes('a minute.'), r.body);
  assert.ok(!r.body.includes('1 minutes'), 'the product does not say "1 minutes"');
});
