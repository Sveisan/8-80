import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import { loadScript } from '../script.ts';
import { buildInstructions, renderForConsole, CONSOLE_VARIABLES, type CallerProfile } from '../prompt.ts';

export type AgentRole = 'first' | 'return' | 'female-first' | 'female-return' | 'belief-onboarding' | 'belief-daily' | 'belief-weekly' | 'unblock-opening' | 'unblock-weekly' | 'unblock-light';
export type AgentGroup = 'weekly' | 'weekly-female' | 'beliefs' | 'unblock' | 'all';
export const agentKeys: Record<AgentRole, string> = {
  first: 'SPEECHIFY_FIRST_CALL_AGENT_ID', return: 'SPEECHIFY_AGENT_ID',
  'female-first': 'SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID', 'female-return': 'SPEECHIFY_FEMALE_AGENT_ID',
  'belief-onboarding': 'BELIEFS_ONBOARDING_AGENT_ID', 'belief-daily': 'BELIEFS_DAILY_AGENT_ID', 'belief-weekly': 'BELIEFS_WEEKLY_AGENT_ID',
  'unblock-opening': 'UNBLOCK_OPENING_AGENT_ID', 'unblock-weekly': 'UNBLOCK_WEEKLY_AGENT_ID', 'unblock-light': 'UNBLOCK_LIGHT_AGENT_ID',
};
/** Roles whose settings (memory, recording, AMD, callback, greeting) the sync fully manages. */
export const isManagedModuleRole = (role: AgentRole): boolean => role.startsWith('belief-') || role.startsWith('unblock-');
/** The custom webhook tool a module role must have attached before its ID may be routed. */
export const moduleToolName = (role: AgentRole): string | undefined => role.startsWith('belief-') ? 'capture_belief' : role.startsWith('unblock-') ? 'capture_unblock' : undefined;
export interface PromptSpec { role: AgentRole; name: string; prompt: string; variables: string[]; firstMessage?: string; endCallDescription?:string; }
export const WEEKLY_END_CALL_DESCRIPTION='End only after an explicit request to stop or say goodbye, or a completed mutual close. An isolated thanks, okay, mhm, silence, negative feedback or unanswered question is not permission. Speak the brief goodbye once, let its speech finish, then call this tool. Say nothing after the tool.';
export const WEEKLY_SKIP_TURN_DESCRIPTION='Stay silent for this turn when the caller is thinking, speaking in fragments, acknowledging an unanswered question or explicitly continuing. Call without any spoken preamble or follow-up. Never use this to ignore a completed answer or a request to stop.';
/** The platform owns this one opening. The prompt continues after its answer. */
export function weeklyGreeting(first = true):string {
  return loadScript().get(first ? 'open.first.greet' : 'open.return.greet')!
    .replace(/,? ?\{\{name\}\}/g,'').replace(/\s+/g,' ').trim();
}
export const BELIEF_GREETINGS = {
  onboarding: 'Hi, it’s 8&80 Beliefs. Is now still a good time to talk?',
  daily: 'Hi, it’s 8&80 Beliefs. Let’s take a moment for your decisions.',
  weekly: 'Hi, it’s 8&80 Beliefs. Is now still a good time to talk?',
} as const;
/** Fixed first messages; the scripts state the same lines. Keep them in sync with docs/unblock. */
export const UNBLOCK_GREETINGS = {
  opening: "Hi, it's your Unblock call from 8 and 80. Is now still a good time to talk?",
  weekly: "Hi, it's your Unblock call from 8 and 80. Is now still a good time?",
  light: "Hi, it's your Unblock call from 8 and 80 — just a quick one.",
} as const;
export const UNBLOCK_VARIABLES = ['unblock_context', 'call_kind', 'week', 'session_id', 'session_token'] as const;

/** The same source and rendering used by `npm run prompt -- first console`. */
export function weeklyPrompt(first: boolean): string {
  const profile: CallerProfile = first ? {
    callNumber: 1, firstName: '{{first_name}}', bookedSlot: '{{booked_slot}}', onboardingProgress: '{{onboarding_progress}}', weeklyContext: '{{weekly_context}}',
    eight: '{{own_eight}}', eighty: '{{own_eighty}}', goals: '{{own_goals}}', lastCommitment: '{{last_commitment}}', nextSlot: '{{next_appointment}}',
  } : {
    callNumber: '{{call_number}}', firstName: '{{first_name}}', nextSlot: '{{next_appointment}}', lastCommitment: '{{last_commitment}}', weeklyContext: '{{weekly_context}}',
    callDay: '{{last_day}}', eight: '{{own_eight}}', eighty: '{{own_eighty}}', belief: '{{last_belief}}',
    consecutiveUndone: '{{weeks_undone_running}}', goals: '{{own_goals}}',
  };
  return renderForConsole(buildInstructions(loadScript(), profile), CONSOLE_VARIABLES);
}
export function promptPack(group: AgentGroup, env: NodeJS.ProcessEnv = process.env): PromptSpec[] {
  const pack: PromptSpec[] = [];
  if (group !== 'beliefs' && group !== 'unblock' && group !== 'weekly-female') for (const role of ['first', 'return'] as const) pack.push({
    role, name: `8&80 · ${role === 'first' ? 'First conversation' : 'Weekly conversation'}`, prompt: weeklyPrompt(role === 'first'), variables: [...CONSOLE_VARIABLES], firstMessage:weeklyGreeting(role === 'first'),endCallDescription:WEEKLY_END_CALL_DESCRIPTION,
  });
  if (group === 'weekly-female' || (group !== 'beliefs' && group !== 'unblock' && ['SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID', 'SPEECHIFY_FEMALE_AGENT_ID', 'SPEECHIFY_FEMALE_VOICE_ID'].some(key => env[key]))) {
    for (const role of ['female-first', 'female-return'] as const) pack.push({ role, name: `8&80 · ${role === 'female-first' ? 'First' : 'Weekly'} conversation · Woman’s voice`, prompt: weeklyPrompt(role === 'female-first'), variables: [...CONSOLE_VARIABLES],firstMessage:weeklyGreeting(role === 'female-first'),endCallDescription:WEEKLY_END_CALL_DESCRIPTION });
  }
  if (group !== 'weekly' && group !== 'weekly-female' && group !== 'unblock') for (const kind of ['onboarding', 'daily', 'weekly'] as const) pack.push({
    role: `belief-${kind}`, name: `8&80 Beliefs · ${kind}`,
    prompt: readFileSync(resolve(repoRoot, `docs/beliefs/${kind}-script.md`), 'utf8'),
    variables: ['belief_context', 'call_kind', 'session_id', 'session_token'],
    firstMessage: BELIEF_GREETINGS[kind],
  });
  if (group === 'unblock' || group === 'all') for (const kind of ['opening', 'weekly', 'light'] as const) pack.push({
    role: `unblock-${kind}`, name: `8&80 Unblock · ${kind}`,
    prompt: readFileSync(resolve(repoRoot, `docs/unblock/${kind}-script.md`), 'utf8'),
    variables: [...UNBLOCK_VARIABLES],
    firstMessage: UNBLOCK_GREETINGS[kind],
  });
  for (const spec of pack) {
    const declared = new Set(spec.variables);
    for (const match of spec.prompt.matchAll(/\{\{([^}]+)\}\}/g)) if (!declared.has(match[1]!)) throw new Error('Prompt contains an undeclared dynamic variable.');
  }
  return pack;
}
