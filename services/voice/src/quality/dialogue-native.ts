import { dialogueCases } from './dialogue-cases.ts';

export const dialogueRoles = ['first', 'return', 'female-first', 'female-return'] as const;
export type DialogueRole = typeof dialogueRoles[number];
type Scenario = typeof dialogueCases[number];
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

export function isNativeErrorReply(text: string): boolean {
  const normalized = text.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
  return /sorry[, ]+something went wrong(?: on my end)?(?: and I (?:couldn't|could not) finish that reply)?[.!]?\s*please try again[.!]?/i.test(normalized);
}

export function dialogueScenario(role: string, id: string): Scenario {
  const scenario = dialogueCases.find(c => c.id === id);
  if (!dialogueRoles.includes(role as DialogueRole) || !scenario || 'requiresTools' in scenario
    || scenario.kind !== 'both' && scenario.kind !== (role.endsWith('first') ? 'first' : 'return')) {
    throw new Error('Unknown dialogue scenario or role.');
  }
  return scenario;
}

/** Speechify reply and tool tests have different config/result contracts.
 * A tool test establishes selection intent, never audible silence or playout. */
export function nativeDialogueDefinition(role: string, id: string) {
  const scenario = dialogueScenario(role, id);
  return {
    name: `8&80 fictional dialogue · ${id}`,
    description: 'Synthetic regression only. No customer data or phone call.',
    ...('expectedTool' in scenario ? {
      type: 'tool' as const,
      config: { context: scenario.context, expected_tool: scenario.expectedTool },
    } : {
      type: 'reply' as const,
      config: {
        context: scenario.context, success_criteria: scenario.criteria,
        success_examples: 'successExamples' in scenario ? scenario.successExamples : [],
        failure_examples: 'failureExamples' in scenario ? scenario.failureExamples : [],
      },
    }),
  };
}

/** Preserve absent speech as unknown. Never manufacture an empty successful
 * reply from a tool-only result, null, an error or a missing result object.
 * Replies remain private inputs for hard checks; do not print this record. */
export function normalizeNativeDialogueRun(role: string, id: string, input: unknown) {
  const scenario = dialogueScenario(role, id);
  const run = object(input), result = object(run['result']);
  const expectedType = 'expectedTool' in scenario ? 'tool' : 'reply';
  const reply = object(result['reply']), tool = object(result['tool_call']);
  const status = ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(String(run['status'])) ? String(run['status']) : 'invalid';
  const verdict = ['passed', 'failed'].includes(String(run['verdict'])) ? String(run['verdict']) : null;
  // Preserve any exposed speech even on a mixed/invalid tool result, so the
  // hard gate can reject it instead of manufacturing silence.
  const response = typeof reply['agent_response'] === 'string' ? reply['agent_response'] : undefined;
  const called = ['skip_turn', 'end_call'].includes(String(tool['tool_called'])) ? String(tool['tool_called']) : null;
  const variantPassed = expectedType === 'tool'
    ? tool['passed'] === true && tool['tool_matched'] === true && 'expectedTool' in scenario && called === scenario.expectedTool && response === undefined
    : reply['passed'] === true && response !== undefined && response.trim().length > 0 && !isNativeErrorReply(response);
  const hasError = run['error'] !== undefined && run['error'] !== null && run['error'] !== '';
  return {
    role: role as DialogueRole, case: scenario.id, testType: expectedType, status, verdict,
    passed: !hasError && status === 'completed' && verdict === 'passed' && result['passed'] === true
      && result['test_type'] === expectedType && variantPassed,
    reply: response,
    toolCalled: expectedType === 'tool' ? called : null,
    spokenEvidence: response !== undefined ? 'reply_text' as const : 'not_exposed' as const,
    audibleBehavior: 'requires_voice_verification' as const,
  };
}
