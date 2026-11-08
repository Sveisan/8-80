import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PracticeError } from '../src/beliefs/model.ts';
import { applyCommand, arc, callHeld, callWeek, callsOf, chapterComplete, currentWish, emptyProgramme, finishCall, firstWeekly, isCloseWeek, lightEnabled, monthOf, nextLight, parseCalls, parseDays, parseTime, rollChapter, selectLedgerReadback, slotKind, voiceProgramme, type Command, type LedgerEntry, type Programme } from '../src/unblock/model.ts';
import { capture, closedSnapshot, sessionToken, UNBLOCK_TOOL_PARAMS, unblockWebhookArguments, verifiedProgramme, verifySessionToken, heldCall, type Kind, type Snapshot } from '../src/unblock/protocol.ts';
import { scheduleInput } from '../src/unblock/repository.ts';
import { unblockReadiness } from '../src/unblock/readiness.ts';

type Ctx = { is_close: boolean; sign_off: { mode: string; next_chapter_title?: string; next_call_local?: string; next_call_weekday?: string }; ledger_readback: { text: string }[]; month_words?: { steps: { text: string }[]; moments: { text: string }[] }; chapter_theme: string };
const now = new Date('2026-11-10T18:00:00Z');
let event = 0;
const run = (p: Programme, c: Command) => applyCommand(p, c, 'event-' + (++event), now);
const fresh = (p = emptyProgramme()): Snapshot => ({ revision: p.revision, initial: p, programme: p, receipts: [], coverage: {} });
let n = 0;
const send = (s: Snapshot, kind: Kind, week: number, said: string, fields: Record<string, unknown>) =>
  capture(s, kind, week, 'Europe/Oslo', { event_id: 'e' + (++n), caller_text: said, confirmed: true, ...fields }, now);
const entry = (week: number, at: string, text = 'moment ' + at): LedgerEntry => ({ id: at, week, occurredOn: at.slice(0, 10), text, source: 'light_call', at });

