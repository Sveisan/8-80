import type { ScriptLines } from '../script.ts';
import { esc, shell } from '../link/page.ts';

export function accessPage(script: ScriptLines, phone = '+47 ', note?: string, memory = false, quality = false): string {
  const say = (key: string): string => esc(script.get(key) ?? '');
  const intent = memory ? 'memory' : quality ? 'call-quality' : '';
  return shell(`<h1>${quality ? 'Sign in to Call quality' : say(memory ? 'memory.title' : 'access.title')}</h1><p class="now">${quality ? 'Use the phone number registered for owner access.' : say(memory ? 'access.memory.detail' : 'access.detail')}</p>
    ${note ? `<p role="alert" id="access-error">${say(note)}</p>` : ''}
    <form method="post" action="/access">
      ${intent ? `<input type="hidden" name="intent" value="${intent}" />` : ''}
      <label for="phone">${say('signup.phone')}</label>
      <input id="phone" type="tel" name="phone" autocomplete="tel" inputmode="tel" required maxlength="32" value="${esc(phone)}"${note ? ' aria-describedby="access-error"' : ''}${note === 'signup.error.number' ? ' aria-invalid="true"' : ''} />
      <button class="primary">${say('access.send')}</button>
    </form><p class="hint">${say('access.help')} <a href="/privacy">${say('access.privacy')}</a></p>
    <a href="/">${say('access.home')}</a>`);
}

export function accessCodePage(script: ScriptLines, id: string, phone: string, note?: string, memory = false, quality = false): string {
  const say = (key: string): string => esc(script.get(key) ?? '');
  const intent = memory ? 'memory' : quality ? 'call-quality' : '';
  return shell(`<h1>${say('access.code.title')}</h1><p class="now">${say('access.code.detail')}</p>
    ${note ? `<p role="alert" id="access-error">${say(note)}</p>` : ''}
    <form method="post" action="/access/verify">
      ${intent ? `<input type="hidden" name="intent" value="${intent}" />` : ''}
      <input type="hidden" name="id" value="${esc(id)}" />
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <label for="code">${say('signup.code.label')}</label>
      <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="code"${note ? ' aria-describedby="access-error"' : ''}${note === 'access.code.wrong' ? ' aria-invalid="true"' : ''} />
      <p class="hint">${say('access.code.expires')}</p>
      <button class="primary">${say(memory ? 'access.memory.submit' : 'access.code.submit')}</button>
    </form>
    <form method="post" action="/access">
      ${intent ? `<input type="hidden" name="intent" value="${intent}" />` : ''}
      <input type="hidden" name="id" value="${esc(id)}" />
      <input type="hidden" name="phone" value="${esc(phone)}" />
      <button>${say('access.resend')}</button>
    </form>
    <p class="hint">${say('access.resend.detail')}</p>
    <a href="/access${intent ? `?for=${intent}` : ''}">${say('access.change')}</a>`);
}
