import type { ScriptLines } from '../script.ts';
import { esc, shell } from '../link/page.ts';

export function accessPage(script: ScriptLines, phone = '', note?: string, memory = false): string {
  const say = (key: string): string => esc(script.get(key) ?? '');
  return shell(`<h1>${say(memory ? 'memory.title' : 'access.title')}</h1><p class="now">${say(memory ? 'access.memory.detail' : 'access.detail')}</p>
    ${note ? `<p role="alert">${say(note)}</p>` : ''}
    <form method="post" action="/access">
      ${memory ? '<input type="hidden" name="intent" value="memory" />' : ''}
      <label for="phone">${say('signup.phone')}</label>
      <input id="phone" type="tel" name="phone" autocomplete="tel" required maxlength="32" value="${esc(phone)}" />
      <p class="hint">${say('access.phone.detail')}</p>
      <button class="primary">${say('access.send')}</button>
    </form><p class="hint">${say('access.help')} <a href="/privacy">${say('access.privacy')}</a></p>
    <a href="/">${say('access.home')}</a>`);
}

export function accessCodePage(script: ScriptLines, id: string, phone: string, note?: string, memory = false): string {
  const say = (key: string): string => esc(script.get(key) ?? '');
  return shell(`<h1>${say('access.code.title')}</h1><p class="now">${say('access.code.detail')}</p>
    ${note ? `<p role="alert">${say(note)}</p>` : ''}
    <form method="post" action="/access/verify">
      ${memory ? '<input type="hidden" name="intent" value="memory" />' : ''}
      <input type="hidden" name="id" value="${esc(id)}" />
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <label for="code">${say('signup.code.label')}</label>
      <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
      <p class="hint">${say('access.code.expires')}</p>
      <button class="primary">${say(memory ? 'access.memory.submit' : 'access.code.submit')}</button>
    </form>
    <form method="post" action="/access">
      ${memory ? '<input type="hidden" name="intent" value="memory" />' : ''}
      <input type="hidden" name="id" value="${esc(id)}" />
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <button>${say('access.resend')}</button>
    </form>
    <p class="hint">${say('access.resend.detail')}</p>
    <a href="/access${memory ? '?for=memory' : ''}">${say('access.change')}</a>`);
}
