import { weeklyGreeting, weeklyPrompt } from './prompt-pack.ts';
import { loadScript } from '../script.ts';
import { renderForConsole, CONSOLE_VARIABLES } from '../prompt.ts';

export const WEEKLY_FLOW_POLICY = 'weekly-appointment-and-pacing-v4';
export const weeklyFlowRoles = ['first', 'return', 'female-first', 'female-return'] as const;
export type WeeklyFlowRole = typeof weeklyFlowRoles[number];
export interface WeeklyFlowNode {
  key: string;
  type: 'start' | 'say' | 'subagent' | 'end';
  config?: Record<string, unknown>;
}
export interface WeeklyFlow {
  nodes: WeeklyFlowNode[];
  edges: { from: string; to: string; type: 'default' | 'llm_condition'; condition?: string }[];
}

/** These phone flows deliberately have no turn-count forced exit. The provider
 * rejects cycles without a finite guard, so keep phase transitions acyclic;
 * ordinary conversation and later corrections stay inside their model phase. */
export function assertAcyclicWeeklyFlow(flow: WeeklyFlow): void {
  const nodes = new Set(flow.nodes.map(n => n.key));
  if (nodes.size !== flow.nodes.length) throw new Error('Weekly flow graph contains duplicate nodes.');
  const next = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error('Weekly flow graph references an unknown node.');
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  const active = new Set<string>(), complete = new Set<string>();
  const visit = (key: string): void => {
    if (active.has(key)) throw new Error('Weekly flow graph must be acyclic; no forced turn-count exit is configured.');
    if (complete.has(key)) return;
    active.add(key);
    for (const target of next.get(key) ?? []) visit(target);
    active.delete(key); complete.add(key);
  };
  for (const key of nodes) visit(key);
}

/** tools_filter takes attached binding IDs, not model-facing tool names.
 * Resolve privately at deployment; neither IDs nor credentials enter source. */
export function bindWeeklyFlow(flow: WeeklyFlow, tools: unknown): WeeklyFlow {
  assertAcyclicWeeklyFlow(flow);
  if (!Array.isArray(tools)) throw new Error('A complete tool catalog is required.');
  const ids = new Map<string, string>();
  for (const name of ['skip_turn', 'weekly_assist']) {
    const matches = tools.filter(t => t && typeof t === 'object' && t.name === name && t.enabled !== false
      && (name === 'skip_turn' ? t.kind === 'builtin' && t.config?.builtin === name : t.kind === 'webhook'));
    if (matches.length !== 1 || typeof matches[0].id !== 'string' || !/^(?:tool|builtin)_[a-zA-Z0-9_-]{1,120}$/.test(matches[0].id)) throw new Error('The private weekly tool bindings are not verified.');
    ids.set(name, matches[0].id);
  }
  if (new Set(ids.values()).size !== 2) throw new Error('The private weekly tool bindings are not distinct.');
  return {
    nodes: flow.nodes.map(n => n.type !== 'subagent' ? structuredClone(n) : {
      ...n, config: { ...n.config, tools_filter: (n.config?.tools_filter as string[]).map(name => {
        const id = ids.get(name); if (!id) throw new Error('Unexpected tool in weekly flow.'); return id;
      }) },
    }),
    edges: structuredClone(flow.edges),
  };
}

const stop = {
  name: 'caller_done',
  description: 'The latest completed caller contribution explicitly asks to stop, says goodbye, says now is not a good time, or accepts a mutual close. A yes directly answering our finish-choice question can accept that close even with an incomplete map or action. The caller asking whether we are finished is not itself agreement to end. An unanswered exercise question, silence, thanks, okay, criticism, a fragment or a declined perspective alone is NOT this condition. A later request to continue cancels earlier closing agreement.',
};
const actionAsked = {
  name: 'action_asked',
  description: 'The assistant has JUST spoken the COMPLETE fixed action read-back for the caller-chosen action, ending with Is that the action you want me to remember? It is the latest unanswered question. An older read-back, the focus question, a booking question or an already confirmed action does not qualify. This transition opens the answer phase; it does not imply agreement.',
};
const exit = (condition: string) => ({ type: 'llm_condition' as const, condition });

/** The provider owns the speech queue. Its say node owns the sole farewell;
 * end_call is unavailable in every model phase. Audio approval is still a
 * separate phone-test gate: validating a graph does not prove playout. */
