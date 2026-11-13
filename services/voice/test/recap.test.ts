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
  assert.doesNotMatch(r.body, /minutes|We spoke for/);
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
  assert.equal(r.subject, script.get('email.subject.none'), 'a call with no named day still has a usable email subject');
  assert.ok(!/,\s*\./.test(r.body), r.body);
  assert.ok(!/[—–-]\s*$/.test(r.subject), r.subject);
});

test('a broken SCRIPT.md shortens the email rather than breaking the send', () => {
  const partial = parseScript('`email.body.commitment`\n> "{{commitment}}, {{day}}."\n');
  const r = composeRecap({ ...call, commitment: 'run three times', day: 'Wednesday' }, partial, {});
  assert.equal(r.body, 'run three times, Wednesday.');
  assert.equal(r.subject, '');
});

test('short calls keep the appointment visible without a duration receipt', () => {
  const r = composeRecap({ ...call, durationMs: 20_000, commitment: 'x', day: 'Monday' }, script, { nextSlot: 'Friday at 08:30' });
  assert.match(r.body, /Next call, as booked when we spoke: Friday at 08:30\./);
  assert.doesNotMatch(r.body, /minute|We spoke for/);
});

test('a sentence whose slot has no value is dropped, not sent hollow', () => {
  // "We spoke for 10 minutes. I'll call you ." was going to anybody whose next
  // call could not be described. Half a sentence in the only email this
  // product sends reads as a broken system, because it is one.
  const r = composeRecap({ at: '', durationMs: 600_000, commitment: 'run three times', day: 'Wednesday' }, script);
  assert.ok(!r.body.includes(' .'), r.body);
  assert.ok(!r.body.includes("I'll call you"), 'no next call to promise, so it does not promise one');
  assert.doesNotMatch(r.body, /Next call|We spoke for/);
});

