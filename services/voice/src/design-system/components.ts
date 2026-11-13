import { busyLabel } from '../signup/mascot.ts';

const esc = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ButtonOptions {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  type?: 'submit' | 'button';
  disabled?: boolean;
  loading?: boolean;
}

export function button(label: string, options: ButtonOptions = {}): string {
  return `<button type="${options.type ?? 'submit'}" class="${options.variant ?? 'primary'}"${options.disabled || options.loading ? ' disabled' : ''}${options.loading ? ' aria-busy="true"' : ''}>${busyLabel(esc(label))}</button>`;
}

export interface FieldOptions {
  id: string; label: string; value?: string; hint?: string; error?: string;
  type?: 'text' | 'email' | 'tel' | 'textarea';
  autocomplete?: string; disabled?: boolean; required?: boolean;
}

export function field(options: FieldOptions): string {
  const id = esc(options.id);
  const described = [options.hint ? `${id}-hint` : '', options.error ? `${id}-error` : ''].filter(Boolean).join(' ');
  const attributes = `id="${id}" name="${id}"${described ? ` aria-describedby="${described}"` : ''}${options.error ? ' aria-invalid="true"' : ''}${options.disabled ? ' disabled' : ''}${options.required ? ' required' : ''}${options.autocomplete ? ` autocomplete="${esc(options.autocomplete)}"` : ''}`;
  const control = options.type === 'textarea'
    ? `<textarea ${attributes} rows="3">${esc(options.value ?? '')}</textarea>`
    : `<input ${attributes} type="${options.type ?? 'text'}" value="${esc(options.value ?? '')}">`;
  return `<div class="ds-field"><label for="${id}">${esc(options.label)}</label>${control}${options.hint ? `<p class="hint" id="${id}-hint">${esc(options.hint)}</p>` : ''}${options.error ? `<p class="wrong" id="${id}-error">${esc(options.error)}</p>` : ''}</div>`;
}

export function notice(message: string, kind: 'status' | 'alert' = 'status'): string {
  return `<p class="notice" role="${kind}">${esc(message)}</p>`;
}
