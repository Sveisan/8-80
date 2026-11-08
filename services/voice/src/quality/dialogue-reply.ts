import { loadScript } from '../script.ts';
import { weeklyReadBackSpan } from '../call/weekly-lines.ts';
import { dialogueCases } from './dialogue-cases.ts';

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

/** Require the full four-agent matrix, both the provider verdict and our hard
 * gates. Output contains no dialogue, identity or provider rationale. */
export function dialogueBatchReport(input: unknown) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Expected a bounded dialogue result array.');
  const roles = ['first', 'return', 'female-first', 'female-return'];
  const rows = input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid dialogue result.');
    const row = item as Record<string, unknown>;
    const role = String(row['role']), id = String(row['case']);
    const failures = dialogueReplyFailures(id, row['reply']);
    const scenario = dialogueCases.find(c => c.id === id);
    if (scenario && 'expectedTool' in scenario && row['toolCalled'] !== scenario.expectedTool) failures.push('expected_tool_not_observed');
    const providerPassed = row['status'] === 'completed' && row['verdict'] === 'passed' && row['passed'] === true;
    return { role, case: id, providerPassed, failures, passed: providerPassed && failures.length === 0 };
  });
  const perRole = Object.fromEntries(roles.map(role => {
    const expected = dialogueCases.filter(c => !('requiresTools' in c) && (c.kind === 'both' || c.kind === (role.endsWith('first') ? 'first' : 'return')));
    const actual = rows.filter(r => r.role === role);
    const complete = actual.length === expected.length && expected.every(c => actual.filter(r => r.case === c.id).length === 1);
    return [role, { expected: expected.length, total: actual.length, passed: actual.filter(r => r.passed).length, complete }];
  }));
  const complete = rows.every(r => roles.includes(r.role)) && Object.values(perRole).every(r => r.complete);
  return { total: rows.length, passed: rows.filter(r => r.passed).length, complete, approved: complete && rows.every(r => r.passed), perRole, failures: rows.filter(r => !r.passed) };
}
