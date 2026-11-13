import { breakpoints, declarations, foundations, palette, space, themes } from './tokens.ts';

/** Inline in every HTML renderer. No framework, CSS request or third-party font call. */
export const FOUNDATION_CSS = `
  @font-face {
    font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 200 800; font-display: swap;
    src: url('/fonts/bricolage-grotesque-latin-v1.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Fraunces'; font-style: normal; font-weight: 100 900; font-display: swap;
    src: url('/fonts/fraunces-latin-v1.woff2') format('woff2');
  }
  :root {
    ${declarations(palette, 'color-')}
    ${declarations(space, 'space-')}
    ${declarations(foundations)}
    ${declarations(themes.light)}
    --serif: var(--font-display); --gold: var(--color-gold);
    --muted: var(--quiet); --border: var(--line); --panel: var(--card);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { ${declarations(themes.dark)} color-scheme: dark; }
  }
  [data-theme="light"] { ${declarations(themes.light)} color-scheme: light; }
  [data-theme="dark"] { ${declarations(themes.dark)} color-scheme: dark; }
  [data-theme] { --muted: var(--quiet); --border: var(--line); --panel: var(--card); }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-padding-top: var(--space-8); }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--text-body)/var(--leading-body) var(--font-body); font-optical-sizing: auto; }
  h1 { font: 500 var(--text-heading)/var(--leading-heading) var(--font-display); letter-spacing: -.025em; text-wrap: balance; }
  h2, h3 { font-family: var(--font-body); line-height: var(--leading-heading); text-wrap: balance; }
  h2 { font-size: var(--text-subhead); font-weight: 700; }
  p, li, h1, h2, h3, label, legend, button, summary { overflow-wrap: anywhere; }
  a { overflow-wrap: anywhere; color: var(--link); text-decoration-thickness: .075em; text-underline-offset: .2em; }
  a:hover { text-decoration-thickness: .12em; }
  :where(a, button, input, textarea, select, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--accent); outline-offset: 3px;
  }
  ::selection { color: var(--on-accent); background: var(--accent); }
  [hidden] { display: none !important; }
  .sr, .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .quiet, .hint { color: var(--quiet); }
  .small, .hint { font-size: var(--text-caption); }
  .eyebrow { color: var(--quiet); font-size: var(--text-caption); font-weight: 600; letter-spacing: .02em; }
  .wrong, [role="alert"] { color: var(--bad); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  }
`;

/** Native controls are the shared components; page renderers only arrange them. */
export const CONTROL_CSS = `
  :where(input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), select, textarea) {
    display: block; width: 100%; min-width: 0; min-height: var(--control-height);
    padding: var(--space-3) var(--space-4); font: inherit; color: var(--ink);
    background: var(--bg); border: 1px solid var(--control-border); border-radius: var(--radius-control);
  }
  textarea { resize: vertical; }
  input::placeholder, textarea::placeholder { color: var(--quiet); opacity: 1; }
  input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); }
  label:has(input[type="checkbox"]) { min-height: var(--target-min); cursor: pointer; }
  :where(input, textarea, select)[aria-invalid="true"], input.bad { border-color: var(--bad); }
  :where(input, textarea, select):disabled { opacity: .55; cursor: not-allowed; }
  button, .button, a.save {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
    min-height: var(--control-height); padding: var(--space-3) var(--space-5);
    border: 1px solid var(--control-border); border-radius: var(--radius-control);
    background: transparent; color: var(--ink); font: 600 var(--text-small)/1.4 var(--font-body);
    text-align: center; text-decoration: none; cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease);
  }
  button.primary, .button.primary, a.save {
    background: var(--accent); border-color: var(--accent); color: var(--on-accent);
    --mark-ink: var(--color-night); --mark-gold: var(--button-mark-gold); --mark-dot: var(--button-mark-dot);
  }
  button.quiet, .button.quiet { border-color: transparent; background: transparent; color: var(--quiet); font-weight: 400; }
  button.danger, .button.danger { color: var(--bad); border-color: var(--bad); }
  :where(button, .button):disabled, .button[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
  @media (hover: hover) {
    :where(button, .button, a.save):not(:disabled):not([aria-disabled="true"]):hover { border-color: var(--ink); }
    :where(button.primary, .button.primary, a.save):not(:disabled):hover { filter: brightness(.94); }
  }
  .code { font-size: var(--text-code); letter-spacing: var(--tracking-code); text-align: center; font-variant-numeric: tabular-nums; }
  .field-error { color: var(--bad); font-size: var(--text-caption); margin: var(--space-2) 0 var(--space-4); }
  :where(label, legend) { display: block; font-size: var(--text-small); color: var(--ink); }
  fieldset { min-width: 0; padding: 0; border: 0; }
  .ds-field label { margin: 0 0 var(--space-2); }
  .ds-field :where(.hint, .wrong) { margin: var(--space-2) 0 0; font-size: var(--text-caption); }
  .ds-field + .ds-field, .ds-field + button { margin-block-start: var(--space-6); }
  .pick { position: relative; display: block; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .pick input { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; margin: 0; }
  .pick span:first-of-type {
    display: flex; align-items: center; justify-content: center; min-height: var(--control-height);
    overflow-wrap: anywhere; padding-inline: var(--space-1); border: 1px solid var(--control-border); border-radius: var(--radius-control);
    color: var(--ink); font-size: var(--text-caption); font-variant-numeric: tabular-nums;
    transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease);
  }
  .pick input:checked + span { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
  .pick input:focus-visible + span, .pick input:focus + span { outline: 2px solid var(--accent); outline-offset: 3px; }
  .pick input:disabled + span { opacity: .55; cursor: not-allowed; }
  .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-1); }
  @media (max-width: ${breakpoints.narrow}) {
    .days { grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--day-option-min)), 1fr)); }
  }
  .notice { padding: var(--space-4); border: 1px solid var(--control-border); border-inline-start: 3px solid var(--accent); border-radius: var(--radius-control); }
  .notice[role="alert"] { border-color: var(--bad); background: var(--bad-bg); }
  summary { min-height: var(--target-min); cursor: pointer; }
`;

/** Shared layout vocabulary for new surfaces. Existing narrow pages keep their layout. */
export const LAYOUT_CSS = `
  .ds-container { width: min(100% - var(--space-10), var(--measure-wide)); margin-inline: auto; }
  .ds-stack > * + * { margin-block-start: var(--stack-space, var(--space-6)); }
  .ds-cluster { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  .ds-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: var(--space-6); }
  .ds-panel { min-width: 0; padding: var(--space-6); background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-panel); }
  .ds-reading { max-width: var(--measure-reading); }
`;
