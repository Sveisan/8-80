import type { ScriptLines } from '../script.ts';

export function timePicker(choices: string, script: ScriptLines): string {
  const esc = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const arrow = (direction: number, label: string): string => `<button type="button" class="time-arrow" data-direction="${direction}" aria-label="${esc(script.get(label) ?? '')}" aria-controls="times" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction < 0 ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}"/></svg></button>`;
  return `<div class="time-picker">${arrow(-1, 'time.earlier')}<div class="times" id="times">${choices}</div>${arrow(1, 'time.later')}</div>`;
}

export const TIME_PICKER_CSS = `
  .time-picker { display: flex; align-items: center; gap: var(--space-2); min-width: 0; margin-top: var(--space-2); }
  .times {
    display: flex; flex: 1; min-width: 0; gap: var(--space-1); padding: var(--space-1) var(--space-1) var(--space-2); scroll-padding-inline: var(--space-1);
    overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity;
    scrollbar-width: thin; scrollbar-color: var(--line) transparent;
    user-select: none; -webkit-user-select: none;
  }
  .times::-webkit-scrollbar { height: var(--space-1); }
  .times::-webkit-scrollbar-thumb { background: var(--line); border-radius: var(--radius-pill); }
  .times .pick { flex: 0 0 calc((100% - 3 * var(--space-1)) / 4); min-width: var(--time-option-min); scroll-snap-align: start; }
  .time-arrow {
    display: grid; place-items: center; flex: 0 0 var(--target-min); width: var(--target-min); height: var(--control-height);
    min-height: 0; margin: 0; padding: 0; background: transparent; color: var(--ink);
    border: 1px solid var(--control-border); border-radius: var(--radius-control); cursor: pointer;
  }
  .time-arrow[hidden] { display: none; }
  @media (pointer: coarse) { .time-arrow { display: none; } }
  .time-arrow:disabled { opacity: .3; cursor: default; }
  .time-arrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (hover: hover) { .time-arrow:not(:disabled):hover { border-color: var(--accent); color: var(--accent); } }
  @media (pointer: fine) { .times, .times .pick { cursor: grab; } }
  .times.is-dragging { scroll-snap-type: none; }
  .times.is-dragging, .times.is-dragging .pick { cursor: grabbing; }
`;

/** Adds desktop controls while leaving touch swiping and native radios intact. */
export const TIME_PICKER_SCRIPT = `
  document.querySelectorAll('.time-picker').forEach(function (picker) {
    var row = picker.querySelector('.times');
    var arrows = picker.querySelectorAll('.time-arrow');
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var update = function () {
      var end = Math.max(0, row.scrollWidth - row.clientWidth);
      arrows.forEach(function (button) {
        button.hidden = end <= 1;
        button.disabled = Number(button.dataset.direction) < 0 ? row.scrollLeft <= 1 : row.scrollLeft >= end - 1;
      });
    };
    var centre = function (smooth) {
      var selected = row.querySelector('input:checked');
      if (!selected || !row.clientWidth) return;
      var box = selected.parentNode.getBoundingClientRect(), track = row.getBoundingClientRect();
      row.scrollTo({ left: row.scrollLeft + box.left - track.left - (row.clientWidth - box.width) / 2, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
    };
    arrows.forEach(function (button) {
      button.addEventListener('click', function () {
        row.scrollBy({ left: Number(button.dataset.direction) * Math.max(80, row.clientWidth * .75), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      });
    });
    row.addEventListener('scroll', update, { passive: true });
    row.addEventListener('change', function () { centre(true); });
    row.addEventListener('wheel', function (event) {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1);
      var end = row.scrollWidth - row.clientWidth;
      if (end <= 1 || (delta < 0 && row.scrollLeft <= 1) || (delta > 0 && row.scrollLeft >= end - 1)) return;
      event.preventDefault();
      row.scrollLeft += delta;
    }, { passive: false });
    var drag = null, suppressClick = false;
    row.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button === 0) drag = { id: event.pointerId, x: event.clientX, left: row.scrollLeft, moved: false };
    });
    row.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id || !(event.buttons & 1)) return;
      var distance = event.clientX - drag.x;
      if (!drag.moved && Math.abs(distance) < 6) return;
      if (!drag.moved) { drag.moved = true; row.setPointerCapture(event.pointerId); row.classList.add('is-dragging'); }
      event.preventDefault();
      row.scrollLeft = drag.left - distance;
    });
    var finish = function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      drag = null;
      row.classList.remove('is-dragging');
      if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
      setTimeout(function () { suppressClick = false; }, 0);
    };
    row.addEventListener('pointerup', finish);
    row.addEventListener('pointercancel', finish);
    row.addEventListener('lostpointercapture', finish);
    row.addEventListener('click', function (event) {
      if (suppressClick && event.detail) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    var disclosure = row.closest('details');
    if (disclosure) disclosure.addEventListener('toggle', function () { if (disclosure.open) { update(); centre(false); } });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(row);
    update();
    centre(false);
  });
`;
