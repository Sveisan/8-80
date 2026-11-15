import { weeklyFlow } from '../agent/weekly-flow.ts';
import { loadScript } from '../script.ts';
import { weeklyPacingProbePlan } from './weekly-pacing-probes.ts';

/** Extend the pacing regression with completed and unfinished map corrections.
 * These prompt probes do not themselves exercise provider phase exits. */
export function weeklyMapCorrectionProbePlan(sourceCommit: string) {
  const base = weeklyPacingProbePlan(sourceCommit),script = loadScript();
  const map = "Let me say it back. Your eight-year-old self would love playing games. By eighty, you'd like time outdoors. And in the next three months, learn to sail. Have I got that right?";
  const context = 'Caller earlier said Yeah to availability. Later the assistant completed this map: ' + map + ' The earlier Yeah preceded the map and cannot approve it. ';
  const fix = (id: string, field: string, value: string) => script.get(id)!.replace('{{' + field + '}}', value);
  const corrections = [
    { id: 'map_unfinished_restatement', tail: 'Caller starts Statue building... and pauses, still finishing the correction. No fresh affirmation or completed correction has arrived.', wait: true },
    { id: 'map_completed_ambiguous_phrase', tail: 'Caller now finishes: Statue building. The phrase alone does not identify whether they are clarifying eighty or the next three months. It is not an affirmation.', expected: script.get('read.first.which_part')! },
    { id: 'map_correct_eight', tail: 'Caller now finishes: Change the eight-year-old part to drawing. They have not approved a corrected read-back.', expected: fix('read.first.fix_eight', 'eight', 'drawing') },
    { id: 'map_correct_eighty', tail: 'Caller now finishes: By eighty I mean building a sculpture. They have not approved a corrected read-back.', expected: fix('read.first.fix_eighty', 'eighty', 'building a sculpture') },
    { id: 'map_correct_goals', tail: 'Caller now finishes: Change the next-three-month goal to finish a drawing. They have not approved a corrected read-back.', expected: fix('read.first.fix', 'goals', 'finish a drawing') },
    { id: 'map_yes_with_correction', tail: 'Caller now finishes: Yes, but by eighty I mean building a sculpture. This is a correction, not agreement to its unread wording.', expected: fix('read.first.fix_eighty', 'eighty', 'building a sculpture') },
    { id: 'map_second_correction', tail: 'Caller changed eighty to building a sculpture. Assistant asked: So by eighty, you\'d like building a sculpture. Have I got that right? Caller now finishes: No, painting a portrait. They have not approved this latest correction.', expected: fix('read.first.fix_eighty', 'eighty', 'painting a portrait') },
    { id: 'map_identified_part', tail: 'Caller said Statue building. Assistant asked Which part would you like to change? Caller now finishes: The eighty-year-old part. They have identified the part, not approved its correction.', expected: fix('read.first.fix_eighty', 'eighty', 'Statue building') },
  ];
  const extra = (['first', 'female-first'] as const).flatMap(role => corrections.map(c => ({
    role, case: c.id, phase: 'map_answer',
    prompt: String(weeklyFlow(role).nodes.find(n => n.key === 'map_answer')!.config!.system_prompt_override),
    ...('expected' in c ? { expectedExact: c.expected } : {}),
    definition: c.wait ? { name: '8&80 fictional map correction · ' + c.id, type: 'tool', config: { context: context + c.tail, expected_tool: 'skip_turn' } }
      : { name: '8&80 fictional map correction · ' + c.id, type: 'reply', config: { context: context + c.tail,
        success_criteria: 'The entire spoken reply is exactly this complete question, allowing punctuation/capitalization differences only: ' + c.expected + ' No kept-map marker, weekly action question, second question or other speech.' } },
  })));
  return { ...base, probes: [...base.probes, ...extra] };
}
