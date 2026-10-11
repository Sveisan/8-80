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
    case 'reactivate': return { type:'reactivate',id };
    default: throw new PracticeError('command_unknown');
  }
}
export const messages: Record<string,string> = {
  wording_required:'Please use your own words to complete the question.',
  evidence_required:'Add at least one genuine experience that supports your decision.',
  caller_confirmation_required:'Please confirm that these are your words and your choice.',
  onboarding_incomplete:'Map at least three beliefs, prepare two decisions and confirm you understand the practice.',
  discovery_complete:'Your programme follows the beliefs you mapped during onboarding.',
  programme_complete:'Your enrolled programme is complete. You can still revisit your decisions here.',
  deletion_confirmation_required:'Type DELETE to confirm erasing your entire 8&80 account.',
  score_invalid:'Choose your own score between zero and ten.',
  review_already_recorded:'This decision already has a score for this weekly review.',
  page_changed:'Your practice changed in another tab. Review the current page before saving again.',
  calls_too_close:'Leave at least 45 minutes between your daily call and weekly review.',
  outside_coverage:'Choose call times within the human response hours shown below. Contact us if you need another time.',
  base_calls_too_close:'Leave at least 45 minutes between these calls and your weekly 8&80 call.',
  onboarding_time_invalid:'Choose a future onboarding time within the next 30 days.',
  schedule_invalid:'Check the times and weekly review day.',
  timezone_invalid:'Choose a valid timezone, such as Europe/Oslo.',
  practice_paused:'Resume your practice before adding a reflection.',
  belief_inactive:'This decision is not currently in daily practice.',
  review_not_due:'Your next weekly review is not due yet.',
};
