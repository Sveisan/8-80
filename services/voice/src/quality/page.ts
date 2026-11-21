import { themeInit, themeControl, themeSwitch } from '../design-system/theme.ts';
import { BRAND_HEAD } from '../design-system/head.ts';
import { FOUNDATION_CSS, CONTROL_CSS } from '../design-system/styles.ts';
import { CALL_QUALITY_CSS } from '../design-system/pages.ts';
import { esc } from '../link/page.ts';
import { FILTERS, matches, type CallReview, type Check, type Filter } from './dashboard.ts';

const labels: Record<Filter, string> = { all: 'All calls', flagged: 'Flagged', uncertain: 'Uncertain', unavailable: 'Unavailable', clear: 'Clear', pending: 'Pending' };
const shell = (body: string): string => `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Call quality · 8&amp;80</title>${BRAND_HEAD}${themeInit}<style>${FOUNDATION_CSS}${CONTROL_CSS}${CALL_QUALITY_CSS}</style></head><body><main class="quality"><header class="quality-header"><a href="/call-quality" class="quality-brand">8&amp;80</a><span class="eyebrow">Private · Owner access</span>${themeSwitch}</header>${body}</main>${themeControl}</body></html>`;
export function qualityGate(kind: 'signin' | 'forbidden' | 'unavailable' | 'error'): string {
  const content = {
    signin: '<h1>Call quality</h1><p>Sign in with the owner’s phone number to see private call reviews.</p><a class="button primary" href="/access?for=call-quality">Sign in with a text code</a>',
    forbidden: '<h1>Owner access required</h1><p>This account does not have permission to view call reviews.</p><a class="button" href="/access?for=call-quality">Sign in with the owner account</a>',
    unavailable: '<h1>Call quality is unavailable</h1><p>Owner access has not been configured for this page.</p>',
    error: '<h1>Reviews could not be loaded</h1><p>Your calls and the background reviewer continue as usual. Please try again.</p><a class="button" href="/call-quality">Try again</a>',
  };
  return shell(`<section class="quality-gate">${content[kind]}</section>`);
}
const date = (value: Date): string => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }).format(value);
const time = (value: Date): string => `<time datetime="${esc(value.toISOString())}">${esc(date(value))}</time>`;
function result(label: string, check: Check): string {
  const state = { flag: 'Flagged', clear: 'Clear', uncertain: 'Uncertain', unavailable: 'Unavailable' }[check.state];
  return `<div class="quality-check"><dt>${label}</dt><dd><span class="quality-badge ${check.state}">${state}</span><span class="quality-score">${check.score === undefined ? '—' : `${(check.score * 100).toFixed(1)}%`}</span></dd></div>`;
}
function card(call: CallReview): string {
  const state = call.state === 'pending' ? 'Pending' : call.state === 'not_reviewed' ? 'Not reviewed' : call.state === 'unavailable' ? 'Unavailable'
    : matches(call, 'flagged') ? 'Flagged' : matches(call, 'uncertain') ? 'Uncertain' : matches(call, 'unavailable') ? 'Partly unavailable' : 'Clear';
  return `<article class="quality-call" aria-label="Call ${esc(date(call.endedAt))}"><div class="quality-call-heading"><h2>${time(call.endedAt)}</h2><span class="quality-overall">${state}</span></div>
    <p class="quality-id">Call ID <code>${esc(call.id)}</code></p>
    <dl class="quality-checks">${result('Repeated questions', call.repeated)}${result('Unsupported recap claims', call.recap)}</dl>
    ${call.note ? `<p class="quality-note">${esc(call.note)}</p>` : ''}
    ${call.reviewedAt ? `<p class="quality-note">Review finished ${time(call.reviewedAt)}</p>` : ''}</article>`;
}
export function qualityPage(calls: CallReview[], filter: Filter, requestedPage: number, now: Date, enabled: boolean): string {
  const selected = calls.filter(call => matches(call, filter));
  const pages = Math.max(1, Math.ceil(selected.length / 50)), page = Math.min(requestedPage, pages);
  const href = (n: number): string => `/call-quality?filter=${filter}&amp;page=${n}`;
  return shell(`<div class="quality-title"><div><p class="eyebrow">Weekly calls · Last 14 days</p><h1>Call quality</h1><p>See where a conversation may need a closer look.</p></div><div class="quality-actions"><a class="button" href="${href(page)}">Refresh reviews</a><form method="post" action="/call-quality/signout"><button>Sign out</button></form></div></div>
    <aside class="quality-explainer" aria-label="How to read reviews"><strong>${enabled ? 'Background reviewer enabled' : 'Background reviewer paused or unconfigured'}</strong><p>Jev checks for unnecessary repeated questions and unsupported claims in the conversational recap. Reviews are advisory and never change a call or recap.</p><p>Scores estimate the chance of an issue: <strong>70% or more is flagged</strong>, <strong>30% or less is clear</strong>, and the middle is uncertain. These are model estimates, not calibrated confidence. Missing or failed checks are unavailable.</p></aside>
    <nav class="quality-filters" aria-label="Filter reviews">${FILTERS.map(f => `<a href="/call-quality?filter=${f}"${filter === f ? ' aria-current="page"' : ''}>${labels[f]} <span>${calls.filter(c => matches(c, f)).length}</span></a>`).join('')}</nav>
    <div class="quality-window"><p>${selected.length} ${selected.length === 1 ? 'call' : 'calls'}${filter === 'all' ? '' : ` · ${labels[filter]}`} · Page ${page} of ${pages}</p><p>Updated ${time(now)} · Europe/Oslo</p></div>
    <section aria-label="Recent call reviews">${selected.length ? selected.slice((page - 1) * 50, page * 50).map(card).join('') : `<div class="quality-empty"><h2>${calls.length ? 'No calls match this filter' : 'No recent completed weekly calls'}</h2><p>${calls.length ? 'Choose another filter to see other reviews.' : 'New reviews appear here after eligible weekly calls finish. The worker checks about once a minute.'}</p></div>`}</section>
    ${pages > 1 ? `<nav class="quality-pagination" aria-label="Review pages">${page > 1 ? `<a class="button" href="${href(page - 1)}">Newer calls</a>` : ''}${page < pages ? `<a class="button" href="${href(page + 1)}">Older calls</a>` : ''}</nav>` : ''}
    <footer class="quality-footer"><p>Showing up to the latest 500 completed weekly calls from the last 14 days. Filters can overlap when a call has different outcomes for its two checks.</p><p>Safety-flagged calls and other programmes are excluded. Results expire after 14 days. Reviews contain scores and verdicts; they do not identify exact sentences.</p></footer>`);
}
