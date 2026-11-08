import { loadScript } from '../script.ts';
import { weeklyReadBackSpan } from '../call/weekly-lines.ts';

const quiet = new Set(['acknowledgement', 'caller_continues', 'thinking_fragments', 'thinking_after_patience', 'quiet_after_sound_feedback', 'returned_goodbye', 'after_end_tool']);
const map = new Set(['complete_short_reply', 'full_map_before_confirmation', 'partial_map_repair']);
const normalized = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Additional hard gates for fictional provider replies. An LLM judge cannot
 * override silence, the fixed map contract or a missing/errored response. This
 * checks generated text only, not whether a voice runtime plays it correctly. */
export function dialogueReplyFailures(id: string, reply: unknown): string[] {
  if (typeof reply !== 'string') return ['missing_reply'];
  if (quiet.has(id)) return reply.trim() ? ['speech_in_quiet_turn'] : [];
  const failures: string[] = [];
  if (map.has(id)) {
    const readback = weeklyReadBackSpan([reply], loadScript(), 'read.first.keep');
    if (!readback || normalized(readback.values['eight'] ?? '') !== 'playing games'
      || normalized(readback.values['eighty'] ?? '') !== 'time with family'
      || normalized(readback.values['goals'] ?? '') !== 'learn to sail') failures.push('incomplete_or_changed_map');
    if (/keep that for next time|focus on this week/i.test(reply)) failures.push('map_agreement_skipped');
  }
  if (['complete_short_reply', 'agreed_action_okay'].includes(id) && /sorry|go ahead|go on|please continue/i.test(reply)) failures.push('false_interruption_repair');
  if (id === 'listening_sound_feedback') {
    if (!/sounds|interrupt|\bm+m+\b|\bhmm\b/i.test(reply) || /ease off.*questions/i.test(reply)) failures.push('wrong_feedback_response');
    if (/\?|\btell me\b|\bgo on\b|\bgo ahead\b/i.test(reply)) failures.push('feedback_floor_taken');
  }
  if (['new_goal_acknowledged', 'ignored_answer_feedback'].includes(id)) {
    const beforeQuestion = reply.split('?')[0] ?? '';
    // A question such as "What else besides making money?" is still a skipped
    // acknowledgement; require the factual reaction to finish before it.
    const statement = beforeQuestion.split(/[.!]/).slice(0, -1).join('.');
    if (!/money|earn|income/i.test(statement)) failures.push('goal_not_acknowledged_before_question');
    if (/rent and dinner/i.test(reply)) failures.push('money_joke');
    if (id === 'ignored_answer_feedback' && reply.includes('?')) failures.push('feedback_floor_taken');
  }
  return failures;
}
