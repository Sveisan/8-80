import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reminderTime,relativeReminderTime,WeeklyToolError} from '../src/weekly/reminders.ts';
import {weeklyToolFailure} from '../src/weekly/errors.ts';

test('the observed UTC-as-Oslo failure is explained as a past local time, not a minimum delay',()=>{
  let error:unknown;try{reminderTime('2026-11-04','10:43','Europe/Oslo',new Date('2026-11-04T10:38:27Z'));}catch(e){error=e;}
  const result=weeklyToolFailure(error);
  assert.equal(result.status,409);assert.equal(result.body.reason,'past');
  assert.match(result.body.user_message,/already passed/);assert.doesNotMatch(result.body.user_message,/less than two|too soon/);
  assert.match(result.body.recovery,/after_minutes/);
});

test('minimum delay and horizon failures keep distinct authoritative explanations',()=>{
  const at=new Date('2026-11-04T10:38:00Z');
  for(const [date,time,reason,words]of [['2026-11-04','11:39','minimum_delay',/less than two/],['2027-01-01','11:00','horizon',/thirty days/]] as const){
    let error:unknown;try{reminderTime(date,time,'Europe/Oslo',at);}catch(e){error=e;}
    const result=weeklyToolFailure(error);assert.equal(result.body.reason,reason);assert.match(result.body.user_message,words);
  }
});

test('unknown failures stay unconfirmed and cannot leak provider content or claim no effect',()=>{
  const result=weeklyToolFailure(new Error('private-provider-body-with-credential'));
  assert.equal(result.status,503);assert.match(result.body.user_message,/couldn’t confirm/);
  assert.doesNotMatch(JSON.stringify(result),/private-provider|credential|Nothing was scheduled/);
  assert.equal(result.body.recovery,'check_status_then_retry_identical_request');
});

test('stale proposals require a fresh read-back and confirmation; unauthorized requests stop',()=>{
  assert.equal(weeklyToolFailure(new WeeklyToolError('draft_expired_or_reminder_changed')).body.recovery,'read_status_prepare_again_and_get_fresh_confirmation');
  const unauthorized=weeklyToolFailure(new WeeklyToolError('unauthorized'));
  assert.equal(unauthorized.status,401);assert.equal(unauthorized.body.recovery,'stop');
});

test('relative input errors distinguish fractional minutes, minimum delay and an unchanged appointment',()=>{
  const at=new Date('2026-11-04T10:38:00Z');
  const explain=(value:unknown,existing?:Date)=>{try{relativeReminderTime(value,at,existing);assert.fail('expected refusal');}catch(e){return weeklyToolFailure(e).body;}};
  assert.match(explain(1).user_message,/less than two/);
  assert.match(explain(2.5).user_message,/whole number/);
  assert.match(explain(0,new Date(+at+5*60000)).user_message,/same time/);
});
