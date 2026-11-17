import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions } from '../src/prompt.ts';
import { loadScript } from '../src/script.ts';
import { variablesFor } from '../src/loop/tick.ts';
import { weeklyFlow, weeklyFlowRoles } from '../src/agent/weekly-flow.ts';

const next = 'Monday 23 November at 10:00 CET';
const usual = 'Friday at 16:30';

test('actual outbound variables reach every first and returning model phase as distinct booking facts', () => {
  const variables = variablesFor({ callNumber: 1, nextSlot: next, bookedSlot: usual });
  for (const role of weeklyFlowRoles) {
    for (const node of weeklyFlow(role).nodes.filter(n => n.type === 'subagent')) {
      const prompt = String(node.config?.system_prompt_override).replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '');
      assert.ok(prompt.includes(`NEXT APPOINTMENT (one dated call): ${next}.`), role + '/' + node.key);
      assert.ok(prompt.includes(`RECURRING WEEKLY TIME (the usual weekly slot): ${usual}.`), role + '/' + node.key);
      assert.ok(prompt.includes('A question about a booking is read-only'));
    }
  }
});

test('missing either booking fact preserves the other without deriving a recurring slot or next date', () => {
  for (const callNumber of [1, 3]) {
    for (const [nextSlot, bookedSlot] of [[next, undefined], [undefined, usual], [undefined, undefined]]) {
      const prompt = buildInstructions(loadScript(), { callNumber, nextSlot, bookedSlot });
      assert.ok(prompt.includes(`NEXT APPOINTMENT (one dated call): ${nextSlot ?? '(nothing recorded)'}.`));
      assert.ok(prompt.includes(`RECURRING WEEKLY TIME (the usual weekly slot): ${bookedSlot ?? '(nothing recorded)'}.`));
      assert.ok(prompt.includes('Never substitute one value for the other'));
    }
  }
});