test('arc derives only from verified calls: opening, the calls of a month, then the chapter is complete until the next month; completion only when the subscription ends', () => {
  let p = emptyProgramme();
  assert.deepEqual(arc(p), { stage: 'opening' }); assert.equal(slotKind(p), 'opening'); assert.equal(callWeek(p, 'opening'), 0);
  p = finishCall(p, 'opening', 0); assert.deepEqual(arc(p), { stage: 'week', week: 1 }); assert.equal(slotKind(p), 'weekly');
  p = finishCall(p, 'weekly', 2); assert.equal(p.weeksHeld, 0, 'a call for a different week never skips ahead');
  for (let w = 1; w <= 3; w++) { p = finishCall(p, 'weekly', w); assert.deepEqual(arc(p), { stage: 'week', week: w + 1 }); }
  assert.equal(callWeek(p, 'light'), 4); assert.equal(chapterComplete(p), false);
  p = finishCall(p, 'weekly', 4);
  assert.equal(p.state, 'active', 'finishing the close does not end the programme'); assert.equal(chapterComplete(p), true);
  assert.equal(callWeek(p, 'light'), 4, 'a light call after the close stays in the finished chapter');
  assert.equal(lightEnabled(p, { lightWeekdays: [1], lightMinute: 600 }), true, 'light calls continue while the subscription does');
  assert.deepEqual(finishCall(p, 'weekly', 4), p, 'a close is never held twice');
  // The next billing month: a new chapter with its own number of calls, the old closing archived.
  const closed = run(p, { type: 'closing', text: 'Home', carryText: 'Keep going' });
  const next = rollChapter(closed, 2, new Date('2026-12-10T10:00:00Z'));
  assert.equal(monthOf(next), 2); assert.equal(next.weeksHeld, 0); assert.equal(callsOf(next), 2); assert.equal(next.closing, null);
  assert.deepEqual(next.closings!.map(c => [c.text, c.month]), [['Home', 1]]);
  assert.deepEqual(arc(next), { stage: 'week', week: 1 });
  const ended = { ...next, state: 'completed' as const };
  assert.deepEqual(arc(ended), { stage: 'complete' }); assert.equal(slotKind(ended), undefined); assert.equal(lightEnabled(ended, { lightWeekdays: [1], lightMinute: 600 }), false);
});
test('calls per month: 1 to 8, and call n is the close wherever n falls', () => {
  assert.equal(parseCalls('1'), 1); assert.equal(parseCalls(8), 8);
  for (const bad of ['0', '9', '', 'x', '2.5', null, undefined]) assert.throws(() => parseCalls(bad), /calls_invalid/);
  for (const n of [1, 2, 6, 8]) {
    let p = finishCall(emptyProgramme(), 'opening', 0); p = { ...p, chapterCalls: n };
    for (let w = 1; w <= n; w++) {
      assert.equal(isCloseWeek(p, w), w === n); assert.deepEqual(arc(p), { stage: 'week', week: w });
      assert.equal(callHeld('weekly', w, w === n ? ['closing'] : ['step'], n), true);
      assert.equal(callHeld('weekly', n, ['step'], n), false, 'the close needs the verified closing');
      p = finishCall(p, 'weekly', w);
    }
    assert.equal(chapterComplete(p), true);
  }
});
test('chapter scoping: steps, blocks, moments and closings belong to their month, and the same call number repeats in the next month', () => {
  let p = finishCall(emptyProgramme(), 'opening', 0); p = run(p, { type: 'wish', text: 'Learn to sail', why: '' });
  p = run(p, { type: 'step', week: 1, text: 'First month step' }); p = run(p, { type: 'light', text: 'A first month moment', occurredOn: '2026-11-09', source: 'light_call', week: 1 });
  p = rollChapter({ ...p, weeksHeld: 4 }, 3, now);
  p = run(p, { type: 'step', week: 1, text: 'Second month step' }); p = run(p, { type: 'step_outcome', week: 1, outcome: 'done', outcomeText: '' });
  assert.deepEqual(p.steps.map(s => [s.month, s.week, s.outcome]), [[1, 1, null], [2, 1, 'done']]);
  const context = voiceProgramme(p, { kind: 'weekly', week: 1, preferredName: 'A' }) as { steps: { text: string }[]; chapter: { number: number; calls_this_month: number } };
  assert.deepEqual(context.steps.map(s => s.text), ['Second month step']); assert.deepEqual([context.chapter.number, context.chapter.calls_this_month], [2, 3]);
  assert.throws(() => run(p, { type: 'step', week: 4, text: 'Beyond the month' }), /week_invalid/);
});
test('the close context: read-back, the month in the caller\'s words and a personal sign-off; other calls carry only the next call', () => {
  let p = finishCall(emptyProgramme(), 'opening', 0); p = { ...p, chapterCalls: 2 };
  p = run(p, { type: 'step', week: 1, text: 'Phone the club' }); p = run(p, { type: 'light', text: 'Rain on stone', occurredOn: '2026-11-09', source: 'light_call', week: 1 });
  const at = new Date('2026-11-12T17:00:00Z');
  const first = voiceProgramme(p, { kind: 'weekly', week: 1, preferredName: 'Mari', nextCallAt: at, schedule: { timezone: 'Europe/Oslo', weeklyWeekday: 4, weeklyMinute: 1080, lightWeekdays: [], lightMinute: null } }) as Ctx;
  assert.equal(first.is_close, false); assert.equal(first.sign_off.mode, 'continue'); assert.equal(first.sign_off.next_call_weekday, 'Thursday'); assert.equal(first.sign_off.next_chapter_title, undefined);
  assert.deepEqual(first.ledger_readback, []); assert.equal(first.month_words, undefined); assert.ok(first.chapter_theme.includes('CALL 1 OF 2'));
  p = finishCall(p, 'weekly', 1);
  const close = voiceProgramme(p, { kind: 'weekly', week: 2, preferredName: 'Mari', nextCallAt: at }) as Ctx;
  assert.equal(close.is_close, true); assert.equal(close.sign_off.mode, 'continue'); assert.equal(close.sign_off.next_chapter_title, 'The First Mile'); assert.ok(close.sign_off.next_call_local!.includes('Thursday'));
  assert.deepEqual(close.ledger_readback.map((e: { text: string }) => e.text), ['Rain on stone']);
  assert.deepEqual(close.month_words!.steps.map((e: { text: string }) => e.text), ['Phone the club']); assert.deepEqual(close.month_words!.moments.map((e: { text: string }) => e.text), ['Rain on stone']);
  assert.ok(close.chapter_theme.includes('Never add facts') && close.chapter_theme.includes('map'), 'the picture is used as a summary of the caller\'s own words');
  assert.equal((voiceProgramme(p, { kind: 'weekly', week: 2, preferredName: 'Mari', cancelling: true }) as Ctx).sign_off.mode, 'ending');
  assert.equal((voiceProgramme(p, { kind: 'weekly', week: 2, preferredName: 'Mari', ended: true }) as Ctx).sign_off.mode, 'ending');
  assert.deepEqual((voiceProgramme(run(p, { type: 'pause' }), { kind: 'weekly', week: 2, preferredName: 'Mari', nextCallAt: at }) as Ctx).sign_off, { mode: 'paused' });
  const text = JSON.stringify(close.sign_off); assert.doesNotMatch(text, /price|offer|buy|subscri|renew/i);
});
test('light calls need an opened, active, unfinished programme and a chosen schedule', () => {
  const s = { lightWeekdays: [1, 3, 5], lightMinute: 1140 };
  assert.equal(lightEnabled(emptyProgramme(), s), false);
  const opened = finishCall(emptyProgramme(), 'opening', 0);
  assert.equal(lightEnabled(opened, s), true); assert.equal(lightEnabled(opened, { lightWeekdays: [], lightMinute: null }), false);
  assert.equal(lightEnabled(run(opened, { type: 'pause' }), s), false);
});
test('the first weekly call is at least five days after the opening, then the usual slot', () => {
  const slot = { timezone: 'Europe/Oslo', weeklyWeekday: 2, weeklyMinute: 18 * 60 };
  const at = firstWeekly(now, slot)!; assert.ok(+at - +now >= 5 * 86400_000); assert.ok(+at - +now < 12 * 86400_000);
  assert.equal(firstWeekly(now, { ...slot, weeklyWeekday: null }), null);
  const light = nextLight(now, [1, 3, 5], 19 * 60, 'Europe/Oslo')!; assert.ok(light > now); assert.equal(nextLight(now, [], 600, 'Europe/Oslo'), null);
});
test('wishes are versioned; blocks need a wish, validate kind and stay linked to the version they were named under', () => {
  assert.throws(() => run(emptyProgramme(), { type: 'block', text: 'x', kind: 'unsure', week: 1 }), PracticeError);
  let p = run(emptyProgramme(), { type: 'wish', text: 'Learn to sail', why: 'I loved boats at eight' });
  p = run(p, { type: 'block', text: 'I have no time', kind: 'limit', week: 1 });
  const same = run(p, { type: 'wish', text: 'Learn to sail', why: '' }); assert.equal(same.wishes.length, 1);
  p = run(p, { type: 'wish', text: 'Write a book', why: 'It is mine' });
  assert.deepEqual(p.wishes.map(w => [w.version, w.text]), [[1, 'Learn to sail'], [2, 'Write a book']]);
  assert.equal(currentWish(p)!.version, 2); assert.equal(p.blocks[0]!.wishVersion, 1);
  assert.deepEqual(voiceProgramme(p, { kind: 'weekly', week: 3, preferredName: '' })['blocks'], [], 'blocks of an earlier wish are not presented as current');
  assert.throws(() => run(p, { type: 'block', text: 'x', kind: 'weird' as never, week: 1 }), PracticeError);
  assert.throws(() => run(p, { type: 'wish', text: '  ', why: '' }), PracticeError);
});
test('steps, outcomes, ledger and closing keep their invariants', () => {
  let p = run(finishCall(emptyProgramme(), 'opening', 0), { type: 'step', week: 1, text: 'Call the club' });
  p = run(p, { type: 'step', week: 1, text: 'Email the club' }); assert.equal(p.steps.length, 1); assert.equal(p.steps[0]!.text, 'Email the club');
  assert.throws(() => run(p, { type: 'step_outcome', week: 2, outcome: 'done', outcomeText: '' }), PracticeError);
  assert.throws(() => run(p, { type: 'step_outcome', week: 1, outcome: 'great' as never, outcomeText: '' }), PracticeError);
  p = run(p, { type: 'step_outcome', week: 1, outcome: 'not', outcomeText: 'I ran out of evening' });
  assert.equal(p.steps[0]!.outcome, 'not');
  assert.throws(() => run(p, { type: 'step_outcome', week: 1, outcome: 'done', outcomeText: '' }), PracticeError);
  assert.throws(() => run(p, { type: 'step', week: 1, text: 'Changed after the fact' }), PracticeError);
  assert.throws(() => run(p, { type: 'step', week: 5, text: 'x' }), PracticeError);
  assert.throws(() => run(p, { type: 'light', text: 'x', occurredOn: 'yesterday', source: 'light_call', week: 1 }), PracticeError);
  p = run(p, { type: 'closing', text: 'Mine to keep', carryText: '' }); assert.throws(() => run(p, { type: 'closing', text: 'Again', carryText: '' }), PracticeError);
});
test('pause blocks every voice change; a completed programme accepts none', () => {
  const p = run(emptyProgramme(), { type: 'pause' });
  assert.throws(() => run(p, { type: 'wish', text: 'x', why: '' }), PracticeError);
  assert.equal(run(p, { type: 'resume' }).state, 'active');
  const done = finishCall(finishCall(emptyProgramme(), 'opening', 0), 'weekly', 1);
  const closed = { ...done, state: 'completed' as const };
  assert.throws(() => run(closed, { type: 'resume' }), PracticeError);
});
test('event retries are idempotent and altered retries conflict', () => {
  const c: Command = { type: 'wish', text: 'Sail', why: '' };
  const first = applyCommand(emptyProgramme(), c, 'same', now);
  assert.strictEqual(applyCommand(first, c, 'same', now), first);
  assert.throws(() => applyCommand(first, { type: 'wish', text: 'Other', why: '' }, 'same', now), /event_conflict/);
  assert.throws(() => applyCommand(emptyProgramme(), c, '', now), PracticeError);
});
test('ledger read-back: up to five verbatim entries, newest of each week in turn, chronological, content-blind', () => {
  assert.deepEqual(selectLedgerReadback([]), []);
  const few = [entry(1, '2026-11-01T18:00:00Z'), entry(2, '2026-11-08T18:00:00Z')]; assert.equal(selectLedgerReadback(few).length, 2);
  const many = [
    entry(1, '2026-11-01T18:00:00Z'), entry(1, '2026-11-02T18:00:00Z'), entry(1, '2026-11-03T18:00:00Z'),
    entry(2, '2026-11-08T18:00:00Z'), entry(2, '2026-11-09T18:00:00Z'),
    entry(3, '2026-11-15T18:00:00Z'), entry(4, '2026-11-22T18:00:00Z'), entry(4, '2026-11-23T18:00:00Z'), entry(4, '2026-11-24T18:00:00Z'),
  ];
  const picked = selectLedgerReadback(many);
  assert.equal(picked.length, 5);
  assert.deepEqual(new Set(picked.map(e => e.week)), new Set([1, 2, 3, 4]), 'spread across the weeks');
  assert.ok(picked.some(e => e.at === '2026-11-24T18:00:00Z'), 'most recent is always included');
  assert.deepEqual(picked.map(e => e.at), [...picked.map(e => e.at)].sort());
  // Content never influences selection: swapping texts leaves the chosen slots identical.
  const swapped = many.map((e, i) => ({ ...e, text: i % 2 ? 'wonderful, joyful, grateful' : 'a dull afternoon' }));
  assert.deepEqual(selectLedgerReadback(swapped).map(e => e.at), picked.map(e => e.at));
  assert.deepEqual(selectLedgerReadback(many.slice().reverse()).map(e => e.at), picked.map(e => e.at));
  assert.deepEqual(selectLedgerReadback(many).map(e => e.text), picked.map(e => e.text));
});
test('voice context carries ledger_readback only for the week-4 call and never the support contact', () => {
  let p = emptyProgramme(); p.contact = { name: 'Syn', email: 'support-only@example.com' };
  for (let i = 0; i < 7; i++) p = run(p, { type: 'light', text: 'moment ' + i, occurredOn: '2026-11-0' + (i + 1), source: 'light_call', week: 1 + (i % 4) });
  const week4 = voiceProgramme(p, { kind: 'weekly', week: 4, preferredName: 'Syn' });
  assert.equal((week4['ledger_readback'] as unknown[]).length, 5); assert.equal(week4['ledger_count'], 7);
  assert.deepEqual(voiceProgramme(p, { kind: 'weekly', week: 2, preferredName: 'Syn' })['ledger_readback'], []);
  assert.deepEqual(voiceProgramme(p, { kind: 'light', week: 2, preferredName: 'Syn' })['ledger_readback'], []);
  assert.ok(!JSON.stringify(week4).includes('support-only@example.com'));
  assert.equal((week4['call_context'] as Record<string, unknown>)['preferred_name'], 'Syn');
});
test('held-call rules: closing is required to finish the programme; light calls need no saves', () => {
  assert.equal(callHeld('opening', 0, []), false); assert.equal(callHeld('opening', 0, ['wish']), true);
  assert.equal(callHeld('weekly', 2, ['pause']), false); assert.equal(callHeld('weekly', 2, ['step_outcome']), true);
  assert.equal(callHeld('weekly', 4, ['step_outcome']), false); assert.equal(callHeld('weekly', 4, ['closing']), true);
  assert.equal(callHeld('light', 2, []), true);
});
test('day and time parsing is strict', () => {
  assert.deepEqual(parseDays('Mon, wednesday and fri'), [1, 3, 5]); assert.deepEqual(parseDays('mandag og onsdag'), [1, 3]);
  assert.deepEqual(parseDays(''), []); assert.deepEqual(parseDays(undefined), []);
  assert.throws(() => parseDays('someday'), PracticeError); assert.equal(parseTime('19:30'), 1170); assert.throws(() => parseTime('half seven'), PracticeError);
});

