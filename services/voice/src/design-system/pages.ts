import { BUSY_CSS } from '../signup/mascot.ts';
import { TIME_PICKER_CSS } from '../signup/time-picker.ts';
import { breakpoints } from './tokens.ts';

/** Task-specific composition. All production dimensions and type use the shared foundations. */

export const SIGNUP_CSS = `
  body {
    padding: max(var(--space-6), env(safe-area-inset-top)) max(var(--space-5), env(safe-area-inset-right))
             max(var(--space-10), env(safe-area-inset-bottom)) max(var(--space-5), env(safe-area-inset-left));
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: var(--measure-form); }
  .lockup { display: flex; align-items: center; justify-content: center; margin: 0 0 var(--space-8); color: var(--ink); }
  .mark { width: var(--mark-size); height: auto; display: block; }
  ${BUSY_CSS}
  .wordmark { font: var(--weight-display) var(--text-wordmark)/1 var(--font-display); letter-spacing: var(--tracking-tight); }
  h1 { font: 500 var(--text-heading)/var(--leading-heading) var(--serif); letter-spacing: var(--tracking-tight); margin: 0 0 var(--space-2); }
  /* The second sentence turns the first one over, so it is set lighter and on
     its own line — the weight is the punctuation. */
  h1 span { display: block; font-weight: 300; }
  .quiet { color: var(--quiet); margin: 0 0 var(--space-4); }
  h1 + form, h1 + .wrong { margin-top: var(--space-6); }
  .centre { text-align: center; }
  .honest { color: var(--quiet); font-size: var(--text-caption); margin: 0 0 var(--space-6); }
  .wrong { color: var(--bad); font-size: var(--text-small); margin: var(--space-1) 0 0; }
  form { margin: 0 0 var(--space-4); }
  fieldset { border: 0; padding: 0; min-width: 0; }
  fieldset legend { margin-top: 0; }
  #when legend, #when .zone { width: 100%; text-align: center; }
  /* Which clock, directly under the question, quiet enough not to be a second question. */
  .zone { margin: 0 0 var(--space-2); font-size: var(--text-caption); color: var(--quiet); }
  label, legend { display: block; font-size: var(--text-small); color: var(--ink); margin: var(--space-4) 0 var(--space-2); padding: 0; }
  input.code { font-size: var(--text-panel); letter-spacing: var(--tracking-code); text-align: center; font-variant-numeric: tabular-nums; }

  /* Contact fields as one card, so the form reads as one thing to fill in. */
  .fields { border: 1px solid var(--control-border); border-radius: var(--radius-panel); overflow: hidden; background: var(--card); }
  .fields input { border: 0; border-radius: 0; min-height: var(--control-height); padding: var(--space-4) var(--space-4); }
  .fields label { margin: 0; padding: var(--space-3) var(--space-4) 0; font-size: var(--text-caption); }
  .fields label:not(:first-child) { border-top: 1px solid var(--line); }
  .fields input { padding-top: var(--space-1); }
  .fields input:focus-visible { outline: 0; box-shadow: inset 3px 0 0 var(--accent); }
  .fields input.bad { box-shadow: inset 3px 0 0 var(--bad); }
  .fields .wrong { padding: 0 var(--space-4) var(--space-3); margin: 0; }
  .appointment { margin-top: var(--space-3); font-weight: var(--weight-control); }
  [hidden] { display: none !important; }
  input::placeholder { color: var(--quiet); opacity: 1; }

  /*
   * The day and the time. Radios under the pills, so a tap is a native choice
   * and the form needs no script; the pill is the span beside the radio.
   */
  fieldset { margin-top: var(--space-6); }
  ${TIME_PICKER_CSS}

  /* Everything the page used to say above the form, for whoever asks. */
  .faq { margin-top: var(--space-10); border-top: 1px solid var(--line); }
  .faq details { border-bottom: 1px solid var(--line); }
  .faq summary {
    list-style: none; cursor: pointer; padding: var(--space-4) var(--space-8) var(--space-4) 0; position: relative; font-size: var(--text-small);
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: '+'; position: absolute; right: .25rem; top: .9rem; color: var(--quiet); }
  .faq details[open] summary::after { content: '\\2212'; }
  .faq details p { margin: 0 0 var(--space-4); color: var(--quiet); font-size: var(--text-small); }

  button { width: 100%; margin-top: var(--space-6); }
  button.quiet { border: 0; color: var(--quiet); margin-top: var(--space-1); font-weight: var(--weight-body); }
  form + .quiet, button.primary + .quiet { margin-top: var(--space-3); }
  .returning { margin-top: var(--space-6); text-align: center; }
  .returning p { margin: 0 0 var(--space-2); color: var(--quiet); font-size: var(--text-caption); }
  .returning a {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
    min-height: var(--target-min); padding: var(--space-3) var(--space-5); border: 1px solid var(--control-border); border-radius: var(--radius-control);
    background: transparent; color: var(--ink); font-size: var(--text-caption); font-weight: var(--weight-control); text-decoration: none;
  }
  .returning a:hover { background: var(--card); border-color: var(--ink); }
  .returning a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  /* Named, not hidden. A sign-up page that does not say where its terms are is
     a sign-up page hoping nobody looks. */
  .legal { margin-top: var(--space-8); }
  .legal a { color: var(--quiet); }
  .signup-wide { max-width: var(--measure-wide); }
  .signup-layout { display: grid; gap: var(--space-10); }
  .signup-intro { padding-top: var(--space-2); }
  .signup-intro .lockup { justify-content: flex-start; margin-bottom: var(--space-8); }
  .eyebrow { font-size: var(--text-caption); letter-spacing: var(--tracking-wide); font-weight: var(--weight-control); color: var(--quiet); margin: 0 0 var(--space-4); }
  .signup-intro h1 { font-size: var(--text-display); line-height: 1.06; margin-bottom: var(--space-6); }
  .intro-summary { font-size: var(--text-small); line-height: 1.7; max-width: var(--measure-form); }
  .perspectives { margin: var(--space-6) 0 var(--space-4); max-width: var(--measure-form); }
  .perspectives svg { color-scheme: light; width: 100%; display: block; font-family: var(--serif); }
  .perspectives figcaption { display: flex; justify-content: space-between; gap: var(--space-6); font-size: var(--text-caption); color: var(--quiet); }
  .perspectives figcaption span { max-width: 9rem; }
  .perspectives figcaption span:last-child { text-align: right; }
  .intro-note { font-size: var(--text-small); line-height: 1.7; color: var(--quiet); margin-top: var(--space-6); max-width: var(--measure-form); }
  .booking-panel { width: 100%; max-width: var(--measure-form); padding: var(--space-6) var(--space-4); border: 1px solid var(--line); background: var(--card); border-radius: var(--radius-panel); min-width: 0; }
  .booking-panel h2 { font: var(--weight-display) var(--text-panel)/var(--leading-heading) var(--font-display); margin: 0 0 var(--space-6); letter-spacing: var(--tracking-tight); }
  .booking-panel .fields { background: var(--bg); }
  .booking-panel fieldset { margin-top: var(--space-8); }
  .voice-options { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
  .voice-choice .small { margin-top: var(--space-3); }
  .nudge-choice { display: flex; align-items: flex-start; gap: var(--space-3); margin: var(--space-6) 0; cursor: pointer; }
  .nudge-choice input { flex: 0 0 var(--checkbox-size); width: var(--checkbox-size); min-height: var(--checkbox-size); margin: var(--space-1) 0; accent-color: var(--accent); }
  .nudge-choice strong { display: block; color: var(--ink); font-weight: var(--weight-display); }
  .nudge-choice small { display: block; margin-top: var(--space-2); line-height: 1.6; }
  .signup-wide > .faq { max-width: var(--measure-reading); margin: var(--space-12) auto 0; }
  @media (min-width: ${breakpoints.split}) {
    .signup-layout { grid-template-columns: minmax(0, 1fr) minmax(0, var(--measure-form)); gap: var(--space-16); align-items: start; }
    .signup-intro { padding-top: var(--space-6); }
    .booking-panel { width: 100%; max-width: var(--measure-form); padding: var(--space-8); }
  }
  @media (min-width: ${breakpoints.medium}) {
    body { padding-top: var(--space-16); }
  }
`;

