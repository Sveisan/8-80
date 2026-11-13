import { loadScript } from '../script.ts';
import { weeklyReadBackSpan } from '../call/weekly-lines.ts';
import { dialogueCases } from './dialogue-cases.ts';
import { dialogueScenario, isNativeErrorReply } from './dialogue-native.ts';

const quiet = new Set(['acknowledgement', 'caller_continues', 'thinking_fragments', 'thinking_after_patience', 'quiet_after_sound_feedback', 'unclear_fragment_wait', 'returned_goodbye', 'after_end_tool']);
const map = new Set(['complete_short_reply', 'full_map_before_confirmation', 'partial_map_repair']);
const normalized = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Additional hard gates for fictional provider replies. An LLM judge cannot
 * override silence, the fixed map contract or a missing/errored response. This
 * checks generated text only, not whether a voice runtime plays it correctly. */
export function dialogueReplyFailures(id: string, reply: unknown): string[] {
  if (typeof reply !== 'string') return ['missing_reply'];
  if (isNativeErrorReply(reply)) return ['provider_error_fallback'];
  if (quiet.has(id)) return reply.trim() ? ['speech_in_quiet_turn'] : [];
  if (!reply.trim()) return ['empty_reply'];
  const failures: string[] = [];
  if (/nothing recorded|\{\{(?:own_|first_|last_|next_|booked_)/i.test(reply)) failures.push('internal_missing_data_spoken');
  if (['confirmed_action_no_appointment','early_goodbye_no_appointment'].includes(id)
    && /(?:ask|speak|talk|call|see you).{0,45}(?:next time|next week)|(?:next time|next week).{0,45}(?:ask|speak|talk|call)/i.test(reply)) failures.push('unsupported_future_followup');
  if (id === 'action_courtesy' && /I(?:'|’)ve got that|I have got that|I(?:'|’)ll ask how it went|I will ask how it went/i.test(reply)) failures.push('unconfirmed_action_claim');
  if (id === 'caller_reopens_close') {
    if (/\?|\btell me\b|\bgo on\b|\bgo ahead\b|\b(?:goodbye|bye|take care|next time|end_call)\b/i.test(reply)) failures.push('caller_floor_or_reopened_close_ignored');
  }
  if (['reopened_close_question','reopened_close_question_return'].includes(id)) {
    if (/^of course[.!]?$/i.test(reply.trim())) failures.push('reopened_question_not_answered');
    if (/\?|\b(?:goodbye|bye|take care|end_call)\b/i.test(reply)) failures.push('reopened_question_replaced_or_closed');
  }
  if (id === 'clarification_twice') {
    if (/what (?:would move|is one thing|could move)|sorry.*(?:go ahead|continue)|phone the sailing school|call the sailing school/i.test(reply)) failures.push('clarification_repeated_or_action_invented');
    if ((reply.match(/\?/g) ?? []).length > 1) failures.push('stacked_clarification_questions');
  }
  if (id === 'feedback_resumed') {
    if (/^phone the sailing school[.!]?$/i.test(reply.trim())) failures.push('chosen_action_sounds_like_instruction');
    if (/I(?:'|’)ll ask how it went|I will ask how it went|keep that for next time/i.test(reply)) failures.push('unconfirmed_action_or_map_claim');
  }
  if (map.has(id)) {
    const readback = weeklyReadBackSpan([reply], loadScript(), 'read.first.keep');
    if (!readback || normalized(readback.values['eight'] ?? '') !== 'playing games'
      || normalized(readback.values['eighty'] ?? '') !== 'time with family'
      || normalized(readback.values['goals'] ?? '') !== 'learn to sail') failures.push('incomplete_or_changed_map');
    if (/keep that for next time|focus on this week/i.test(reply)) failures.push('map_agreement_skipped');
  }
  if (['complete_short_reply', 'agreed_action_okay'].includes(id) && /sorry|go ahead|go on|please continue/i.test(reply)) failures.push('false_interruption_repair');
  if (['spontaneous_update','situation_known'].includes(id) && /what (?:did|has).*chang|how did (?:it|that|the proposal) go|what happened/i.test(reply)) failures.push('completed_result_asked_again');
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

/** Require the full matrix and hard wording/selection checks. Tool-only native
 * results establish intent, not audible silence: a separate voice gate remains.
 * Output contains no dialogue, identity or provider rationale. */
export function dialogueBatchReport(input: unknown) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Expected a bounded dialogue result array.');
  const roles = ['first', 'return', 'female-first', 'female-return'];
  const rows = input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid dialogue result.');
    const row = item as Record<string, unknown>;
    const role = String(row['role']), id = String(row['case']);
    const scenario = dialogueScenario(role, id);
    const toolCase = 'expectedTool' in scenario;
    const toolOnly = toolCase && row['testType'] === 'tool';
    const failures = toolOnly ? [] : dialogueReplyFailures(id, row['reply']);
    if (toolCase) {
      if (row['testType'] !== 'tool') failures.push('wrong_native_test_type');
      if (row['toolCalled'] !== scenario.expectedTool) failures.push('expected_tool_not_observed');
      // A tool-result variant does not expose spoken text. Do not silently
      // accept a contradictory reply supplied alongside that variant.
      if (toolOnly && row['reply'] !== undefined) failures.push('ambiguous_spoken_evidence');
    } else {
      if (row['testType'] !== undefined && row['testType'] !== 'reply') failures.push('wrong_native_test_type');
      if (row['toolCalled'] !== undefined && row['toolCalled'] !== null) failures.push('unexpected_tool_in_reply');
    }
    const providerPassed = row['status'] === 'completed' && row['verdict'] === 'passed' && row['passed'] === true;
    return { role, case: id, evidence:toolCase?'tool_intent_only':'wording', providerPassed, failures, passed: providerPassed && failures.length === 0 };
  });
  const perRole = Object.fromEntries(roles.map(role => {
    const expected = dialogueCases.filter(c => !('requiresTools' in c) && (c.kind === 'both' || c.kind === (role.endsWith('first') ? 'first' : 'return')));
    const actual = rows.filter(r => r.role === role);
    const complete = actual.length === expected.length && expected.every(c => actual.filter(r => r.case === c.id).length === 1);
    return [role, { expected: expected.length, total: actual.length, passed: actual.filter(r => r.passed).length, complete }];
  }));
  const complete = rows.every(r => roles.includes(r.role)) && Object.values(perRole).every(r => r.complete);
  const count = (evidence:string) => ({total:rows.filter(r=>r.evidence===evidence).length,passed:rows.filter(r=>r.evidence===evidence&&r.passed).length});
  return {
    version:2,total:rows.length,passed:rows.filter(r=>r.passed).length,complete,
    checks:{wording:count('wording'),toolIntent:count('tool_intent_only')},
    approvedForPhonePilot:complete&&rows.every(r=>r.passed),
    // This report has no voice observations. Never promote a release on the
    // basis of an absent tool-test reply or a successful function selection.
    approved:false,voiceVerification:'required',
    quietTurnVoiceChecks:rows.filter(r=>r.evidence==='tool_intent_only').map(r=>({role:r.role,case:r.case})),
    perRole,failures:rows.filter(r=>!r.passed),
  };
}
