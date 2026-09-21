import type { Recap, RecapRole } from './compose.ts';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** BRAND.md §6. Inline, because a mail client may drop the style block entirely. */
const C = {
  ink: '#243A30', // Deep on Mist, 10.6:1
  bg: '#ECF0EA', // Mist
  line: '#C0C8C1',
  quiet: '#5A6B62', // 4.9:1 on Mist
  accent: '#4A6656', // Green, 5.5:1 on Mist
} as const;

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

export interface LetterOptions {
  /**
   * An absolute https URL for a PNG of the mark, 96px square or larger.
   *
   * Optional on purpose. An inline SVG does not render in Gmail or Outlook, a
   * `data:` URI is stripped, and a remote image tells a server the moment
   * somebody opens their recap — which is a tracking pixel whatever we call it
   * and whatever we do with it. So the letter is designed to be complete
   * without it: BRAND.md §9 puts the wordmark beside the ball as live text
   * precisely so that the brand survives the image being absent, blocked, or
   * never configured.
   */
  markUrl?: string;
}

const STYLE: Record<RecapRole, string> = {
  // The one thing they committed to. Larger than everything else because
  // finding it on a Thursday is the entire reason this email exists.
  lead: `margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:600;color:${C.ink};`,
  body: `margin:0 0 18px;font-size:17px;line-height:1.55;color:${C.ink};`,
  quiet: `margin:0 0 18px;font-size:15px;line-height:1.55;color:${C.quiet};`,
  signoff: `margin:28px 0 0;font-size:15px;line-height:1.55;color:${C.quiet};`,
};

/**
 * The recap as a letter on headed paper.
 *
 * The first one that went out was plain text and read as machine output —
 * correctly, because a note with nothing at the top and nothing at the bottom
 * is not restraint, it is absence. This adds a letterhead and a hierarchy and
 * nothing else: no button, no banner, no social footer, no "view in browser",
 * no image that has to load for the email to make sense. BRAND.md §9.
 *
 * Tables and inline styles, because this is email. The `<style>` block carries
 * only the dark-mode swap, so a client that strips it still gets a complete,
 * legible letter on the light ground rather than a guess.
 *
 * Every caller-supplied string goes through `esc`. A commitment is somebody
 * else's words, spoken down a phone and transcribed, and it lands in an HTML
 * document — that is exactly the shape of thing that is one apostrophe away
 * from broken markup.
 */
export function letterHtml(recap: Recap, options: LetterOptions = {}): string {
  const mark = options.markUrl
    ? `<img src="${esc(options.markUrl)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:50%;" />`
    : '';

  const head = `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${mark ? `<td style="padding:0 10px 0 0;line-height:0;">${mark}</td>` : ''}
              <td style="font:700 19px/1 ${FONT};letter-spacing:-0.01em;color:${C.accent};" class="wordmark">8&amp;80</td>
            </tr></table>`;

  const letter = recap.parts
    .map((p) => `<p class="${p.role}" style="${STYLE[p.role]}">${esc(p.text)}</p>`)
    .join('\n            ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${esc(recap.subject)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ground { background: #16211B !important; }
    .wordmark { color: #E2B653 !important; }
    .rule { border-color: #424B44 !important; }
    .lead, .body { color: #F4F1E8 !important; }
    .quiet, .signoff { color: #A0A29A !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};" class="ground">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};" class="ground">
    <tr>
      <td align="center" style="padding:32px 20px 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
          <tr><td style="padding:0 0 16px;">${head}
          </td></tr>
          <tr><td class="rule" style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:26px 0 0;font-family:${FONT};">
            ${letter}
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