test('sentences with no slots at all survive', () => {
  // `every` on an empty list is true, which dropped every fixed sentence in
  // the email the first time this filter was written — the subject included.
  const r = composeRecap({ at: '', durationMs: 600_000, commitment: 'run three times', day: 'Wednesday' }, script);
  assert.match(r.body, /We'll pick it up next time we talk\./);
  assert.equal(composeRecap({ at: '', durationMs: 600_000 }, script).subject, "This week's call");
});

test('the email promises the next call, not the commitment day', () => {
  const r = composeRecap(
    { at: '', durationMs: 620_000, commitment: 'run three times', day: 'Wednesday' },
    script,
    { nextSlot: 'Friday at 08:30' },
  );
  assert.match(r.body, /Next call, as booked when we spoke: Friday at 08:30\./);
  assert.ok(!/I'll call you.*Wednesday/.test(r.body), 'the commitment lands on Wednesday; the call is on Friday');
});

test('the email is signed, so it reads as a letter and not as output', () => {
  // The first recap to arrive read as blank. It ended on "We spoke for eight
  // minutes." — nothing at the end of a note is what a machine sounds like.
  for (const outcome of [
    { at: '', durationMs: 600_000, commitment: 'run three times', day: 'Wednesday' },
    { at: '', durationMs: 600_000 },
  ]) {
    const r = composeRecap(outcome, script, { nextSlot: 'Friday at 08:30' });
    assert.ok(r.body.endsWith('— 8&80'), r.body);
  }
});

test('the sign-off survives the empty-slot rule', () => {
  // It has no slots, so the rule that drops hollow sentences must not take it.
  const r = composeRecap({ at: '', durationMs: 600_000 }, script);
  assert.ok(r.body.endsWith('— 8&80'));
});

test('recaps carry a durable controls destination in both plain text and HTML', async () => {
  const { letterHtml } = await import('../src/recap/letter.ts');
  const recap = composeRecap(call, script, { controlUrl: 'https://8and80.example/me' });
  assert.equal(recap.action?.url, 'https://8and80.example/me');
  assert.ok(recap.body.includes('Manage your calls: https://8and80.example/me'));
  assert.ok(letterHtml(recap).includes('href="https://8and80.example/me"'));
  assert.ok(!recap.body.includes('/r/'), 'email navigation does not carry a bearer credential');
});

test('the first recap carries an optional contact reminder in HTML and plain text, without changing the action', async () => {
  const { letterHtml } = await import('../src/recap/letter.ts');
  const contactUrl = 'https://8and80.example/contact.vcf';
  const recap = composeRecap({ ...call, commitment: 'phone the sailing school' }, script, { contactUrl, controlUrl: 'https://8and80.example/me' });
  assert.equal(recap.contact?.url, contactUrl);
  assert.ok(recap.body.includes(`Add 8&80 to contacts: ${contactUrl}`));
  assert.ok(recap.body.includes(script.get('email.contact.reminder')!));
  assert.equal(recap.said?.commitment, 'phone the sailing school');
  const html = letterHtml(recap);
  assert.ok(html.includes(`href="${contactUrl}"`));
  assert.ok(html.includes('Add 8&amp;80 to contacts'));
  assert.ok(html.includes('href="https://8and80.example/me"'));
  assert.doesNotMatch(html, /\{\{/);
  const weekly = composeRecap(call, script);
  assert.equal(weekly.contact, undefined);
  assert.ok(!weekly.body.includes('contact card'));
  assert.ok(!letterHtml(weekly).includes('contact.vcf'));
});

test('only a complete map confirmed in this call adds the longer view, separately from the action', async () => {
  const { letterHtml } = await import('../src/recap/letter.ts');
  const chosen={...call,commitment:'earn more money',eighty:'time with family & friends',onboardingComplete:true};
  const before=structuredClone(chosen),recap=composeRecap(chosen,script);
  assert.deepEqual(chosen,before,'composition cannot change memory or the chosen action');
  assert.equal(recap.said?.commitment,'earn more money');
  assert.equal(recap.said?.label,'This week');
  assert.ok(recap.body.startsWith('earn more money.'));
  assert.match(recap.body,/Your longer view: time with family & friends\./);
  assert.doesNotMatch(recap.body,/because|freedom|security|financial independence|We'll ask/);
  const html=letterHtml(recap);
  assert.match(html,/Your longer view: time with family &amp; friends\./);
  assert.ok(html.indexOf('earn more money')<html.indexOf('Your longer view'));
});

test('unconfirmed, missing, oversized or duplicate perspectives leave no invented or partial quotation', () => {
  for(const outcome of [
    {...call,commitment:'call the school',eighty:'unconfirmed family'},
    {...call,commitment:'call the school',onboardingComplete:true},
    {...call,commitment:'call the school',onboardingComplete:true,eighty:'(nothing recorded)'},
    {...call,commitment:'call the school',onboardingComplete:true,eighty:'x'.repeat(241)},
    {...call,commitment:'TIME with family.',onboardingComplete:true,eighty:'time with family'},
  ]){
    const recap=composeRecap(outcome,script);
    assert.doesNotMatch(recap.body,/Your longer view|unconfirmed|nothing recorded|x{20}|\{\{/);
  }
  const none=composeRecap({...call,noAction:true,onboardingComplete:true,eighty:'time with friends'},script);
  assert.equal(none.said,undefined);assert.match(none.body,/Your longer view: time with friends\./);
  assert.doesNotMatch(none.body,/forgive|failed|No action chosen|you chose|That's the one/);
});

test('perspective content is escaped in HTML and is optional for historical script versions', async () => {
  const { letterHtml } = await import('../src/recap/letter.ts');
  const outcome={...call,onboardingComplete:true,eighty:'<img src=x onerror=alert(1)>',commitment:'call the school'};
  const html=letterHtml(composeRecap(outcome,script));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  const old=new Map(script);old.delete('email.body.perspective');
  const recap=composeRecap(outcome,old);
  assert.equal(recap.said?.commitment,outcome.commitment);assert.doesNotMatch(recap.body,/<img|\{\{/);
});
