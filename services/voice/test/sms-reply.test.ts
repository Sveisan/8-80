import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTo, parseReply } from '../src/sms/reply.ts';

test('a day and a time is a move', () => {
  assert.deepEqual(parseReply('wednesday at 9'), { kind: 'move', weekday: 3, minute: 540, always: false });
  assert.deepEqual(parseReply('Thu 08:30'), { kind: 'move', weekday: 4, minute: 510, always: false });
  assert.deepEqual(parseReply('friday half past seven'), { kind: 'move', weekday: 5, minute: 450, always: false });
});

test('a bare hour is read the way somebody rescheduling a call means it', () => {
  // Nobody moves a call to four in the morning.
  assert.deepEqual(parseReply('monday at 4'), { kind: 'move', weekday: 1, minute: 16 * 60, always: false });
  assert.deepEqual(parseReply('monday at 4 in the morning'), { kind: 'move', weekday: 1, minute: 4 * 60, always: false });
  assert.deepEqual(parseReply('tuesday 9am'), { kind: 'move', weekday: 2, minute: 9 * 60, always: false });
  assert.deepEqual(parseReply('tuesday 9pm'), { kind: 'move', weekday: 2, minute: 21 * 60, always: false });
});

test('moving for good is said, never inferred', () => {
  assert.equal((parseReply('wednesday at 9') as { always: boolean }).always, false);
  assert.equal((parseReply('wednesday at 9 always') as { always: boolean }).always, true);
  assert.equal((parseReply('wednesdays at 9 from now on') as { always: boolean }).always, true);
});

test('skip and later are recognised without a day in them', () => {
  assert.deepEqual(parseReply('skip'), { kind: 'skip' });
  assert.deepEqual(parseReply('not this week'), { kind: 'skip' });
  assert.deepEqual(parseReply('later'), { kind: 'later' });
  assert.deepEqual(parseReply('tonight please'), { kind: 'later' });
});

test('an intention with no day beats a scan for days', () => {
  // "next week" contains no weekday. A parser looking for days first finds
  // none, and then has to decide what to do with a sentence it did not read.
  assert.deepEqual(parseReply('leave it, next week is fine'), { kind: 'skip' });
});

test('anything it cannot read comes back unread, not guessed', () => {
  assert.deepEqual(parseReply("not this—actually I'm at my mother's funeral"), { kind: 'skip' });
  assert.deepEqual(parseReply('maybe sometime'), { kind: 'unparsed' });
  assert.deepEqual(parseReply('👍'), { kind: 'unparsed' });
  assert.deepEqual(parseReply(''), { kind: 'unparsed' });
  assert.deepEqual(parseReply('wednesday'), { kind: 'unparsed' }, 'a day with no time is not enough to ring somebody');
});

test('a move lands on the right instant in the caller zone', () => {
  const reply = parseReply('wednesday at 9');
  assert.equal(reply.kind, 'move');
  const at = moveTo(reply as Extract<typeof reply, { kind: 'move' }>, 'Europe/Oslo', new Date('2026-09-08T10:00:00Z'));
  // Oslo is UTC+2 in September: 09:00 local on Wednesday the 9th is 07:00Z.
  assert.equal(at.toISOString(), '2026-09-09T07:00:00.000Z');
});

test('a concrete day and time beats any phrase sharing the line with it', () => {
  // All three of these had their week quietly cancelled: they offered an
  // alternative and the phrase checks got there first.
  const thursday = parseReply('Can we move it to next week, Thursday 10:00?');
  assert.deepEqual(thursday, { kind: 'move', weekday: 4, minute: 600, always: false });

  const saturday = parseReply("I'm not free Friday, how about Saturday 10:00?");
  assert.equal(saturday.kind, 'move');

  const tomorrow = parseReply("sorry, can't do today — try me tomorrow at 9", new Date('2026-09-20T12:00:00Z'));
  assert.deepEqual(tomorrow, { kind: 'move', weekday: 1, minute: 540, always: false });
});

test('a day with no time is not rounded down to skipping their week', () => {
  // They asked for something specific. Cancelling the week is not a smaller
  // version of it, so a human answers.
  assert.deepEqual(parseReply("Let's do Tuesday next week"), { kind: 'unparsed' });
  assert.deepEqual(parseReply('Monday'), { kind: 'unparsed' });
});

test('a refusal still wins over a day, because not ringing is the safe error', () => {
  assert.equal(parseReply('skip Tuesday').kind, 'skip');
  assert.equal(parseReply('not this week, Tuesday is bad too').kind, 'skip');
});

test('today and tomorrow are the caller\'s, not the server\'s', () => {
  // 00:30 on Monday in Oslo is 22:30 on Sunday in UTC. Read against the server
  // clock, "tomorrow" named the day they were already in.
  const lateSunday = new Date('2026-09-20T22:30:00Z');
  assert.equal(parseReply('tomorrow at 9', lateSunday, 'Europe/Oslo').kind, 'move');
  assert.deepEqual(
    parseReply('tomorrow at 9', lateSunday, 'Europe/Oslo'),
    { kind: 'move', weekday: 2, minute: 540, always: false },
    'Tuesday — it is already Monday where they are',
  );
});

test('"next week" means skip only when no day speaks for it', () => {
  // On its own it means skip this week. As the tail of "Tuesday next week" it
  // is part of a move, and reading it as skip cancelled the week of somebody
  // who had just named a day.
  assert.deepEqual(parseReply('Can we do next week?'), { kind: 'skip' });
  assert.deepEqual(parseReply('leave it, next week is fine'), { kind: 'skip' });
  assert.deepEqual(parseReply("Let's do Tuesday next week"), { kind: 'unparsed' });
});
