import { parseWeekday } from '../schedule/time.ts';
import { PracticeError } from '../beliefs/model.ts';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Shown in the week-ordered light-day picker. */
export const LIGHT_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The schedule page posts one checkbox per light day plus a "no light calls" choice.
 * The repository reads a single `light_days` text, so fold them here.
 * An untouched form (no checkbox, no choice) means the product default.
 */
export function normaliseSchedule(form: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(form);
  const days = form.getAll('light_day').map(d => parseWeekday(d)).filter((d): d is number => d !== undefined);
  const choice = form.get('light_choice');
  out.delete('light_day');
  if (choice === 'none') out.set('light_days', 'none');
  else if (days.length) out.set('light_days', [...new Set(days)].map(d => WEEKDAYS[d]!.toLowerCase()).join(','));
  else if (choice === 'evenings') throw new PracticeError('days_invalid');
  else out.set('light_days', '');
  return out;
}

export const messages: Record<string, string> = {
  page_changed: 'Your account changed in another tab. Look at the current page before saving again.',
  event_conflict: 'That request has already been used with different content. Open the page again before saving.',
  programme_complete: 'Your calls have ended. Everything stays here, and no more calls will be placed.',
  programme_paused: 'Your calls are paused. Resume them first.',
  enrollment_unknown: 'No Unblock enrolment is attached to this account.',
  deletion_confirmation_required: 'Type DELETE to confirm erasing your entire 8&80 account.',
  schedule_invalid: 'Check the weekday and times you chose.',
  timezone_invalid: 'Choose a valid timezone, such as Europe/Oslo.',
  onboarding_time_invalid: 'Choose a first conversation time in the future, within the next 30 days.',
  nonexistent_local_time: 'That local time does not exist when the clocks change. Choose another time.',
  calls_too_close: 'Leave at least 45 minutes between a light call and your weekly call.',
  base_calls_too_close: 'Leave at least 45 minutes between these calls and your weekly 8&80 call.',
  outside_coverage: 'Choose call times within the human response hours shown below. Contact us if you need another time.',
  occurrence_too_late: 'Choose a time after your usual one and before the following usual call, or skip this call instead.',
  occurrence_too_early: 'Choose a time after your usual one and before the following usual call, or skip this call instead.',
  call_in_progress: 'A call is already being placed. Change the next call after it finishes.',
  calls_held: 'Calls are paused or on hold. Contact us if you need help before changing this call.',
  days_invalid: 'Check the days you chose for light calls.',
  time_invalid: 'Check the time you chose for light calls.',
};