// ── protocol ──────────────────────────────────────────────────────────────
test('tool credentials are scoped to Unblock and per call', () => {
  const secret = 's'.repeat(40); const token = sessionToken('a', secret);
  assert.equal(verifySessionToken('a', token, secret), true); assert.equal(verifySessionToken('b', token, secret), false);
  assert.equal(verifySessionToken('a', 'x', secret), false); assert.equal(verifySessionToken('a', token, 'short'), false);
  assert.throws(() => sessionToken('a', 'short'), PracticeError);
});
test('the pinned tool parameters are exported and the webhook envelope is only unwrapped for capture_unblock', () => {
  assert.deepEqual(UNBLOCK_TOOL_PARAMS.filter(p => p.required).map(p => p.name), ['session_id', 'session_token', 'event_id', 'caller_text']);
  assert.deepEqual(UNBLOCK_TOOL_PARAMS.map(p => p.name), ['session_id', 'session_token', 'event_id', 'caller_text', 'command', 'confirmed', 'text', 'why_text', 'kind', 'week', 'outcome', 'outcome_text', 'carry_text', 'days', 'time']);
  const args = { session_id: 'x' };
  assert.equal(unblockWebhookArguments({ tool_name: 'capture_unblock', tool_call_id: 't', arguments: args }), args);
  assert.deepEqual(unblockWebhookArguments(args), args);
  assert.throws(() => unblockWebhookArguments({ tool_name: 'other', arguments: args }), /unauthorized/);
  assert.throws(() => unblockWebhookArguments({ tool_name: 'capture_unblock', arguments: args, session_token: 'x' }), /unauthorized/);
});
test('opening call: wish, first step and light choice are staged only with caller words and explicit agreement', () => {
  let s = fresh();
  const said = 'I want to learn to sail because I loved boats at eight. Yes, that is right.';
  assert.throws(() => send(s, 'opening', 0, said, { command: 'wish', text: 'I want to write a novel' }), /caller_words_required/);
  assert.throws(() => capture(s, 'opening', 0, 'Europe/Oslo', { event_id: 'u', caller_text: said, command: 'wish', text: 'learn to sail' }, now), /caller_confirmation_required/);
  assert.throws(() => send(s, 'opening', 0, 'learn to sail', { command: 'wish', text: 'learn to sail' }), /caller_confirmation_required/);
  s = send(s, 'opening', 0, said, { command: 'wish', text: 'learn to sail', why_text: 'I loved boats at eight' });
  assert.equal(currentWish(s.programme)!.why, 'I loved boats at eight'); assert.equal(currentWish(s.initial), undefined);
  s = send(s, 'opening', 0, 'I will phone the sailing club on Thursday. Yes.', { command: 'step', text: 'phone the sailing club on Thursday', week: 1 });
  assert.equal(s.programme.steps[0]!.week, 1);
  assert.throws(() => send(s, 'opening', 0, 'I will phone the sailing club. Yes.', { command: 'step', text: 'phone the sailing club', week: 2 }), /week_mismatch/);
  s = send(s, 'opening', 0, 'Monday, Wednesday and Friday at seven in the evening. Yes, that is right.', { command: 'light_schedule', days: 'mon,wed,fri', time: '19:00' });
  assert.deepEqual(s.programme.light, { days: [1, 3, 5], minute: 1140, seq: 1 });
  assert.throws(() => send(s, 'opening', 0, 'Tuesday please. Yes.', { command: 'light_schedule', days: 'tue,thu', time: '19:00' }), /caller_words_required/);
  assert.throws(() => send(s, 'opening', 0, 'Yes, that is right.', { command: 'closing', text: 'x' }), /command_not_allowed/);
  assert.throws(() => send(s, 'opening', 0, 'Monday at seven. Yes.', { command: 'light_schedule', days: 'monday', time: '7pm' }), /time_invalid/);
});
test('declining light calls needs the caller to say so; stopping works in a light call', () => {
  const s = fresh(finishCall(emptyProgramme(), 'opening', 0));
  assert.throws(() => send(s, 'opening', 0, 'Sounds great. Yes.', { command: 'light_schedule', days: '' }), /caller_confirmation_required/);
  const declined = send(s, 'opening', 0, 'No thanks, no evening calls. Yes.', { command: 'light_schedule' });
  assert.deepEqual(declined.programme.light, { days: [], minute: null, seq: 1 });
  const stop = send(s, 'light', 2, 'Please stop the evening calls. Yes.', { command: 'light_schedule', days: '' });
  assert.deepEqual(stop.programme.light!.days, []);
  assert.throws(() => send(s, 'light', 2, 'Tuesday evenings. Yes.', { command: 'light_schedule', days: 'tue', time: '19:00' }), /command_not_allowed/);
});
test('weekly command whitelist follows the arc week', () => {
  const base = (w: number) => { let p = finishCall(emptyProgramme(), 'opening', 0); p = run(p, { type: 'wish', text: 'sail', why: '' }); p = run(p, { type: 'step', week: 1, text: 'phone the club' }); for (let i = 1; i < w; i++) p = finishCall(p, 'weekly', i); return fresh(p); };
  const out = send(base(1), 'weekly', 1, 'I did phone the club. Yes.', { command: 'step_outcome', outcome: 'done', outcome_text: 'I did phone the club' });
  assert.equal(out.programme.steps[0]!.outcome, 'done');
  assert.throws(() => send(base(1), 'weekly', 1, 'I did phone the club. Yes.', { command: 'step_outcome', outcome: 'done', week: 3 }), /week_mismatch/);
  const next = send(out, 'weekly', 1, 'I will visit the club on Saturday. Yes.', { command: 'step', text: 'visit the club on Saturday' });
  assert.equal(next.programme.steps.at(-1)!.week, 2);
  const block = send(base(1), 'weekly', 1, 'I am afraid I would look foolish. Yes.', { command: 'block', text: 'afraid I would look foolish', kind: 'prediction' });
  assert.equal(block.programme.blocks[0]!.kind, 'prediction');
  assert.equal(send(base(1), 'weekly', 1, 'I am afraid I would look foolish. Yes.', { command: 'block', text: 'afraid I would look foolish' }).programme.blocks[0]!.kind, 'unsure');
  assert.throws(() => send(base(1), 'weekly', 1, 'A thing. Yes.', { command: 'wish', text: 'A thing' }), /command_not_allowed/, 'wish is revised in week 3 only');
  assert.equal(currentWish(send(base(3), 'weekly', 3, 'I want to write instead. Yes.', { command: 'wish', text: 'write instead' }).programme)!.version, 2);
  assert.throws(() => send(base(4), 'weekly', 4, 'I want to write instead. Yes.', { command: 'wish', text: 'write instead' }), /command_not_allowed/);
  assert.throws(() => send(base(4), 'weekly', 4, 'I will do a thing. Yes.', { command: 'step', text: 'do a thing' }), /command_not_allowed/);
  assert.throws(() => send(base(3), 'weekly', 3, 'It was fine. Yes.', { command: 'closing', text: 'It was fine' }), /command_not_allowed/);
  const closing = send(base(4), 'weekly', 4, 'The wish and what is here are both mine. Keep the evenings. Yes.', { command: 'closing', text: 'The wish and what is here are both mine', carry_text: 'Keep the evenings' });
  assert.equal(closing.programme.closing!.carryText, 'Keep the evenings');
  assert.equal(heldCall(closing, 'weekly', 4), true); assert.equal(heldCall(base(4), 'weekly', 4), false);
});
test('a retry of an accepted first wish is idempotent even though a wish now exists; a different retry still conflicts', () => {
  const p0 = finishCall(emptyProgramme(), 'opening', 0);
  const call = { event_id: 'first-wish', caller_text: 'I want to learn to sail. Yes.', confirmed: true, command: 'wish', text: 'learn to sail' };
  const once = capture(fresh(p0), 'weekly', 2, 'Europe/Oslo', call, now);
  assert.equal(currentWish(once.programme)!.text, 'learn to sail');
  const again = capture(once, 'weekly', 2, 'Europe/Oslo', call, now);
  assert.equal(again, once, 'the stored receipt answers the retry');
  assert.throws(() => capture(once, 'weekly', 2, 'Europe/Oslo', { ...call, text: 'learn to sail', why_text: 'sail' }, now), /event_conflict/);
  assert.throws(() => capture(once, 'weekly', 2, 'Europe/Oslo', { ...call, event_id: 'second-wish', caller_text: 'I want to write instead. Yes.', text: 'write instead' }, now), /command_not_allowed/, 'a new wish in an ordinary theme is still refused');
});
test('wish changes follow the chapter theme of the call, not week 3', () => {
  const inChapter = (month: number, calls: number, held: number): Snapshot => {
    let p = finishCall(emptyProgramme(), 'opening', 0); p = run(p, { type: 'wish', text: 'sail', why: '' });
    return fresh({ ...p, month, chapterCalls: calls, weeksHeld: held });
  };
  const change = (snap: Snapshot, week: number) => send(snap, 'weekly', week, 'I want to write instead. Yes.', { command: 'wish', text: 'write instead' });
  // Chapter 6, four calls: its third theme ("Does it still fit") saves the wish.
  assert.equal(currentWish(change(inChapter(6, 4, 2), 3).programme)!.version, 2);
  assert.throws(() => change(inChapter(6, 4, 0), 1), /command_not_allowed/);
  // Chapter 6 with three calls: the themes are spread (1 and 3), so call 2 is the third theme.
  assert.equal(currentWish(change(inChapter(6, 3, 1), 2).programme)!.version, 2);
  // Chapter 12 and an open call (six calls): the caller leads.
  assert.equal(currentWish(change(inChapter(12, 6, 3), 4).programme)!.version, 2);
  // Chapter 2 never revises the wish in its themes, and the close never does.
  assert.throws(() => change(inChapter(2, 4, 2), 3), /command_not_allowed/);
  assert.throws(() => change(inChapter(6, 4, 3), 4), /command_not_allowed/);
});
test('spoken light times obey the same scheduling rules as the account', () => {
  const guard = (days: readonly number[], minute: number) => (days.includes(2) && Math.abs(minute - 1080) < 45 ? 'calls_too_close' : minute > 1200 ? 'outside_coverage' : undefined);
  const call = (fields: Record<string, unknown>, said = 'Tuesday at six in the evening. Yes.') => capture(fresh(), 'opening', 0, 'Europe/Oslo', { event_id: 'ls-' + (++n), caller_text: said, confirmed: true, command: 'light_schedule', ...fields }, now, guard);
  assert.throws(() => call({ days: 'tue', time: '18:10' }), /calls_too_close/);
  assert.throws(() => call({ days: 'tue', time: '22:00' }, 'Tuesday at ten at night. Yes.'), /outside_coverage/);
  assert.deepEqual(call({ days: 'tue', time: '20:00' }, 'Tuesday at eight. Yes.').programme.light!.days, [2]);
  assert.deepEqual(call({ days: '' }, 'No more evening calls please. Yes.').programme.light!.days, [], 'stopping light calls is never blocked');
});
test('light moments take server date and source, at most five per session, and may come from a weekly call', () => {
  let s = fresh(finishCall(emptyProgramme(), 'opening', 0));
  s = send(s, 'light', 2, 'The smell of rain on the pavement. Yes.', { command: 'light', text: 'The smell of rain on the pavement' });
  assert.deepEqual([s.programme.ledger[0]!.source, s.programme.ledger[0]!.occurredOn, s.programme.ledger[0]!.week], ['light_call', '2026-11-10', 2]);
  const weekly = send(fresh(finishCall(emptyProgramme(), 'opening', 0)), 'weekly', 1, 'A quiet minute with my daughter. Yes.', { command: 'light', text: 'A quiet minute with my daughter' });
  assert.equal(weekly.programme.ledger[0]!.source, 'weekly_call');
  assert.throws(() => send(fresh(), 'opening', 0, 'A moment. Yes.', { command: 'light', text: 'A moment' }), /command_not_allowed/);
  for (let i = 0; i < 4; i++) s = send(s, 'light', 2, `Moment ${i} here. Yes.`, { command: 'light', text: `Moment ${i} here` });
  assert.throws(() => send(s, 'light', 2, 'Moment six here. Yes.', { command: 'light', text: 'Moment six here' }), /session_full/);
});
test('retries with the same event are idempotent, altered retries conflict, even across midnight', () => {
  const s = fresh();
  const first = capture(s, 'opening', 0, 'Europe/Oslo', { event_id: 'dup', caller_text: 'learn to sail. Yes.', confirmed: true, command: 'wish', text: 'learn to sail' }, now);
  const again = capture(first, 'opening', 0, 'Europe/Oslo', { event_id: 'dup', caller_text: 'Learn to sail. Yes', confirmed: true, command: 'wish', text: 'learn to sail' }, now);
  assert.strictEqual(again, first);
  assert.throws(() => capture(first, 'opening', 0, 'Europe/Oslo', { event_id: 'dup', caller_text: 'learn to sail. Yes.', confirmed: true, command: 'wish', text: 'learn to sail', why_text: 'learn' }, now), /event_conflict/);
  const lit = fresh(finishCall(emptyProgramme(), 'opening', 0)); const input = { event_id: 'lit', caller_text: 'Warm tea. Yes.', confirmed: true, command: 'light', text: 'Warm tea' };
  const a = capture(lit, 'light', 1, 'Europe/Oslo', input, now);
  assert.strictEqual(capture(a, 'light', 1, 'Europe/Oslo', input, new Date(+now + 6 * 3600_000)), a);
});
test('signed transcript reconciliation requires the whole span, ending in explicit agreement', () => {
  let s = fresh();
  s = send(s, 'opening', 0, 'I want to learn to sail. Yes, that is right.', { command: 'wish', text: 'learn to sail' });
  assert.equal(currentWish(verifiedProgramme(s, ['I want to learn to sail.', 'Yes, that is right.']))!.text, 'learn to sail');
  assert.equal(currentWish(verifiedProgramme(s, ['Something else', 'I want to learn to sail. Yes, that is right.']))!.text, 'learn to sail');
  assert.throws(() => verifiedProgramme(s, ['I want to learn to sail.', 'No, that is wrong. Yes, that is right.']), /transcript_unconfirmed/);
  assert.throws(() => verifiedProgramme(s, ['I want to learn to sail.']), /transcript_unconfirmed/);
  assert.throws(() => verifiedProgramme(s, ['Different words entirely']), /transcript_unconfirmed/);
  const hedged = send(fresh(), 'opening', 0, 'I want to learn to sail. Yes, but that is not quite right.', { command: 'wish', text: 'learn to sail' });
  assert.throws(() => verifiedProgramme(hedged, ['I want to learn to sail. Yes, but that is not quite right.']), /caller_confirmation_required/);
});
test('closed snapshots keep identifiers and capture kinds, not private wording', () => {
  const s = send(fresh(), 'opening', 0, 'I want to learn to sail. Yes.', { command: 'wish', text: 'learn to sail' });
  const closed = closedSnapshot(s, 'opening', 0, true);
  assert.ok(!closed.includes('sail')); assert.deepEqual(JSON.parse(closed).captureKinds, ['wish']); assert.equal(JSON.parse(closed).canonicalVerified, true);
});
test('schedule input: Oslo fallback, three default evenings, explicit none, collisions and zones', () => {
  const form = (o: Record<string, string>) => new URLSearchParams(o);
  const d = scheduleInput(form({ weekday: 'tue', weekly: '18:00' }), now);
  assert.deepEqual([d.timezone, d.lightDays, d.lightMinute], ['Europe/Oslo', [1, 3, 5], 1140]);
  assert.deepEqual(scheduleInput(form({ weekday: '2', weekly: '18:00', light_days: 'none' }), now).lightDays, []);
  assert.equal(scheduleInput(form({ weekday: '2', weekly: '18:00', light_days: 'sat,sun', light: '20:30', timezone: 'Europe/London' }), now).lightMinute, 1230);
  assert.throws(() => scheduleInput(form({ weekday: '2', weekly: '18:00', timezone: 'Mars/Base' }), now), /timezone_invalid/);
  assert.throws(() => scheduleInput(form({ weekday: '1', weekly: '19:20' }), now), /calls_too_close/);
  assert.throws(() => scheduleInput(form({ weekday: 'xx', weekly: '18:00' }), now), /schedule_invalid/);
});
test('readiness lists every gate and all launch flags default to off', () => {
  const keys = Object.keys(process.env).filter(k => k.startsWith('UNBLOCK_')); const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    const missing = unblockReadiness();
    for (const name of ['UNBLOCK_ENABLED', 'UNBLOCK_SAFETY_APPROVED', 'UNBLOCK_SCRIPTS_APPROVED', 'UNBLOCK_AGENTS_VERIFIED', 'UNBLOCK_TOOL_SECRET', 'three distinct Unblock agents'])assert.ok(missing.includes(name), name);
    process.env['UNBLOCK_OPENING_AGENT_ID'] = process.env['UNBLOCK_WEEKLY_AGENT_ID'] = process.env['UNBLOCK_LIGHT_AGENT_ID'] = 'same';
    assert.ok(unblockReadiness().includes('three distinct Unblock agents'));
  } finally { for (const k of Object.keys(process.env).filter(k => k.startsWith('UNBLOCK_'))) delete process.env[k]; Object.assign(process.env, saved); }
});
