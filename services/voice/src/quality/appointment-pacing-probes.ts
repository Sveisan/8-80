import {weeklyFlow, weeklyFlowRoles, type WeeklyFlowRole} from '../agent/weekly-flow.ts';

const variables = (role: WeeklyFlowRole) => ({
  first_name: 'Synthetic', call_number: role.endsWith('first') ? '1' : '2',
  own_eight: 'drawing', own_eighty: 'time outdoors', own_goals: 'learn to sail',
  last_commitment: 'phone the sailing school', last_day: '', last_belief: '(nothing recorded)',
  weeks_undone_running: '0', booked_slot: 'Thursday at 09:30',
  next_appointment: 'Tuesday 24 November at 14:00 CET',
  onboarding_progress: role.endsWith('first') ? 'pending' : 'complete', weekly_context: '{"available":false}',
});
const cases = [
  {id: 'known_times', phase: 'post_action', context: 'The caller has confirmed their action and the flow has spoken its acknowledgement. Caller: When is my next call, and is my usual weekly time still the same?', criteria: 'Answer directly in at most two short sentences: the NEXT appointment is Tuesday 24 November at 14:00 CET, and the USUAL weekly time remains Thursday at 09:30. Keep those separate. No question, tool call, claim that no call is booked, or replacement of the next call with Thursday.'},
  {id: 'known_close', phase: 'post_action', context: 'The full action read-back got a fresh yes. The flow acknowledged it and spoke the post-action question about anything else to discuss. Caller: Yes, just remind me when my next call is. The caller is asking for one booking fact, not another exercise or confirmation.', criteria: 'Answer that direct request now with Tuesday 24 November at 14:00 CET. No question, new action invitation, extra confirmation or waiting for an acknowledgement. Do not claim no call is booked, use Thursday as the next call, or promise a recap email without an email address.'},
  {id: 'missing_next', phase: 'post_action', next: '(nothing recorded)', context: 'There is no dated next appointment in the supplied data; the usual weekly slot is still present. Caller: When will you call me next?', criteria: 'The next appointment time is unavailable here. Direct the caller to their call page. Do not invent a date or state a weekday/time as the next booking. Do not claim no call is booked or that it was cancelled. No question or tool call.'},
  {id: 'delay_feedback', phase: 'post_action', context: 'The action was fully confirmed and acknowledged. Caller: The pauses are too long. I have finished my answer, so please carry on and tell me when my next call is.', criteria: 'Briefly acknowledge the feedback, then directly give Tuesday 24 November at 14:00 CET in the same turn. No question, skip_turn, instruction to take their time, request to repeat their answer, or claim that there is no booking.'},
  {id: 'action_fragment', phase: 'action_answer', context: 'The complete action read-back was just asked. Caller: Um, I... The thought is unfinished and no agreement has arrived.', tool: 'skip_turn'},
  {id: 'thinking_time', phase: 'post_action', context: 'The action marker has played, but the caller now says: Please give me a moment. I am still thinking and have something to add.', tool: 'skip_turn'},
  {id: 'short_location', firstOnly: true, phase: 'introduction', context: 'The greeting, full AI disclosure and frame have already been spoken. Assistant asked: Are you at home, out somewhere, or driving? Caller: At home. This is a completed answer, not a fragment.', criteria: 'Continue with the at-home eight-year-old perspective question. No skip_turn, repeated availability/location check, repeated disclosure, or artificial request for acknowledgement.'},
  {id: 'map_marker', firstOnly: true, phase: 'conversation', context: 'The full map was read back: drawing, time outdoors and learn to sail. The caller gave a fresh explicit yes. The flow acknowledged the map and spoke its phase-entry focus question. Caller: I would like to focus on learning to sail. This is a completed answer, not a fragment.', criteria: 'Continue to one relevant action invitation using the confirmed map and chosen sailing focus, without skip_turn, another map/focus check, asking permission to continue again, repeating the greeting, or waiting for another okay.'},
] as const;

/** Real rendered phase prompts, with fictional data only. Text tests check
 * wording and tool intent; they cannot establish acoustic latency or playout. */
export function appointmentPacingProbePlan(sourceCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A full source commit is required.');
  const probes = weeklyFlowRoles.flatMap(role => cases.filter(c => !('firstOnly' in c) || role.endsWith('first')).map(c => {
    const values = {...variables(role), ...('next' in c ? {next_appointment: c.next} : {})};
    const template = String(weeklyFlow(role).nodes.find(n => n.key === c.phase)!.config!.system_prompt_override);
    const prompt = template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error('Undeclared probe variable.');
      return values[key as keyof typeof values];
    });
    return {role, case: c.id, phase: c.phase, prompt, definition: {
      name: '8&80 fictional appointment/pacing · ' + c.id,
      description: 'Synthetic regression; no customer data, phone call or live tool endpoint.',
      ...('tool' in c ? {type: 'tool' as const, config: {context: c.context, expected_tool: c.tool}}
        : {type: 'reply' as const, config: {context: c.context, success_criteria: c.criteria}}),
    }};
  }));
  return {version: 1, sourceCommit, probes, responseDelaySeconds: 0, audioTested: false, phaseExitsTested: false, voiceApproved: false};
}

/** Additional hard checks supplement the provider's semantic grader. */
export function appointmentPacingReplyPasses(id: string, reply: string): boolean {
  const text = reply.replace(/[’‘]/g, "'").toLowerCase();
  if (!text.trim() || /something went wrong|(?:no|isn't|is not|not) (?:another |next )?(?:call|appointment|booking).*(?:booked|scheduled)|cancelled/.test(text)) return false;
  const datedTime = /tuesday/.test(text) && /(?:14[:.]00|two|2(?::00)?\s*p\.?m)/.test(text);
  if (id === 'known_times') return datedTime && /thursday/.test(text) && /(?:09[:.]30|9[:.]30|nine thirty)/.test(text) && /usual|weekly|regular/.test(text) && text.indexOf('tuesday') < text.indexOf('thursday') && !text.includes('?');
  if (id === 'known_close') return datedTime && !/\?|email|choose.*action|what.*this week/.test(text);
  if (id === 'delay_feedback') return datedTime && !/\?|take your time|say.*again|repeat|still thinking/.test(text);
  if (id === 'missing_next') return /call page/.test(text) && !/monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d[:.]\d\d/.test(text);
  if (id === 'short_location') return /eight.year.old/.test(text) && text.includes('?') && !/are you at home|good time|i'm an ai/.test(text);
  if (id === 'map_marker') return text.includes('?') && !/have i got that right|shall we.*continue|is now.*time/.test(text);
  return false;
}
