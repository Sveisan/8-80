import { PracticeError, type Command } from './model.ts';
export function commandFrom(form: URLSearchParams, week?: number): Command {
  const text = (k: string) => (form.get(k) ?? '').trim();
  const id = text('id');
  const confirmed = text('confirmed') === 'yes';
  switch (text('action')) {
    case 'outcome': return { type:'outcome',outcome:text('outcome') };
    case 'queue': return { type:'queue',belief:text('belief'),trigger:text('trigger') };
    case 'prepare': return { type:'prepare',id,decision:text('decision'),evidence:text('evidence').split('\n').filter(Boolean),balance:text('balance'),opportunity:text('opportunity'),confirmed };
    case 'understood': return { type:'understood',confirmed };
    case 'practice': return { type:'practice',id,evidence:text('evidence'),balance:text('balance'),passed:text('passed')==='yes' };
    case 'review':
      if (week === undefined) throw new PracticeError('review_not_due');
      if (!text('score')) throw new PracticeError('score_invalid');
      return { type:'review',id,week,score:Number(text('score')),reflection:text('reflection'),confirmed };
    case 'pause': return { type:'pause' };
    case 'resume': return { type:'resume' };
    case 'remove': return {type:'remove',id};
    case 'correct_completion': return {type:'correct_completion',id,confirmed};
    case 'reactivate': return { type:'reactivate',id };
    default: throw new PracticeError('command_unknown');
  }
}
export const messages: Record<string,string> = {
  outcome_locked:'Your purchase covers your chosen outcome. Add related beliefs here, or finish this programme before choosing a new paid programme.',
  unfinished_programme:'Your unfinished programme remains available under its existing purchase. Resume it without paying again.',
  newer_programme_exists:'Contact support to correct an older completed programme while another programme is open. No extra payment is required for a correction.',
  new_purchase_confirmation_required:'Confirm that this is a new programme with a separate one-time payment.',
  completion_confirmation_required:'Confirm that completion was a mistake and choose the decision to restore.',
  checkin_unavailable:'The included check-in is unavailable or already used. Contact support if a previous call was not delivered.',
  refund_request_invalid:'Choose a request type for this paid programme. Contact support for other payment questions.',
  retention_date_invalid:'Choose a valid date after the current deletion date.',
  history_deleted:'This programme’s personal history has been deleted. Its unused check-in remains available; support can help with payment records.',
  history_confirmation_required:'Type DELETE HISTORY to delete only this completed programme’s history.',
  queue_item_required:'Only queued material can be removed. Your earlier practice history stays available.',
  wording_required:'Please use your own words to complete the question.',
  evidence_required:'Add at least one genuine experience that supports your decision.',
  preparation_not_due:'We prepare a queued belief when a practice slot becomes available. Your current decisions stay in daily practice.',
  caller_confirmation_required:'Please confirm that these are your words and your choice.',
  onboarding_incomplete:'Prepare at least one decision with genuine supporting experiences, then confirm you understand the practice.',
  discovery_complete:'Your programme follows the beliefs you mapped during onboarding.',
  programme_complete:'Your enrolled programme is complete. You can still revisit your decisions here.',
  deletion_confirmation_required:'Type DELETE to confirm erasing your entire 8&80 account.',
  score_invalid:'Choose your own score between zero and ten.',
  review_already_recorded:'This decision already has a score for this weekly review.',
  page_changed:'Your practice changed in another tab. Review the current page before saving again.',
  event_conflict:'This request has already been used with different content. Open the current page before saving.',
  calls_too_close:'Leave at least 45 minutes between your daily call and weekly review.',
  outside_coverage:'Choose call times within the human response hours shown below. Contact us if you need another time.',
  base_calls_too_close:'Leave at least 45 minutes between these calls and your weekly 8&80 call.',
  onboarding_time_invalid:'Choose a future onboarding time within the next 30 days.',
  schedule_invalid:'Check the times and weekly review day.',
  nonexistent_local_time:'That local time does not exist when the clocks change. Choose another time.',
  occurrence_too_late:'Move this call before the following usual call, or skip it instead.',
  call_in_progress:'A call is already being placed. Change the next appointment after it finishes.',
  calls_held:'Calls are paused or on hold. Contact us if you need help before changing this appointment.',
  timezone_invalid:'Choose a valid timezone, such as Europe/Oslo.',
  practice_paused:'Resume your practice before adding a reflection.',
  belief_inactive:'This decision is not currently in daily practice.',
  review_not_due:'Your next weekly review is not due yet.',
};
