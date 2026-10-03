import type { ScriptLines } from '../script.ts';
import { esc, shell } from '../link/page.ts';
import type { Memory } from './context.ts';

export function memoryPage(memory: Memory, script: ScriptLines, note?: string): string {
  const say = (key: string): string => esc(script.get(key) ?? '');
  return shell(`<h1>${say('memory.title')}</h1><p class="now">${say('memory.detail')}</p>
    ${note ? `<p role="status">${say(note)}</p>` : ''}
    <form method="post">
      <input type="hidden" name="revision" value="${esc(memory.revision)}" />
      <label for="commitment">${say('memory.commitment')}</label>
      <textarea id="commitment" name="commitment" rows="3" maxlength="2000">${esc(memory.commitment)}</textarea>
      <label for="goals">${say('memory.goals')}</label>
      <textarea id="goals" name="goals" rows="5" maxlength="2000">${esc(memory.goals)}</textarea>
      <p class="hint">${say('memory.empty')}</p>
      <button class="primary" name="action" value="save">${say('memory.save')}</button>
    </form>
    <form method="post"><button name="action" value="done">${say('memory.done')}</button></form>`);
}
