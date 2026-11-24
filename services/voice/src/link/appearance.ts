/** The approved dark design is shared by the weekly account screens. */
export const ACCOUNT_APPEARANCE_CSS = `
  .account-header-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0 var(--space-3); }
  .account-header-tools a { font-size: .9375rem; }
  [data-theme="dark"] .account-header { margin-bottom: 1.25rem; }
  [data-theme="dark"] .account-dashboard main > h1 { font-size: clamp(2.15rem, 4vw, 3rem); }
  [data-theme="dark"] .weekly-account .call-overview {
    background: radial-gradient(ellipse 28rem 16rem at 12% 0%, #2b4236, transparent 95%), var(--card);
    border: 1px solid #617465; padding: clamp(.875rem, 3.6vw, 1.75rem); box-shadow: 0 1.5rem 3.5rem -3rem #000;
  }
  [data-theme="dark"] .call-overview h2 { color: var(--quiet); font-weight: 600; font-size: 1rem; }
  [data-theme="dark"] .call-overview .appointment { margin-block: .6rem .875rem; }
  [data-theme="dark"] .call-overview > .appointment .appointment-date { font-size: 1.125rem; font-weight: 500; }
  [data-theme="dark"] .call-overview > .appointment .appointment-time { line-height: 1.04; margin-top: .3rem; }
  [data-theme="dark"] .call-overview > .appointment .appointment-clock {
    font: 500 clamp(3.45rem, 12vw, 5.35rem)/1.02 var(--font-display);
    font-variant-numeric: lining-nums tabular-nums; letter-spacing: -.032em;
  }
  [data-theme="dark"] .appointment-time small { color: var(--quiet); font-size: .9375rem; }
  [data-theme="dark"] .call-overview > .booking-clock { margin-top: -.35rem; }
  [data-theme="dark"] .call-controls button, [data-theme="dark"] .weekly-editor > summary { background: #223128; }
  [data-theme="dark"] .account-sidebar h2, [data-theme="dark"] .account-disclosure > summary { font-size: 1.125rem; }
  [data-theme="dark"] .account-sidebar > section:not(.call-overview) { margin-top: 1.2rem; }
  [data-theme="dark"] .account-disclosure > summary { padding-block: .625rem; }
  [data-theme="dark"] .review-slot { background: #1b261f; border-color: #607060; }
  [data-theme="dark"] .review-slot.proposed {
    background: radial-gradient(ellipse 19rem 12rem at 0% 0%, #344637, transparent), #25342a; border-color: #a79064;
  }
  [data-theme="dark"] .review-slot h2 { color: var(--quiet); font-size: 1rem; }
  [data-theme="dark"] .review-slot.proposed h2 { color: var(--accent); }
  [data-theme="dark"] .review-slot .appointment-clock {
    font: 500 clamp(2.25rem, 7vw, 3rem)/1.05 var(--font-display);
    font-variant-numeric: lining-nums tabular-nums; letter-spacing: -.035em;
  }
  [data-theme="dark"] .review-slot .appointment-date { font-size: 1.0625rem; }
  [data-theme="dark"] .account-notice { border-radius: var(--radius-control); }
  @media (min-width: 55rem) {
    [data-theme="dark"] :is(.account-dashboard, .account-review) main { max-width: 60rem; }
    [data-theme="dark"] .account-dashboard .account-layout { gap: clamp(1rem, 4vw, 3.25rem); }
    [data-theme="dark"] .account-dashboard .account-sidebar { padding-inline-start: 1.875rem; }
  }
`;
