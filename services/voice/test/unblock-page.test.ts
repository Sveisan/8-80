import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unblockPage, aboutPage, scheduleInputs } from '../src/unblock/page.ts';
import { pageHeaders, csrfFor } from '../src/unblock/http.ts';
import { displayHash } from '../src/beliefs/display.ts';
import { normaliseSchedule } from '../src/unblock/forms.ts';
import { scheduleInput } from '../src/unblock/repository.ts';
import { applyCommand, emptyProgramme, finishCall, type Programme } from '../src/unblock/model.ts';
import { unblockCheckout } from '../src/unblock/payment.ts';
import { csrfFor as beliefsCsrf } from '../src/beliefs/http.ts';

let n = 0; const now = new Date('2026-11-10T10:00:00Z');
const run = (p: Programme, c: Parameters<typeof applyCommand>[1]): Programme => applyCommand(p, c, 'page-' + ++n, now);
function filled(): Programme {
  let p = run(emptyProgramme(), { type: 'wish', text: 'Learn to sail', why: 'The water feels like home' });
  p = run(p, { type: 'step', week: 1, text: 'Ask a neighbour' }); p = finishCall(p, 'opening', 0);
  p = run(p, { type: 'wish', text: 'Sail one weekend a month', why: '' });
  p = run(p, { type: 'block', text: 'I would be laughed at', kind: 'prediction', week: 1 });
  p = run(p, { type: 'step_outcome', week: 1, outcome: 'partly', outcomeText: 'Went to the harbour' });
  return run(p, { type: 'light', text: 'Light on the kitchen wall', occurredOn: '2026-11-09', source: 'light_call', week: 1 });
}

test('every caller word is escaped, in every private section', () => {
  const evil = '<script>alert(1)</script>'; let p = emptyProgramme();
  p = run(p, { type: 'wish', text: evil, why: evil }); p = run(p, { type: 'block', text: evil, kind: 'limit', week: 1 });
  p = run(p, { type: 'step', week: 1, text: evil }); p = run(p, { type: 'step_outcome', week: 1, outcome: 'done', outcomeText: evil });
  p = run(p, { type: 'light', text: evil, occurredOn: '2026-11-09', source: 'light_call', week: 1 }); p = run(p, { type: 'closing', text: evil, carryText: evil });
  const html = unblockPage('account', { programme: p, paid: true, preview: true });
  assert.ok(!html.includes(evil)); assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal((html.match(/<script>/g) ?? []).length, 1, 'only the hashed display script exists');
});

test('page headers keep the display script hashed, forbid framing and referrers, and cannot reuse another product CSRF', () => {
  assert.match(pageHeaders['content-security-policy'], new RegExp(`script-src 'sha256-${displayHash.replace(/[+/=]/g, c => '\\' + c)}'`));
  assert.match(pageHeaders['content-security-policy'], /frame-ancestors 'none'/); assert.equal(pageHeaders['referrer-policy'], 'no-referrer'); assert.equal(pageHeaders['cache-control'], 'no-store');
  assert.notEqual(csrfFor('same-token'), beliefsCsrf('same-token'));
});

test('copy: plain, no streaks, scores, counts or praise; no one-time, five-week or old last-call language', () => {
  const pages = [unblockPage('landing', { available: true, price: 'Synthetic price label' }), unblockPage('landing', { preview: true }), aboutPage({ support: 'mailto:x@example.com', supportHours: 'Synthetic hours' }),
    unblockPage('join'), unblockPage('verify'), unblockPage('schedule', {}), unblockPage('account', { programme: filled(), paid: true }), unblockPage('account', { programme: finishCall(filled(), 'weekly', 1), paid: true })];
  for (const html of pages) {
    const text = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<section data-seam="subscription"[\s\S]*?<\/section>/g, '');
    assert.doesNotMatch(text, /streak|\bscore|well done|great job|congratulat|proud of|you.ve completed|five weeks|one-time(?!-code)|last Unblock call|no subscription/i);
  }
  const landing = pages[0]!;
  assert.ok(landing.includes('See the light in your own life — and take the step that has been waiting.')); assert.ok(landing.includes('Each month is a chapter'));
  assert.ok(landing.includes('Calls are with an AI')); assert.ok(landing.includes('Synthetic price label')); assert.ok(!pages[1]!.includes('Synthetic price label'));
  assert.ok(landing.includes('three evenings a week'));
  assert.ok(!unblockPage('landing', { available: false }).includes('/unblock/join'), 'closed enrolment shows no join link');
});

