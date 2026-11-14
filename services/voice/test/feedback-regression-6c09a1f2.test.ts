import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { FEEDBACK_WIDGET_SCRIPT } from '../src/product-feedback/widget.ts';

class Element {
  hidden = false;
  disabled = false;
  value = '';
  textContent = '';
  src = '';
  open = false;
  focused = false;
  files: { type: string; size: number }[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  addEventListener(name: string, listener: (event: { preventDefault(): void }) => void) { this.listeners.set(name, listener); }
  emit(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  replaceChildren() {}
}

function setup() {
  const elements = new Map<string, Element>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  const requests: { path: string; payload?: { comment: string; image?: { type: string; data: string } } }[] = [];
  const images: { onload(): void }[] = [];
  runInNewContext(FEEDBACK_WIDGET_SCRIPT, {
    document: {
      querySelector: () => ({ querySelector: element }),
      createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,cGl4ZWw=' }),
    },
    fetch: async (path: string, init?: { body?: string }) => {
      requests.push({ path, payload: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ csrf: 'synthetic-proof', reports: [] }) };
    },
    crypto: { randomUUID: () => 'synthetic-request' },
    location: { pathname: '/example' }, innerWidth: 420, innerHeight: 900,
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    Image: class {
      naturalWidth = 20;
      naturalHeight = 20;
      onload = () => {};
      constructor() { images.push(this); }
    },
  });
  return { element, requests, images };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('blank notes stay editable with a field error and never create a report', async () => {
  const { element, requests } = setup();
  element('.pf-trigger').emit('click');
  await settle();
  for (const value of ['', '   ', '\n\t \n', '\u00a0']) {
    element('textarea').value = value;
    element('form').emit('submit');
    assert.equal(requests.filter(r => r.payload).length, 0);
    assert.equal(element('dialog').open, true);
    assert.equal(element('textarea').value, value);
    assert.equal(element('textarea').focused, true);
    assert.equal(element('textarea').attributes.get('aria-invalid'), 'true');
    assert.equal(element('#pf-comment-error').hidden, false);
    assert.match(element('#pf-comment-error').textContent, /add a few words/i);
    assert.equal(element('.pf-send').disabled, false);
  }
  element('textarea').value = 'The text could be easier to scan.';
  element('textarea').emit('input');
  assert.equal(element('#pf-comment-error').hidden, true);
  assert.equal(element('textarea').attributes.has('aria-invalid'), false);
  element('form').emit('submit');
  await settle();
  assert.equal(requests.filter(r => r.payload).length, 1);
  assert.equal(requests.find(r => r.payload)?.payload?.comment, 'The text could be easier to scan.');
  assert.equal(element('textarea').value, '');
});

test('native required validation uses the field error and an attachment survives a rejected note', async () => {
  const { element, requests, images } = setup();
  element('.pf-trigger').emit('click');
  await settle();
  element('textarea').emit('invalid');
  assert.equal(element('#pf-comment-error').hidden, false);
  element('input[type=file]').files = [{ type: 'image/png', size: 120 }];
  element('input[type=file]').emit('change');
  images[0]!.onload();
  element('textarea').value = '\t  ';
  element('form').emit('submit');
  assert.equal(requests.filter(r => r.payload).length, 0);
  assert.equal(element('.pf-preview').hidden, false);
  element('textarea').value = 'A little more spacing would help.';
  element('textarea').emit('input');
  element('form').emit('submit');
  await settle();
  const report = requests.find(r => r.payload);
  assert.equal(report?.path, '/product-feedback/reports');
  assert.equal(report?.payload?.image?.type, 'image/jpeg');
  assert.equal(report?.payload?.image?.data, 'cGl4ZWw=');
  assert.equal(element('.pf-preview').hidden, true);
});
