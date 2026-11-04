import type { ScriptLines } from '../script.ts';
import { normalise } from '../turn/endpointer.ts';
import { readBackSpan } from './readback.ts';

// Calls already in progress can finish with the previous wording. Keep these
// read-only anchors so a copy release does not discard their actual outcome.
const previous: Record<string, readonly string[]> = {
  'read.first.keep': ['Let me say it back. At eight, {{eight}}. By eighty, {{eighty}}. And in the next three months, {{goals}}. Have I got that right?'],
  'read.first.fix_eight': ['So at eight: {{eight}}. Have I got that right?'],
  'read.first.fix_eighty': ['So by eighty: {{eighty}}. Have I got that right?'],
  'onboarding.confirmed': ["That's the map I'll keep for next time."],
  'next.confirm': ["Let me check: {{commitment}}. Is that the action you want me to remember for next week?", "Right — {{commitment}}. I'll ask how it went next time we talk."],
  'next.none': ['We can leave it there this week.'],
  'last.did': ['Right. How was it — worth doing, or did it just get done?'],
  'last.partial': ["So some of it. Which part didn't survive the week?"],
  'nothing.pattern': ['Third week running — is the goal wrong, or is something else going on?'],
  'setup.change_slot': ["I can't move it from the call yet, so it stays as it is for now. Sorry about that."],
  'reschedule.confirm': ["Fine. I'll ring you back at {{time}} {{when}}."],
};

export function weeklyLineTemplates(script: ScriptLines, id: string): string[] {
  return [...new Set([script.get(id), ...(previous[id] ?? [])].filter((line): line is string => !!line))];
}

export function containsWeeklyLine(text: string, script: ScriptLines, id: string): boolean {
  const spoken = ` ${normalise(text)} `;
  return weeklyLineTemplates(script, id).some(line => spoken.includes(` ${normalise(line)} `));
}

/** Select the latest complete read-back, keeping the same strict boundaries. */
export function weeklyReadBackSpan(agentTurns: readonly string[], script: ScriptLines, id: string, opts: { strict?: boolean } = {}) {
  let selected: (NonNullable<ReturnType<typeof readBackSpan>> & { template: string }) | undefined;
  for (const template of weeklyLineTemplates(script, id)) {
    const found = readBackSpan(agentTurns, template, opts);
    // The old "Right —" action must start a read-back turn. A map ending
    // "Have I got that right?" followed by a later next-call promise is not
    // an action spanning the entire intervening conversation.
    if (found && id === 'next.confirm' && /^right\b/.test(normalise(template))
      && !/^right\b/.test(normalise(agentTurns[found.start] ?? ''))) continue;
    if (found && (!selected || found.end > selected.end)) selected = { ...found, template };
  }
  return selected;
}