export const ACCOUNT_CSS = `
  body { padding: var(--space-10) var(--space-5); display: flex; justify-content: center; }
  main { width: 100%; max-width: var(--measure-form); }
  h1 { font-size: var(--text-heading); font-weight: var(--weight-display); margin: 0 0 var(--space-1); letter-spacing: var(--tracking-tight); }
  h2 { font-size: var(--text-subhead); font-weight: var(--weight-heading); margin: 0 0 var(--space-4); }
  .account-section { border-top: 1px solid var(--line); padding-top: var(--space-5); margin-top: var(--space-6); }
  .account-section .move { border-top: 0; padding-top: 0; margin-top: var(--space-4); }
  .call-overview { border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: var(--radius-panel); padding: var(--space-5); margin-top: var(--space-5); }
  .call-overview h2 { margin-bottom: var(--space-3); }
  .appointment { display: block; }
  .appointment-date { display: block; font-size: var(--text-subhead); font-weight: var(--weight-control); line-height: 1.3; letter-spacing: var(--tracking-tight); }
  .appointment-time { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); margin-top: var(--space-1); font-size: var(--text-appointment); font-weight: var(--weight-control); line-height: 1.2; letter-spacing: var(--tracking-tight); font-variant-numeric: tabular-nums; }
  .appointment-time small { font-size: var(--text-small); font-weight: var(--weight-body); letter-spacing: 0; }
  .call-overview .usual-time { margin: var(--space-2) 0 var(--space-5); }
  .contact-link { display: inline-block; font-weight: var(--weight-control); }
  .change-time { margin-bottom: var(--space-4); }
  .change-time summary { padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-control); cursor: pointer; }
  .change-time summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .reschedule summary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: var(--weight-control); }
  .now { color: var(--quiet); margin: 0 0 var(--space-8); }
  form { margin: 0 0 var(--space-4); }
  .row { display: flex; gap: var(--space-2); margin: var(--space-2) 0 var(--space-3); }
  label { display: block; font-size: var(--text-small); color: var(--quiet); }
  button { width: 100%; }
  button.quiet { border: 0; color: var(--quiet); }
  /* A link, because a download is not a form post; dressed as the filled button. */
  a.save { display: flex; width: 100%; }
  a.save + .hint { margin-bottom: var(--space-6); }
  ${BUSY_CSS}
  .always { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0 var(--space-3); }
  .always input { width: auto; }
  .move { border-top: 1px solid var(--line); padding-top: var(--space-5); margin-top: var(--space-5); }
  .skip, .stop.first { margin-top: var(--space-6); }
  /* Below the things somebody came here to do, and still plainly named. */
  .stop { margin-top: var(--space-1); }
  .hint { color: var(--quiet); font-size: var(--text-caption); margin: var(--space-2) 0 var(--space-3); }
  .centre { text-align: center; }
  .said { margin: var(--space-3) 0 0; }
  .lockup { display: flex; justify-content: center; margin: 0 0 var(--space-6); }
  .mark { width: var(--mark-size); height: auto; display: block; }
  .page-nav { margin: 0 0 var(--space-3); }
  .page-nav a { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--target-min); font-size: var(--text-caption); text-decoration: none; border-radius: var(--radius-control); }
  .page-nav a:hover { text-decoration: underline; }
  .page-nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  textarea { margin: var(--space-2) 0 0; }
  #goals::placeholder { color: var(--quiet); opacity: 1; }
  a { color: var(--link); }
  input[type=tel], input[type=text] { display: block; width: 100%; margin: var(--space-2) 0 var(--space-4); }

  /*
   * The day and the time, as the sign-up page picks them: radios under pills,
   * so a tap is a native choice and moving a call needs no script.
   */
  fieldset { border: 0; padding: 0; margin: 0 0 var(--space-3); min-width: 0; }
  legend { padding: 0; margin: 0 0 var(--space-1); font-size: var(--text-small); color: var(--quiet); }
  .zone { margin: 0 0 var(--space-2); font-size: var(--text-caption); color: var(--quiet); }
  ${TIME_PICKER_CSS}
`;

