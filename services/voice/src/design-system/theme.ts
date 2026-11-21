import { createHash } from 'node:crypto';
import { themes } from './tokens.ts';

const storageKey = '8and80-theme';
const paint = `function apply(theme) {
  root.dataset.theme = theme;
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = theme === 'dark' ? '${themes.dark.bg}' : '${themes.light.bg}';
}`;

const init = `(function () {
  var root = document.documentElement;
  ${paint}
  try {
    var saved = localStorage.getItem('${storageKey}');
    if (!root.hasAttribute('data-preview-theme') && (saved === 'light' || saved === 'dark')) root.dataset.theme = saved;
  } catch (e) {}
  apply(root.dataset.theme);
})();`;

const control = `(function () {
  var root = document.documentElement;
  var button = document.querySelector('.site-theme-toggle');
  ${paint}
  function label() { button.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; }
  function restore() {
    try {
      var saved = localStorage.getItem('${storageKey}');
      if (saved === 'dark' || saved === 'light') apply(saved);
    } catch (e) {}
    label();
  }
  button.addEventListener('click', function () {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark');
    if (!root.hasAttribute('data-preview-theme')) {
      try { localStorage.setItem('${storageKey}', root.dataset.theme); } catch (e) {}
    }
    label();
  });
  if (!root.hasAttribute('data-preview-theme')) {
    window.addEventListener('pageshow', restore);
    window.addEventListener('storage', function (event) {
      if (event.key === '${storageKey}' || event.key === null) restore();
    });
  }
  label();
  button.hidden = false;
})();`;

export const themeInit = `<script data-site-theme>${init}</script>`;
export const themeControl = `<script data-site-theme>${control}</script>`;
export const themeSwitch = '<button type="button" class="site-theme-toggle" hidden>Light mode</button>';
export const themeToolbar = `<div class="site-theme-toolbar">${themeSwitch}</div>`;
export const themeCsp = [init, control].map(source => `'sha256-${createHash('sha256').update(source).digest('base64')}'`).join(' ');
