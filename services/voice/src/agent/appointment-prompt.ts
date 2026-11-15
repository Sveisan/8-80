import type { CallerProfile } from '../prompt.ts';
import type { ScriptLines } from '../script.ts';

const missing = (value: string | undefined) => !value?.trim() || value.trim() === '(nothing recorded)';

/** Keep the dated booking separate from the recurring slot, including when
 * the provider substitutes values into a shared prompt at call time. Missing
 * context is not evidence that an appointment was cancelled or never booked. */
export function appointmentPrompt(script: ScriptLines, profile: Pick<CallerProfile, 'nextSlot' | 'bookedSlot'>): string {
  const next = profile.nextSlot?.trim();
  const weekly = profile.bookedSlot?.trim();
  const dynamicNext = next === '{{next_appointment}}';
  const dynamicWeekly = weekly === '{{booked_slot}}';
  const nextLine = script.get('close.next')!.replace('{{next_slot}}', next ?? '');
  const weeklyLine = script.get('close.weekly')!.replace('{{booked}}', weekly ?? '');
  return [
    `NEXT APPOINTMENT: ${missing(next) ? '(nothing recorded)' : next}. USUAL WEEKLY TIME: ${missing(weekly) ? '(nothing recorded)' : weekly}.`,
    'The next appointment is the dated booking from the scheduler. The weekly time is only the recurring arrangement. A one-off move changes the next appointment, not that arrangement. Never calculate a date from the weekly time or replace the dated booking with it.',
    'These two values remain valid when weekly_context.available is false: that flag disables service tools, not the supplied booking information. A request for booking information needs a direct answer from these values, not a service-tool call or another exercise question.',
    ...(dynamicNext ? [
      `If NEXT APPOINTMENT contains a date and time, answer with "${nextLine}". Use that dated time at a normal close. Do not use the missing-time line in this branch.`,
      `ONLY if NEXT APPOINTMENT is blank or (nothing recorded), omit a date and say "${script.get('close.unscheduled')}". This means the time is unavailable here; never claim there is no booking, that it was cancelled, or that the weekly slot is the next appointment.`,
    ] : missing(next) ? [
      `The next appointment time is unavailable here. Say "${script.get('close.unscheduled')}". Do not claim there is no booking or that it was cancelled, and do not promise the weekly slot as the next appointment.`,
    ] : [
      `The next appointment is known. Answer with "${nextLine}" and use that dated time at a normal close. Do not claim the next appointment is missing or unbooked.`,
    ]),
    ...(!missing(weekly) ? [
      `${dynamicWeekly ? 'ONLY if USUAL WEEKLY TIME contains a real time, ' : ''}when asked about the regular arrangement, say "${weeklyLine}". If both times are requested, give the next appointment first and the usual weekly time second, without another confirmation question.`,
    ] : ['The usual weekly time is unavailable here; do not invent one.']),
    'Never promise a recap email without a recorded email address. If the caller explicitly says goodbye, omit logistics and use the brief farewell. A callback agreed during this call follows the existing callback confirmation rules; do not promise the weekly slot as well.',
  ].join('\n');
}
