import type { ScriptLines } from '../script.ts';
import { normalise } from '../turn/endpointer.ts';
import { readBackSpan } from './readback.ts';

// Calls already in progress can finish with the previous wording. Keep these
// read-only anchors so a copy release does not discard their actual outcome.
const previous: Record<string, readonly string[]> = {
  'read.first.keep': ['Let me say it back. At eight, {{eight}}. By eighty, {{eighty}}. And in the next three months, {{goals}}. Have I got that right?'],
  'read.first.fix_eight': ['So at eight: {{eight}}. Have I got that right?'],
  'read.first.fix_eighty': ['So by eighty: {{eighty}}. Have I got that right?'],
  'read.first.fix': ['So the next three months: {{goals}}. Got it.'],
  'onboarding.confirmed': ["That's the map I'll keep for next time."],
  'next.confirm': ["Let me check: {{commitment}}. Is that the action you want me to remember for next week?", "Right — {{commitment}}. I'll ask how it went next time we talk."],
  'next.none': ['We can leave it there this week.'],
  'last.did': ['Right. How was it — worth doing, or did it just get done?'],
  'last.partial': ["So some of it. Which part didn't survive the week?"],
  'nothing.pattern': ['Third week running — is the goal wrong, or is something else going on?'],
  'setup.change_slot': ["I can't change your call time during this call. You can choose the new time on your call page. Your booking stays unchanged until you save it there.", "Your usual time stays the same for now. You can change it on your call page.", "I can't move it from the call yet, so it stays as it is for now. Sorry about that."],
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
  let selectedComplete = false;
  for (const template of weeklyLineTemplates(script, id)) {
    let found = readBackSpan(agentTurns, template, opts);
    // The old "Right —" action must start a read-back turn. A map ending
    // "Have I got that right?" followed by a later next-call promise is not
    // an action spanning the entire intervening conversation.
    if (found && id === 'next.confirm' && /^right\b/.test(normalise(template))
      && !/^right\b/.test(normalise(agentTurns[found.start] ?? ''))) {
      // A later "you're right ... I'll ask how it went" is an apology,
      // not a new proposal. Preserve the latest complete anchored turn.
      const index = agentTurns.findLastIndex(text => /^right\b/.test(normalise(text)) && !!readBackSpan([text], template, opts));
      if (index < 0) continue;
      const direct = readBackSpan([agentTurns[index]!], template, opts)!;
      found = { values: direct.values, start: index, end: index };
    }
    if (found) {
      // On a wording upgrade, a new template with an optional missing ending
      // can swallow the old complete ending into its final slot. Prefer the
      // complete current/legacy anchor when both finish at the same turn.
      const complete = !!readBackSpan(agentTurns.slice(found.start, found.end + 1), template, { strict: true });
      if (!selected || found.end > selected.end || found.end === selected.end && complete && !selectedComplete) {
        selected = { ...found, template }; selectedComplete = complete;
      }
    }
  }
  return selected;
}