export const READING_CSS = `
  body { padding: var(--space-12) var(--space-5) var(--space-16); display: flex; justify-content: center; }
  main { width: 100%; max-width: var(--measure-reading); }
  h1 { font-size: var(--text-heading); line-height: 1.2; letter-spacing: var(--tracking-tight); margin: 0 0 var(--space-2);
       padding-bottom: var(--space-4); border-bottom: 2px solid var(--gold); }
  h2 { font-size: var(--text-subhead); margin: var(--space-10) 0 var(--space-2); letter-spacing: var(--tracking-tight); }
  p, li { margin: 0 0 var(--space-4); }
  ul { padding-left: var(--space-5); margin: 0 0 var(--space-4); }
  a { color: var(--link); }
  main > p:first-of-type { color: var(--quiet); }
`;

export const UNBLOCK_CSS = `
  .stack > * + * { margin-top: var(--space-8); }
  .stack h2 { font-size: var(--text-subhead); margin: 0 0 var(--space-2); }
  .quote { font-size: var(--text-subhead); line-height: 1.45; color: var(--ink) !important; margin: var(--space-2) 0; }
  .why { margin: var(--space-1) 0 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li { padding: var(--space-4) 0; border-top: 1px solid var(--line); }
  .rows li:first-child { border-top: 0; }
  .rows .when { display: block; color: var(--link); font-size: var(--text-caption); letter-spacing: var(--tracking-wide); }
  .rows .outcome { display: block; color: var(--quiet); font-size: var(--text-caption); margin-top: var(--space-1); }
  .ledger li { font-size: var(--text-body); line-height: 1.45; }
  .ledger .when { margin-bottom: var(--space-1); }
  .unblock-options { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: var(--space-2) 0; }
  .unblock-options label { display: flex; align-items: center; gap: var(--space-2); min-height: var(--control-height); margin: 0; font-weight: var(--weight-body); font-size: var(--text-small); }
  .unblock-options input { flex-shrink: 0; margin: 0; width: var(--checkbox-size); height: var(--checkbox-size); min-height: 0; accent-color: var(--accent); }
  .form fieldset { margin-top: var(--space-8); }
  .solo { margin-top: var(--space-4); }
  .soft { border-color: var(--line); background: transparent; }
  .soft form button { background: transparent; color: var(--ink); border: 1px solid var(--control-border); }
`;