export function weeklyFlow(role: WeeklyFlowRole): WeeklyFlow {
  const first = role.endsWith('first');
  const script = loadScript();
  const common = [
    `MANAGED WEEKLY FLOW ${WEEKLY_FLOW_POLICY}. These phase boundaries override the stage checklist and its old end_call instructions.`,
    'Before advancing past a question, require a NEW, completed caller answer after that question. Your own last question is not caller input. Never simulate a yes, speak for the caller, or treat a tool return or phase entry as that answer.',
    'When a question is pending and no new caller answer has arrived, call skip_turn without speech. An unfinished answer or a request for more thinking time also uses skip_turn without speech. Do not repeat the question or fill the gap.',
    'A completed answer needs a response, not skip_turn. After a flow-owned acknowledgement, continue without waiting for another okay. This exception never supplies a missing answer to a map or action read-back. If the caller explicitly says their answer is finished and asks you to carry on, continue now; do not manufacture another thinking pause.',
    'The flow, not this model, speaks the final farewell. Do not say goodbye, Take care, or another farewell and do not call end_call. When the caller_done condition is actually met, leave through that condition without spoken preamble or follow-up. The flow then speaks its one short farewell before its end node.',
    'A clear request to stop always takes priority over the introduction or action. A request to continue cancels a close. Ordinary safety rules remain in force; do not claim help was contacted.',
    'A question about whether we are finished needs a direct answer and room to choose, not the next exercise or an automatic hangup. Follow CALLER ASKS WHETHER WE ARE DONE. A short completed answer or an already chosen activity must not be re-asked in different words.',
    'A weekly call-time request takes priority wherever it arrives. Follow WEEKLY CALL TIME. A booking change is never an action or map agreement, and a yes to a clarification is not the answer to the interrupted read-back.',
    'Only the action_kept say node can speak the agreed-action marker. Never say it in a model phase. In conversation, after its complete read-back enter action_answer without extra speech. After the action_kept or action_declined marker, continue in post_action; do not restart the earlier exercise.',
    'If action_declined has spoken for the current choice, move to the brief mutual close without proposing another action. Only the caller can reopen that choice.',
  ].join('\n');
  const phase = (key: string, instructions: string, conditions = [stop]): WeeklyFlowNode => ({
    key, type: 'subagent', config: {
      system_prompt_override: renderForConsole(weeklyPrompt(first) + '\n\n' + common + '\n\n' + instructions, CONSOLE_VARIABLES),
      tools_filter: ['skip_turn', 'weekly_assist'],
      exit_conditions: conditions, max_turns: 0,
    },
  });
  const nodes: WeeklyFlowNode[] = [
    { key: 'start', type: 'start' },
    { key: 'greeting', type: 'say', config: { text: weeklyGreeting(first), allow_interruptions: true } },
  ];
  const edges: WeeklyFlow['edges'] = [
    { from: 'start', to: 'greeting', type: 'default' },
    { from: 'greeting', to: first ? 'introduction' : 'conversation', type: 'default' },
  ];
  if (first) {
    nodes.push(phase('introduction', [
      'CURRENT PHASE: introduction only. The greeting has already been spoken by the flow; wait for its answer. Follow the existing opening, disclosure, situation and perspective rules below.',
      'Stop this phase at the COMPLETE fixed map read-back and its final question. End that spoken turn at the question. Do not say the onboarding-confirmed line, choose an action, start logistics or claim the map is kept in this phase.',
      'After that complete read-back, leave through map_asked WITHOUT any extra speech. A separate phase will wait for the answer. A missing or declined perspective must remain missing; continue from the caller or honour a real close, never invent a map to leave this phase.',
    ].join('\n\n'), [stop, { name: 'map_asked', description: 'The assistant has just spoken the complete fixed first-call map, including eight, eighty and three-month goals actually supplied by this caller, ending with Have I got that right? No caller agreement is assumed. This transition only opens the waiting phase.' }]));
    nodes.push(phase('map_answer', [
      'CURRENT PHASE: wait for the answer to the most recent COMPLETE map read-back. You may not say the onboarding-confirmed line or move to actions or logistics here.',
      'On phase entry, a tool return, silence, thanks, mhm, a fragment or any other non-answer, call skip_turn WITHOUT speech. Do not treat a yes given BEFORE the read-back as its answer.',
      'Only a fresh, explicit caller agreement AFTER the full read-back (and after any correction) allows map_agreed. Leave through it WITHOUT speaking: a say node owns the kept-map marker.',
      'If the caller asks a service question or requests a time change, handle it first without marking the map agreed. If they resume the map, repeat the complete read-back and wait for a fresh answer. A yes to the service clarification cannot confirm the map.',
      'If the caller corrects a part, read back only that correction with the corresponding fixed line below, ending with Have I got that right? Then end your turn and wait for a NEW explicit agreement. A refusal or ambiguous reply is not agreement. Never edit a different part or guess missing words.',
      ...['read.first.fix_eight', 'read.first.fix_eighty', 'read.first.fix'].map(id => `${id}: ${script.get(id)}`),
      'If the caller explicitly withdraws or declines the map, use map_declined without claiming anything is kept. A clear goodbye instead uses caller_done.',
    ].join('\n\n'), [stop,
      { name: 'map_agreed', description: 'A NEW completed caller turn directly answering the latest full map read-back or required correction explicitly agrees with that read-back, without another question or change request. After any service question or booking diversion, a repeated complete read-back and a fresh agreement are required. A yes to a different question cannot confirm the map. No silence, acknowledgement, earlier yes, partial map or self-generated confirmation qualifies.' },
      { name: 'map_declined', description: 'The caller explicitly withdraws or declines the read-back rather than correcting a part. Do not mark the introduction complete.' },
    ]));
    nodes.push({ key: 'map_kept', type: 'say', config: { text: script.get('onboarding.confirmed')!, allow_interruptions: true } });
    nodes.push(phase('conversation', [
      'CURRENT PHASE: continue from the caller after the map check. The full conversation history is available. Only the map_kept say node can have confirmed the map; never say that marker yourself.',
      'Do not repeat the greeting, disclosure, location, completed perspectives or map. If a caller declined the map, leave onboarding unfinished and follow what they want to discuss without restarting it.',
      'If map_kept was spoken, that statement needs no acknowledgement. Continue on entry without skip_turn unless the caller is actually speaking, thinking, or a real question still needs an answer. First consider the latest caller contribution: answer a question about finishing, handle a service request or take an already chosen focus/action as answered. Only when still needed and wanted, offer the focus question once; use the common-focus alternative when both perspectives converge. Continue to an action only if wanted.',
      'Ask the complete fixed action-confirmation question, END the spoken turn at it and leave through action_asked WITHOUT extra speech. The separate action_answer phase waits for agreement. After the resulting marker, post_action owns logistics, any caller-led correction and the mutual close.',
    ].join('\n\n'), [stop, actionAsked]));
    edges.push(
      { from: 'introduction', to: 'map_answer', ...exit('map_asked') },
      { from: 'introduction', to: 'farewell', ...exit('caller_done') },
      { from: 'map_answer', to: 'map_kept', ...exit('map_agreed') },
      { from: 'map_answer', to: 'conversation', ...exit('map_declined') },
      { from: 'map_answer', to: 'farewell', ...exit('caller_done') },
      { from: 'map_kept', to: 'conversation', type: 'default' },
    );
  } else nodes.push(phase('conversation', [
    'CURRENT PHASE: returning conversation. The greeting has already been spoken; wait for its answer only if it is still unanswered. Follow the callback and caller-choice rules below.',
    'After the COMPLETE fixed action-confirmation question END the spoken turn and leave through action_asked WITHOUT extra speech. The separate action_answer phase waits for agreement. After the resulting marker, post_action owns logistics, any caller-led correction and the mutual close.',
  ].join('\n\n'), [stop, actionAsked]));
  nodes.push(phase('action_answer', [
    'CURRENT PHASE: wait for a NEW answer to the latest COMPLETE fixed action read-back. Do not say the agreed-action marker or begin closing logistics yourself.',
    'On entry, silence, a tool return, a fragment or an unfinished answer: call skip_turn without speech. Only a fresh explicit agreement directly to the complete action read-back allows action_agreed. A courtesy reply is not agreement; use the existing complete read-back repair, then wait.',
    `A request explicitly naming the weekly call is already clear, including "Yes, move my weekly call". Do not ask whether they mean the activity. Say ONLY the complete booking-control explanation: "${script.get('setup.change_slot')}" Then wait. Never speak the agreed-action marker for this request.`,
    'A time-change request or another question is a diversion, even when it begins with yes. Only when the referent is genuinely ambiguous, ask which thing the time refers to, then wait. A yes about the weekly call, a reminder, availability or any clarification cannot approve the action. Do not insert the new appointment into the action. After resolving the diversion, if they continue, repeat the COMPLETE fixed action read-back in its own turn and wait for a fresh explicit agreement.',
    `For an action correction, use the full fixed line again: ${script.get('next.confirm')} Then wait for a NEW explicit agreement. Never guess missing content or mark the earlier proposal agreed.`,
    'An explicit choice of no action uses action_declined without a spoken preamble; its say node owns the no-action line. A request to stop uses caller_done. A question about finishing follows CALLER ASKS WHETHER WE ARE DONE, without requiring an action.',
  ].join('\n\n'), [stop,
    { name: 'action_agreed', description: 'The latest completed caller turn explicitly approves the action in direct answer to the latest COMPLETE fixed action read-back. It contains no question, correction, qualification or time-change request. After any diversion, a repeated COMPLETE read-back and fresh explicit agreement are required. A leading yes to a service clarification, an earlier yes, silence, thanks, a fragment or a time alone never qualifies.' },
    { name: 'action_declined', description: 'The caller explicitly chooses not to pick or remember an action this week. This is not inferred from silence, shortness, a time-change request, a question about finishing or a correction.' },
  ]));
  nodes.push(
    { key: 'action_kept', type: 'say', config: { text: script.get('next.agreed')!, allow_interruptions: true } },
    { key: 'action_declined', type: 'say', config: { text: script.get('next.none')!, allow_interruptions: true } },
  );
  nodes.push(phase('post_action', [
    'CURRENT PHASE: after the action choice. The flow already spoke the agreed-action or no-action marker. Continue from that completed choice and the latest caller contribution. Do not repeat the greeting, map, focus or invitation to choose an action.',
    'The marker is a statement, not another question. Continue on entry with known appointment information at a natural close; do not wait for another acknowledgement or use skip_turn solely because the marker just played. Still leave room when the caller is actually thinking or continuing, and never assume agreement to a later revised action.',
    'Use only known logistics and leave room for questions, feedback or a request to keep talking. An acknowledgement, silence or a request to move the weekly call is not a mutual close. A clear goodbye uses caller_done; the flow alone speaks the farewell.',
    'If the caller reopens their choice, handle later corrections HERE, without returning to conversation or action_answer. Keep the current choice unless they actually change it. An earlier no-action choice does not prevent a new caller-chosen activity.',
    `Read a changed action back with the COMPLETE fixed question: ${script.get('next.confirm')} END the spoken turn there and wait for a NEW explicit answer, including after every correction or service diversion. With no new answer, call skip_turn without speech. Never use a yes to a booking clarification as approval, invent an activity or treat a courtesy reply as agreement.`,
    'Only after that fresh explicit approval may you briefly acknowledge the revised choice and continue. Do not repeat the flow-owned agreed-action marker or claim technical storage succeeded. The strict read-back-plus-caller-answer storage boundary applies to every revision; an acknowledgement alone saves nothing.',
    'A weekly booking change still follows WEEKLY CALL TIME, with the complete fixed call-page explanation and no invented success. A question about finishing still follows CALLER ASKS WHETHER WE ARE DONE. Neither requires an action before the caller can end.',
  ].join('\n\n')));
  edges.push(
    { from: 'conversation', to: 'action_answer', ...exit('action_asked') },
    { from: 'action_answer', to: 'action_kept', ...exit('action_agreed') },
    { from: 'action_answer', to: 'action_declined', ...exit('action_declined') },
    { from: 'action_answer', to: 'farewell', ...exit('caller_done') },
    { from: 'action_kept', to: 'post_action', type: 'default' },
    { from: 'action_declined', to: 'post_action', type: 'default' },
    { from: 'post_action', to: 'farewell', ...exit('caller_done') },
  );
  nodes.push(
    { key: 'farewell', type: 'say', config: { text: script.get('close.flow')!, allow_interruptions: false } },
    { key: 'end', type: 'end' },
  );
  edges.push(
    { from: 'conversation', to: 'farewell', ...exit('caller_done') },
    { from: 'farewell', to: 'end', type: 'default' },
  );
  const flow = { nodes, edges };
  assertAcyclicWeeklyFlow(flow);
  return flow;
}