test('Beliefs is mentioned once, quietly, in the account footer and nowhere else', () => {
  const mentions = (html: string): number => (html.match(/Beliefs/g) ?? []).length;
  for (const screen of ['landing', 'join', 'verify', 'schedule'] as const) assert.equal(mentions(unblockPage(screen, { siblingHref: '/beliefs' })), 0, screen);
  assert.equal(mentions(aboutPage({ siblingHref: '/beliefs' })), 0);
  const account = unblockPage('account', { programme: filled(), paid: true, siblingHref: '/beliefs', next: { at: now.toISOString(), text: 'Tuesday', label: 'Regular call', kind: 'call', moveable: true, weekly: true } });
  assert.equal(mentions(account), 1); assert.ok(/<footer[\s\S]*Beliefs[\s\S]*<\/footer>/.test(account));
  assert.equal(mentions(unblockPage('account', { programme: filled(), paid: true })), 0, 'omitted when the sibling programme is not offered');
});

test('account shows the wish with earlier versions, blocks, steps with outcomes and the ledger, without counts', () => {
  const html = unblockPage('account', { programme: filled(), paid: true });
  for (const text of ['Sail one weekend a month', 'Earlier versions', 'Learn to sail', 'I would be laughed at', 'A prediction', 'Ask a neighbour', 'Partly', 'Went to the harbour', 'Light on the kitchen wall', 'Monday 9 November'])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/g, ''), /\b\d+ (entries|moments|steps|days|calls)\b|\d+ of \d+/);
  const fresh = unblockPage('account', { programme: emptyProgramme(), paid: false, scheduled: true });
  assert.ok(fresh.includes('after your first conversation')); assert.ok(fresh.includes('Start Unblock'));
});

test('payment: no checkout link unless the subscription product is configured; a provider link carries the enrolment reference', () => {
  assert.equal(unblockCheckout('unblock:synthetic'), '', 'not configured');
  const html = unblockPage('account', { programme: emptyProgramme(), paid: false, scheduled: true });
  assert.ok(html.includes('Checkout is not available here yet')); assert.ok(!html.includes('data-seam="subscription"'), 'no subscription controls before there is a subscription');
  assert.ok(unblockPage('account', { programme: emptyProgramme(), scheduled: true, checkout: 'https://buy.stripe.com/synthetic' }).includes('href="https://buy.stripe.com/synthetic"'));
});

