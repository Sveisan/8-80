import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { parseReply } from '../src/sms/reply.ts';
import { handleReply, textAfterMissedCall } from '../src/sms/missed.ts';
import { confirmStopPage, reschedulePage, stoppedPage } from '../src/link/page.ts';
import { OptedOut, type Sms } from '../src/sms/types.ts';
import type { Scheduler } from '../src/schedule/scheduler.ts';
import type { Slot } from '../src/schedule/time.ts';

const script = loadScript();
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };
const NOW = new Date('2026-09-08T06:00:00Z');

/** Enough Scheduler to watch, and nothing that needs a database. */
function fakeScheduler() {
  const calls: string[] = [];
  const api = {
    calls,
    paused: undefined as boolean | undefined,
    async setPaused(_phone: string, paused: boolean) {
      calls.push(`setPaused:${paused}`);
      api.paused = paused;
    },
    async setSlot() {
      calls.push('setSlot');
      return new Date('2026-09-15T06:00:00Z');
    },
    async callAgainAt() {
      calls.push('callAgainAt');
    },
    async claimNudge() {
      calls.push('claimNudge');
      return true;
    },
  };
  return api;
}
const as = (s: ReturnType<typeof fakeScheduler>) => s as unknown as Scheduler;

class Outbox implements Sms {
  readonly sent: string[] = [];
  async send(_to: string, body: string): Promise<void> {
    this.sent.push(body);
  }
}

test('the carrier keywords stop the calls, in both languages', () => {
  for (const word of ['STOP', 'stop', 'Stopp', 'UNSUBSCRIBE', 'cancel', 'QUIT', 'slutt', 'avslutt', 'stop.']) {
    assert.equal(parseReply(word, NOW, OSLO.timezone).kind, 'stop', word);
  }
});

test('a stop wins over a day and a time in the same message', () => {
  // "Stop calling me on Tuesdays" contains a weekday, and the day-and-time
  // rule runs before everything else — so this is the one case where it must
  // not. Not ringing somebody is always the safer error.
  assert.equal(parseReply('stop calling me on tuesdays', NOW, OSLO.timezone).kind, 'stop');
  assert.equal(parseReply('please stop calling, 9am or any other time', NOW, OSLO.timezone).kind, 'stop');
});

test('one week off is not leaving', () => {
  // The expensive mistake in the other direction: somebody asking for a week
  // off, ended permanently because their sentence contained the word cancel.
  for (const said of ['cancel this week', 'skip this week', "can't this week, cancel it"]) {
    assert.equal(parseReply(said, NOW, OSLO.timezone).kind, 'skip', said);
  }
});

test('a sentence that cancels the whole thing cancels the whole thing', () => {
  for (const said of ['cancel everything', 'please cancel the calls', 'cancel my subscription']) {
    assert.equal(parseReply(said, NOW, OSLO.timezone).kind, 'stop', said);
  }
});

test('"call me again on Friday" is not a stop, and "never call me again" is', () => {
  const friday = parseReply('call me again on friday at 9', NOW, OSLO.timezone);
  assert.equal(friday.kind, 'move');
  assert.equal(parseReply("don't call me again", NOW, OSLO.timezone).kind, 'stop');
  assert.equal(parseReply('never call me again please', NOW, OSLO.timezone).kind, 'stop');
});

test('START brings them back and lands on a real next slot', async () => {
  assert.equal(parseReply('START', NOW, OSLO.timezone).kind, 'start');
  const sched = fakeScheduler();
  const out = await handleReply('+4790000000', 'start', OSLO, { sms: new Outbox(), scheduler: as(sched), script }, NOW);
  assert.equal(out.action, 'started');
  // Unpausing alone would leave next_call_at in the past, which the tick reads
  // as a missed week the moment it sees it.
  assert.deepEqual(sched.calls, ['setPaused:false', 'setSlot']);
});

test('the calls stop before anybody is told they have', async () => {
  const sched = fakeScheduler();
  const sms = new Outbox();
  const out = await handleReply('+4790000000', 'STOP', OSLO, { sms, scheduler: as(sched), script }, NOW);
  assert.equal(out.action, 'stopped');
  assert.equal(sched.paused, true);
  assert.ok(sms.sent[0]?.length, 'and then they are told');
});

test('a confirmation that cannot be delivered does not undo the stop', async () => {
  // After a carrier handles a STOP, messages to that number are blocked — so
  // the confirmation is the one send guaranteed to fail, on the one action
  // that must never fail to take effect.
  const sched = fakeScheduler();
  const refusing: Sms = {
    async send() {
      throw new OptedOut(21610);
    },
  };
  const out = await handleReply('+4790000000', 'STOP', OSLO, { sms: refusing, scheduler: as(sched), script }, NOW);
  assert.equal(out.action, 'stopped');
  assert.equal(sched.paused, true);
});

test('an opted-out number stops being called, not just being texted', async () => {
  // The path that closes the hole: a carrier handles STOP before our webhook
  // sees it, so the first we learn of it is a rejected send on the next missed
  // call. Until this existed that person could not receive the one message
  // offering a way out and was still being rung every week.
  const sched = fakeScheduler();
  const refusing: Sms = {
    async send() {
      throw new OptedOut(21610);
    },
  };
  const sent = await textAfterMissedCall('attempt-1', '+4790000000', { sms: refusing, scheduler: as(sched), script }, 'https://x.test/r/t');
  assert.equal(sent, false);
  assert.equal(sched.paused, true, 'the calls stop');
});

test('an ordinary send failure is still a failure', async () => {
  const sched = fakeScheduler();
  const broken: Sms = {
    async send() {
      throw new Error('Twilio refused the message (HTTP 500)');
    },
  };
  await assert.rejects(
    () => textAfterMissedCall('a', '+4790000000', { sms: broken, scheduler: as(sched), script }, 'https://x.test/r/t'),
    /HTTP 500/,
  );
  assert.equal(sched.paused, undefined, 'and nobody is quietly unsubscribed by an outage');
});

test('the way out is on the page, and the way back is on the page after it', () => {
  const page = reschedulePage(OSLO, script);
  assert.ok(page.includes('value="stop"'), 'the exit is named on the page');
  const confirm = confirmStopPage(script);
  assert.ok(confirm.includes('value="stop-confirm"') && confirm.includes('value="stop-cancel"'), 'both answers');
  const stopped = stoppedPage(script);
  assert.ok(stopped.includes('value="start"'), 'somebody whose number is blocked has only this link');
});

test('every line the stop path says is in SCRIPT.md', () => {
  for (const key of [
    'sms.stopped',
    'sms.started',
    'page.stop',
    'page.stop.confirm',
    'page.stop.detail',
    'page.stop.yes',
    'page.stop.no',
    'page.stopped',
    'page.stopped.back',
  ]) {
    assert.ok(script.get(key), `${key} is missing`);
  }
});
