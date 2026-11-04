import { WeeklyToolError } from './reminders.ts';

/** Fixed explanations prevent the model from inventing a cause for a refusal. */
export function weeklyToolFailure(error:unknown) {
  const code=error instanceof WeeklyToolError?error.code:error instanceof SyntaxError?'invalid_json':'tool_unavailable';
  const reason=error instanceof WeeklyToolError?error.reason:undefined;
  let message='I couldn’t complete that request. Nothing was confirmed.',recovery='stop';
  if(code==='tool_unavailable'){
    message='I couldn’t confirm whether that change went through. I’ll check its status.';recovery='check_status_then_retry_identical_request';
  }else if(code==='unauthorized'||code==='session_closed'){
    message='I can’t access these controls for this call. Nothing was confirmed.';
  }else if(code==='choose_time_two_minutes_to_thirty_days_ahead'){
    message=reason==='past'?'That local time has already passed. Nothing was scheduled.':reason==='horizon'?'That is more than thirty days ahead. Nothing was scheduled.':reason==='minimum_delay'?'That time is less than two minutes away. Nothing was scheduled.':'Please choose a time from two minutes to thirty days ahead. Nothing was scheduled.';
    recovery='read_status_use_after_minutes_for_relative_request';
  }else if(['draft_expired_or_reminder_changed','original_reminder_no_longer_pending','time_has_passed','pending_reminder_revision_required','reminder_changed_read_status'].includes(code)){
    message='The reminder proposal is no longer current. I need to check it and agree the details with you again.';recovery='read_status_prepare_again_and_get_fresh_confirmation';
  }else if(code==='whole_minutes_required'){
    message='I need a whole number of minutes. Nothing was scheduled.';recovery='clarify_minutes';
  }else if(code==='no_time_change'){
    message='That would leave the reminder at the same time. Nothing was changed.';
  }else if(code==='nonexistent_local_time'||code==='ambiguous_local_time_choose_another'){
    message='That local time is affected by the clock change. Please choose another time. Nothing was scheduled.';recovery='clarify_local_time';
  }else if(code==='explicit_confirmation_required'){
    message='I need your confirmation of the exact text and time before I save it.';recovery='read_proposal_and_wait';
  }else if(code==='tips_disabled'){
    message='Feature suggestions are switched off.';
  }else if(code==='reminders_unavailable'||code==='reminder_beyond_access'){
    message='I can’t arrange that reminder with the access currently available. Nothing was scheduled.';
  }
  return {status:code==='request_too_large'?413:code==='unauthorized'?401:code==='invalid_json'?400:code==='tool_unavailable'?503:409,
    body:{error:code,...(reason?{reason}:{}),user_message:message,recovery,
      instruction:'Read user_message as the explanation. Follow recovery; do not invent another cause. A refused request confirms no action; an unconfirmed request must be checked before claiming an outcome.'}};
}