const sub = (over: Partial<NonNullable<Parameters<typeof unblockPage>[1]>['sub']> = {}) => ({ standing: 'active', cancelling: false, callsPerMonth: 4, pendingCalls: null, manageable: true, ...over });
const card = (html: string): string => html.match(/<section data-seam="subscription"[\s\S]*?<\/section>/)?.[0] ?? '';
test('subscription card: status line, calls per month with the next-chapter note, pause or resume, cancel and billing', () => {
  const programme = filled();
  const active = card(unblockPage('account', { programme, paid: true, sub: sub({ paidUntil: '2026-12-10T10:00:00Z' }), csrf: 'c' }));
  for (const text of ['Active. Renews around 10 December 2026', 'name="calls"', 'Save calls per month', 'Pause my calls', 'does not pause billing', 'Cancel at the end of this period', 'Manage billing', 'applies from your next chapter'])
    assert.ok(active.includes(text), text);
  assert.equal((active.match(/<option /g) ?? []).length, 8, 'one to eight');
  assert.ok(active.includes('<option value="4" selected>'));
  const pending = card(unblockPage('account', { programme, paid: true, sub: sub({ pendingCalls: 6 }), csrf: 'c' }));
  assert.ok(pending.includes('This chapter keeps 4. From your next chapter: 6.') && pending.includes('<option value="6" selected>'));
  const cancelling = card(unblockPage('account', { programme, paid: true, sub: sub({ cancelling: true, paidUntil: '2026-12-10T10:00:00Z' }), csrf: 'c' }));
  assert.ok(cancelling.includes('Cancelling on 10 December 2026. Your calls continue until then.')); assert.ok(!cancelling.includes('Cancel at the end of this period'));
  const paused = card(unblockPage('account', { programme: { ...programme, state: 'paused' }, paid: true, sub: sub(), csrf: 'c' }));
  assert.ok(paused.includes('Paused. No calls') && paused.includes('Resume my calls') && !paused.includes('Pause my calls'));
  const late = card(unblockPage('account', { programme, paid: true, sub: sub({ standing: 'past_due' }), csrf: 'c' }));
  assert.ok(late.includes('Payment problem') && late.includes('Manage billing'));
  const ended = card(unblockPage('account', { programme: { ...programme, state: 'completed' }, paid: false, sub: sub({ standing: 'ended', manageable: false }), csrf: 'c' }));
  assert.ok(ended.includes('Ended.') && !ended.includes('<form'));
  assert.doesNotMatch(active, /streak|\bscore|well done|great job/i);
});
test('the schedule step asks for calls per month, one to eight, default four', () => {
  const html = unblockPage('schedule', {});
  assert.ok(html.includes('Calls per month') && html.includes('<option value="4" selected>')); assert.equal((html.match(/<select id="[^"]*calls"[\s\S]*?<\/select>/)![0].match(/<option /g) ?? []).length, 8);
  assert.ok(unblockPage('schedule', { calls: 7 }).includes('<option value="7" selected>'));
  assert.equal(scheduleInput(normaliseSchedule(new URLSearchParams([['weekly', '17:00'], ['weekday', '0'], ['calls', '2']])), now).calls, 2);
  assert.equal(scheduleInput(normaliseSchedule(new URLSearchParams([['weekly', '17:00'], ['weekday', '0']])), now).calls, undefined);
  for (const bad of ['0', '9', 'x']) assert.throws(() => scheduleInput(normaliseSchedule(new URLSearchParams([['weekly', '17:00'], ['weekday', '0'], ['calls', bad]])), now), /calls_invalid/);
  // Five or more calls a month add a second day, three days later: a light call near it is refused.
  const base: [string, string][] = [['weekly', '17:00'], ['weekday', '0'], ['light_choice', 'evenings'], ['light_day', '3'], ['light', '17:20']];
  assert.doesNotThrow(() => scheduleInput(normaliseSchedule(new URLSearchParams([...base, ['calls', '4']])), now));
  assert.throws(() => scheduleInput(normaliseSchedule(new URLSearchParams([...base, ['calls', '5']])), now), /calls_too_close/);
});
test('schedule: inputs live in one component; default three evenings, explicit none, and a choice without evenings is refused', () => {
  const html = unblockPage('schedule', {});
  assert.ok(scheduleInputs({}).includes('Regular call · day') && html.includes('Regular call · day'));
  assert.ok(html.includes('value="evenings" checked')); assert.ok(html.includes('No light calls'));
  assert.equal((html.match(/name="light_day" value="[135]" checked/g) ?? []).length, 3);
  const none = unblockPage('schedule', { scheduled: true, lightDays: [] }); assert.ok(none.includes('value="none" checked'));
  const base = [['timezone', ''], ['weekly', '17:00'], ['weekday', '0']] as [string, string][];
  const defaults = scheduleInput(normaliseSchedule(new URLSearchParams(base)), now); assert.deepEqual(defaults.lightDays, [1, 3, 5]); assert.equal(defaults.timezone, 'Europe/Oslo');
  const picked = scheduleInput(normaliseSchedule(new URLSearchParams([...base, ['light_choice', 'evenings'], ['light_day', '2'], ['light_day', '4'], ['light', '20:00']])), now); assert.deepEqual(picked.lightDays, [2, 4]); assert.equal(picked.lightMinute, 1200);
  const declined = scheduleInput(normaliseSchedule(new URLSearchParams([...base, ['light_choice', 'none'], ['light_day', '2']])), now); assert.deepEqual(declined.lightDays, []); assert.equal(declined.lightMinute, null);
  assert.throws(() => normaliseSchedule(new URLSearchParams([...base, ['light_choice', 'evenings']])), /days_invalid/);
  assert.throws(() => scheduleInput(normaliseSchedule(new URLSearchParams([['timezone', 'Mars/Base'], ['weekly', '17:00'], ['weekday', '0']])), now), /timezone_invalid/);
  assert.throws(() => scheduleInput(normaliseSchedule(new URLSearchParams([...base.slice(0, 2), ['weekday', '2'], ['light_choice', 'evenings'], ['light_day', '2'], ['light', '17:20']])), now), /calls_too_close/);
});
