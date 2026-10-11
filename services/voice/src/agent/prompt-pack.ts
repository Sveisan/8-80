import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import { loadScript } from '../script.ts';
import { buildInstructions, renderForConsole, CONSOLE_VARIABLES, type CallerProfile } from '../prompt.ts';

export type AgentRole = 'first' | 'return' | 'belief-onboarding' | 'belief-daily' | 'belief-weekly';
export type AgentGroup = 'weekly' | 'beliefs' | 'all';
export const agentKeys: Record<AgentRole, string> = {
  first: 'SPEECHIFY_FIRST_CALL_AGENT_ID', return: 'SPEECHIFY_AGENT_ID',
  'belief-onboarding': 'BELIEFS_ONBOARDING_AGENT_ID', 'belief-daily': 'BELIEFS_DAILY_AGENT_ID', 'belief-weekly': 'BELIEFS_WEEKLY_AGENT_ID',
};
export interface PromptSpec { role: AgentRole; name: string; prompt: string; variables: string[]; }

/** The same source and rendering used by `npm run prompt -- first console`. */
export function weeklyPrompt(first: boolean): string {
  const profile: CallerProfile = first ? {
    callNumber: 1, firstName: '{{first_name}}', bookedSlot: '{{booked_slot}}', onboardingProgress: '{{onboarding_progress}}',
    eight: '{{own_eight}}', eighty: '{{own_eighty}}', goals: '{{own_goals}}', lastCommitment: '{{last_commitment}}', nextSlot: '{{next_appointment}}',
  } : {
    callNumber: '{{call_number}}', firstName: '{{first_name}}', nextSlot: '{{next_appointment}}', lastCommitment: '{{last_commitment}}',
    callDay: '{{last_day}}', eight: '{{own_eight}}', eighty: '{{own_eighty}}', belief: '{{last_belief}}',
    consecutiveUndone: '{{weeks_undone_running}}', goals: '{{own_goals}}',
  };
  return renderForConsole(buildInstructions(loadScript(), profile), CONSOLE_VARIABLES);
}
export function promptPack(group: AgentGroup): PromptSpec[] {
  const pack: PromptSpec[] = [];
  if (group !== 'beliefs') for (const role of ['first', 'return'] as const) pack.push({
    role, name: `8&80 · ${role === 'first' ? 'First conversation' : 'Weekly conversation'}`, prompt: weeklyPrompt(role === 'first'), variables: [...CONSOLE_VARIABLES],
  });
  if (group !== 'weekly') for (const kind of ['onboarding', 'daily', 'weekly'] as const) pack.push({
    role: `belief-${kind}`, name: `8&80 Beliefs · ${kind}`,
    prompt: readFileSync(resolve(repoRoot, `docs/beliefs/${kind}-script.md`), 'utf8'),
    variables: ['belief_context', 'call_kind', 'session_id', 'session_token'],
  });
  for (const spec of pack) {
    const declared = new Set(spec.variables);
    for (const match of spec.prompt.matchAll(/\{\{([^}]+)\}\}/g)) if (!declared.has(match[1]!)) throw new Error('Prompt contains an undeclared dynamic variable.');
  }
  return pack;
}