export const PRACTICE_CSS = `

.shell{max-width:var(--measure-wide);margin: auto;padding: var(--space-8) var(--space-5) var(--space-16)}
.brand{display:block;width:max-content;margin: 0 auto var(--space-6);text-decoration:none;color:var(--ink)}
.brand .lockup{margin: 0}.brand .mark{display:block;width:var(--mark-brand-size);height:auto}
.top{display:flex;flex-wrap:wrap;gap: var(--space-4);justify-content:space-between;border-top:1px solid var(--line);padding-top: var(--space-5);font-size: var(--text-caption)}
.eyebrow{color:var(--quiet);font-size: var(--text-caption);font-weight: var(--weight-control);letter-spacing:var(--tracking-wide)}
.hero{text-align:center;padding: var(--space-16) 0 var(--space-8)}
.hero h1{font:500 var(--text-display)/var(--leading-display) var(--font-display);letter-spacing: var(--tracking-tight);max-width:54rem;margin: 0 auto var(--space-6)}
.lead{color:var(--quiet);font-size: var(--text-subhead);max-width:var(--measure-reading);margin: 0 auto var(--space-8)}
.button,button{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.hero .button{min-width:min(100%,23rem)}
.secondary{background:transparent;color:var(--ink);border-color:var(--control-border)}
.quiet{color:var(--quiet);font-size: var(--text-small)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap: var(--space-4);margin: var(--space-6) 0}
.card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-panel);padding: var(--space-6)}
.card h2,.card h3{margin: var(--space-3) 0;font-size: var(--text-subhead);line-height:1.3}
.card p{color:var(--quiet);margin: var(--space-3) 0}.timing{font-size: var(--text-caption);color:var(--link)}
.form,.account{max-width:var(--measure-reading);margin: var(--space-12) auto}
.form h1,.account h1{font:500 var(--text-heading)/var(--leading-heading) var(--font-display);letter-spacing: var(--tracking-tight)}
label{margin: var(--space-5) 0 var(--space-2)}
textarea{min-height:var(--textarea-min)}select option{background:var(--bg)}
input[type=checkbox]{width:var(--checkbox-size);height:var(--checkbox-size);margin: 0 var(--space-3) 0 0}
.check{display:flex;align-items:flex-start;min-height:var(--target-min);font-size: var(--text-small);font-weight: var(--weight-body)}
.check input{margin-top: var(--space-1);flex-shrink:0}.form button{width:100%;margin-top: var(--space-6)}
.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap: var(--space-5)}
.notice{max-width:var(--measure-reading);margin: var(--space-6) auto;color:var(--ink)}
.preview{background:var(--card);border-bottom:1px solid var(--line);padding: var(--space-2) var(--space-4);text-align:center;font-size: var(--text-caption)}
.divider{border:0;border-top:1px solid var(--line);margin: var(--space-8) 0}
.back{display:inline-flex;align-items:center;min-height:var(--target-min);margin: var(--space-6) 0 0;font-size: var(--text-small)}
.actions{display:flex;gap: var(--space-3);flex-wrap:wrap}.actions .button{flex:1}
.decision{font-size: var(--text-subhead);color:var(--ink)!important;line-height:1.4}
summary{padding: var(--space-3) 0}.inline{display:inline-block;margin: 0}.inline button{font-size: var(--text-caption);padding: var(--space-3) var(--space-4)}
.spaced{margin: var(--space-8) 0}.empty{padding: var(--space-8);border:1px dashed var(--control-border);border-radius:var(--radius-panel)}
.schedule-heading{text-align:center}fieldset{margin: 0 0 var(--space-8)}legend{font-size: var(--text-subhead);font-weight: var(--weight-control);margin-bottom: var(--space-4)}
.score{width:8rem}.footer{text-align:center;padding-top: var(--space-6);margin-top: var(--space-8);border-top:1px solid var(--line)}
.footer a{display:inline-flex;align-items:center;min-height:var(--target-min);margin: 0 var(--space-2)}
.progress{display:flex;gap: var(--space-2);margin: var(--space-6) 0}.progress span{height:4px;background:var(--line);flex:1;border-radius:var(--radius-pill)}.progress .on{background:var(--accent)}
@media(max-width: ${breakpoints.medium}){.shell{padding: var(--space-6) var(--space-5) var(--space-12)}.hero{padding: var(--space-12) 0 var(--space-6)}.lead{font-size: var(--text-body)}.cards,.row{grid-template-columns:1fr}.form,.account{margin: var(--space-8) auto}.button{width:100%}.actions{flex-direction:column}}

.appointment{border-color:var(--accent);padding: var(--space-8)}.appointment h2{font-size: var(--text-heading);line-height:1.25}.appointment button{width:100%}.appointment .button{width:100%;background:var(--accent);color:var(--on-accent);border-color:var(--accent)}.appointment>form button{background:transparent;color:var(--quiet);border:1px solid var(--control-border)}

.journey{margin-top: var(--space-10);padding-top: var(--space-8);border-top:1px solid var(--border)}
.journey>h2{max-width: var(--measure-reading);margin: 0 auto var(--space-8);text-align:center;font-size: var(--text-heading);line-height:1.2;letter-spacing: var(--tracking-tight);text-wrap:balance}
.journey-steps{list-style:none;padding: 0;margin: 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap: var(--space-4)}
.journey-step{min-width:0;display:flex;flex-direction:column;gap: var(--space-4);padding: var(--space-6);background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-panel)}
.step-number{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--control-border);border-radius:50%;color:var(--link);font-size: var(--text-caption);font-weight: var(--weight-control);letter-spacing:.8px}
.journey-step h3{margin: 0;font-size: var(--text-subhead);line-height:1.25;letter-spacing: var(--tracking-tight);text-wrap:balance}
.step-description{flex:1;margin: 0;color:var(--muted);font-size: var(--text-small);line-height:1.6}
.step-timing{display:flex;align-items:baseline;justify-content:space-between;gap: var(--space-3);margin: var(--space-1) 0 0;padding-top: var(--space-4);border-top:1px solid var(--border);font-size: var(--text-caption);color:var(--muted)}
.step-timing strong{color:var(--link);font-size: var(--text-caption);font-weight: var(--weight-control);white-space:nowrap}
.journey-price{margin: var(--space-6) 0 0;text-align:center}
@media(max-width:${breakpoints.split}){
  .journey-steps{grid-template-columns:1fr;gap: var(--space-3)}
  .journey-step{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap: var(--space-2) var(--space-5);padding: var(--space-5)}
  .step-number{grid-column:1;grid-row:1/3}
  .journey-step h3{grid-column:2;font-size: var(--text-subhead)}
  .step-description{grid-column:2}
  .step-timing{grid-column:3;grid-row:1/3;align-self:center;display:flex;flex-direction:column;gap: var(--space-1);margin: 0;padding: 0 0 0 var(--space-5);border-top:0;border-left:1px solid var(--border)}
}
@media(max-width:${breakpoints.narrow}){
  .journey{margin-top: var(--space-8);padding-top: var(--space-6)}
  .journey>h2{margin-bottom: var(--space-6)}
  .journey-step{grid-template-columns:32px minmax(0,1fr);gap: var(--space-2) var(--space-3);padding: var(--space-5)}
  .step-number{width:32px;height:32px;grid-row:1/4}
  .journey-step h3{font-size: var(--text-subhead)}
  .step-timing{grid-column:2;grid-row:3;flex-direction:row;justify-content:space-between;border-left:0;border-top:1px solid var(--border);padding: var(--space-3) 0 0;margin-top: var(--space-1)}
}`;

export const FEEDBACK_CSS = `

      .feedback .q { margin: 0 0 var(--space-6); }
      .feedback label { font-size: var(--text-small); color: var(--ink); margin-bottom: var(--space-2); }
      .feedback textarea { min-height: var(--textarea-min); }
      button.speak { width: auto; margin-top: var(--space-2); padding: var(--space-2) var(--space-4); font-size: var(--text-caption); color: var(--quiet); }
      button.speak.on { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
`;
