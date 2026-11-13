import { weeklyFlow, weeklyFlowRoles } from '../agent/weekly-flow.ts';

const map = "Let me say it back. Your eight-year-old self would love playing games. By eighty, you'd like time with family. And in the next three months, learn to sail. Have I got that right?";
const mapCases = [
  { id: 'no_answer', context: `The introduction phase just ended by reading this complete map: ${map} No caller turn has arrived after it. This is entry to the map_answer phase, not a new caller answer.` },
  { id: 'earlier_yes', context: `Caller said Yes to the earlier availability question. Much later the introduction phase read: ${map} No caller answer followed. The earlier yes cannot confirm this new question.` },
  { id: 'unfinished_answer', context: `The introduction phase read: ${map} Caller starts answering: Um, I... and has not completed the thought.` },
  { id: 'correction_unanswered', context: `A complete map was read back. Caller corrected the eighty perspective to time outdoors. Assistant then read the fixed correction: So by eighty, you'd like time outdoors. Have I got that right? No caller answer has followed that correction.` },
];
const actionCases = [
  { id: 'action_unanswered', context: 'The caller chose phone the sailing school. Assistant just asked the complete fixed read-back: Let me check: phone the sailing school. Is that the action you want me to remember? No new caller turn followed. A runtime continuation is not an answer.' },
  { id: 'action_fragment', context: 'The caller chose phone the sailing school. Assistant read the full action-confirmation question. Caller starts: Um, I... and pauses mid-answer. There is no explicit yes or correction yet.' },
];

/** These probes test quiet tool intent with synthetic input, not phase exits,
 * audio playout or actual microphone capture. Keep those gates separate. */
export function weeklyFlowProbePlan(sourceCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A complete source revision is required.');
  const probes = weeklyFlowRoles.flatMap(role => {
    const graph = weeklyFlow(role);
    return [
      ...(role.endsWith('first') ? mapCases.map(c => ({ ...c, phase: 'map_answer' })) : []),
      ...actionCases.map(c => ({ ...c, phase: 'conversation' })),
    ].map(c => ({
      role, case: c.id, phase: c.phase,
      prompt: String(graph.nodes.find(n => n.key === c.phase)!.config!.system_prompt_override),
      definition: { name: '8&80 synthetic flow pause · ' + c.id, type: 'tool', config: { context: c.context, expected_tool: 'skip_turn' } },
    }));
  });
  return { version: 1, sourceCommit, probes, evidence: 'quiet_tool_intent_only', phaseExitsTested: false, voiceApproved: false };
}
