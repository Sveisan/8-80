import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, repoRoot } from '../config.ts';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * The terms and the privacy page, from markdown in legal/.
 *
 * Markdown on disk rather than HTML in a template, because the person who
 * eventually has to review these is a lawyer and not a front-end developer,
 * and a document that can only be edited by someone who can read JSX is a
 * document that will not be edited.
 *
 * The renderer handles headings, paragraphs, bold and lists, and nothing else.
 * Every line is escaped before any of it is applied, so the markdown cannot
 * introduce a tag even if somebody pastes one in.
 */
const CACHE = new Map<string, { at: number; html: string }>();
const TTL_MS = 60_000;

export type LegalPage = 'terms' | 'privacy';

const TITLES: Record<LegalPage, string> = { terms: 'Terms', privacy: 'Privacy' };

/**
 * Who the company actually is.
 *
 * Unset in development and on a box that has not been told yet, and the page
 * says so in place of the name rather than inventing one. A privacy policy
 * naming a data controller that does not exist is worse than one admitting it
 * is a draft.
 */
function details(): Record<string, string> {
  const c = config.company;
  const company = c.name();
  const orgnr = c.orgnr();
  return {
    company: company || 'the company running 8&80 (not yet named here — see legal/README.md)',
    orgnr_clause: orgnr ? ` (org. nr. ${orgnr})` : '',
    address: c.address() || 'an address not yet set',
    support_email: c.supportEmail() || 'hei@8and80.me',
  };
}

export function legalPage(which: LegalPage, now = Date.now()): string {
  const hit = CACHE.get(which);
  if (hit && now - hit.at < TTL_MS) return hit.html;
  const source = readFileSync(resolve(repoRoot, 'legal', `${which}.md`), 'utf8');
  const html = shell(TITLES[which], render(fill(source)));
  CACHE.set(which, { at: now, html });
  return html;
}

const fill = (text: string): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => details()[key] ?? whole);

/** Headings, paragraphs, bold, bullets. Escaped first, so nothing else. */
export function render(markdown: string): string {
  const out: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(bullet[1] ?? '')}</li>`);
      continue;
    }
    // A wrapped paragraph in the source is one paragraph on the page.
    if (!list && out.length && out[out.length - 1]?.startsWith('<p>') && !line.startsWith('#')) {
      out[out.length - 1] = `${out[out.length - 1]?.slice(0, -4)} ${inline(line)}</p>`;
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

const inline = (text: string): string =>
  esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');

/** BRAND.md §6, the same tokens as everything else. */
function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — 8&amp;80</title>
<style>
  :root {
    color-scheme: light dark;
    --ink: #2F4A3A; --bg: #F4EDE1; --line: #D9D6C9; --quiet: #5A695E; --gold: #E2B653;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #F4F1E8; --bg: #1A2920; --line: #414D44; --quiet: #9DA198; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 5rem; background: var(--bg); color: var(--ink);
    font: 17px/1.7 ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 34rem; }
  h1 { font-size: 1.85rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 .4rem;
       padding-bottom: .9rem; border-bottom: 2px solid var(--gold); }
  h2 { font-size: 1.15rem; margin: 2.4rem 0 .6rem; letter-spacing: -0.01em; }
  p, li { margin: 0 0 1rem; }
  ul { padding-left: 1.2rem; margin: 0 0 1rem; }
  a { color: inherit; }
  main > p:first-of-type { color: var(--quiet); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
