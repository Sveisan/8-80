import { createHash } from 'node:crypto';
import { weeklyFlow, weeklyFlowRoles } from '../agent/weekly-flow.ts';
import { loadScript } from '../script.ts';
import { weeklyFlowProbePlan } from './weekly-flow-probes.ts';

/** Fictional text/tool probes. The provider's entry-speech contract and graph
 * read-back are checked separately; these cannot measure audible phone gaps. */
export function weeklyPacingProbePlan(sourceCommit: string) {
  const script = loadScript();
  const quiet = weeklyFlowProbePlan(sourceCommit).probes;
  const focus = script.get('work.flow_entry')!;
  const offer = script.get('close.flow_offer')!;
  const chosen = 'Let me check: do something fun. Is that the action you want me to remember?';
  const corrected = 'Let me check: read a book. Is that the action you want me to remember?';
  const reply = (id: string, phase: string, context: string, expectedExact: string) => ({
    id, phase, expectedExact,
    definition: { name: '8&80 fictional pacing · ' + id, type: 'reply', config: {
      context, success_criteria: 'The entire spoken response is exactly this complete question, allowing only punctuation or capitalization differences: ' + expectedExact + ' Do not add another question, marker or explanation.',
    } },
  });
  const wait = (id: string, phase: string, context: string) => ({
    id, phase, definition: { name: '8&80 fictional pacing · ' + id, type: 'tool', config: { context, expected_tool: 'skip_turn' } },
  });
  const cases = [
    reply('volunteered_activity', 'conversation', `The opening and perspectives are complete. The flow has spoken: ${focus} Caller finishes: The last one. Do something fun. This is the whole completed contribution. They have chosen an activity, but have not approved its read-back. Respond now.`, chosen),
    reply('redundant_invitation_already_answered', 'conversation', 'The opening and perspectives are complete. Assistant asked which focus. Caller finished: The last one. Do something fun. Assistant mistakenly asked: What\'s one thing you\'d like to do towards that this week? No further caller answer followed. This is a runtime continuation. The activity was already supplied before the redundant ordinary invitation; do not make the caller repeat it. No action read-back has yet been asked or approved. Respond now using their existing activity.', chosen),
    wait('focus_thinking', 'conversation', `The conversation is ready for a weekly focus. Assistant just asked: ${focus} Caller says: Give me a moment, I am still thinking. They have not chosen a focus or activity.`),
    wait('post_entry_unanswered', 'post_action', `The caller explicitly confirmed a complete action read-back. The flow said I've got that, then its phase opening question: ${offer} No caller answer followed. This is a runtime continuation, not a new caller contribution.`),
    wait('post_entry_courtesy', 'post_action', `The action was explicitly confirmed. The flow said I've got that and then asked: ${offer} Caller says only: Okay, thank you. No yes, no, topic, goodbye or request to finish has followed.`),
    wait('post_entry_thinking', 'post_action', `The action was explicitly confirmed. The flow said I've got that and then asked: ${offer} Caller says: I am thinking, give me a moment. They have not agreed to end.`),
    reply('post_action_correction', 'post_action', `The caller explicitly confirmed visiting the library and the flow spoke its action marker and ${offer} Caller now finishes: I want to change my earlier choice. Read a book. That is my action for the week. They have not approved the revised read-back. Respond now.`, corrected),
    {
      id: 'post_action_more_conversation', phase: 'post_action', forbidden: 'action|remember|eight|eighty|focus|goodbye|take care',
      definition: { name: '8&80 fictional pacing · post_action_more_conversation', type: 'reply', config: {
        context: `The caller explicitly confirmed visiting the library. The flow spoke its action marker and ${offer} Caller finishes: Yes. I want to talk about the workshop yesterday. I liked meeting the people there. Ask me another question about that.`,
        success_criteria: 'Ask one relevant new question about meeting people at the workshop. Do not repeat any action, focus or perspective question, ask whether they want to finish, give a farewell or claim a new agreement.',
      } },
    },
  ];
  const probes = [...quiet, ...weeklyFlowRoles.flatMap(role => {
    const graph = weeklyFlow(role);
    return cases.map(({ id, ...item }) => ({ ...item, role, case: id,
      prompt: String(graph.nodes.find(n => n.key === item.phase)!.config!.system_prompt_override),
    }));
  })];
  const flows = weeklyFlowRoles.map(role => ({ role, flow: weeklyFlow(role) }));
  return { version: 1, sourceCommit, graphHash: createHash('sha256').update(JSON.stringify(flows)).digest('hex'), probes,
    phaseExitsTested: false, audioTested: false, voiceApproved: false };
}
