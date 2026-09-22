import type { Recap, RecapRole } from './compose.ts';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** BRAND.md §6. Inline, because a mail client may drop the style block entirely. */
const C = {
  ink: '#2F4A3A', // Pine on Paper, 8.4:1 — body and the one thing
  bg: '#F4EDE1', // Paper
  accent: '#4A6656', // Green on Paper, 5.4:1 — the wordmark
  gold: '#E2B653', // Never text on Paper (1.6:1). The rule and the ball only.
  quiet: '#5A695E', // 5.0:1 on Paper
  line: '#D9D6C9',
} as const;

/**
 * Single quotes inside the stack, and this is not a style preference.
 *
 * Every one of these declarations ends up inside a double-quoted HTML `style`
 * attribute. `"Segoe UI"` closes that attribute early, the rest of the
 * declaration is parsed as stray attributes, and the element loses its size,
 * weight and colour along with its font — which is exactly what happened to
 * the first letter that went out, and why it arrived looking like unstyled
 * text. Single quotes are valid CSS and survive the attribute.
 */
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

export interface LetterOptions {
  /**
   * An absolute https URL for a PNG of the mark, 120px square or larger.
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
  /** The day of the call, already in the caller's zone and language. */
  date?: string;
  /**
   * One link, for the one letter that cannot do its job without one.
   *
   * The recap has none and will never have one — BRAND.md §1, a promise kept
   * turning into a campaign. A letter that says the free month is over and
   * does not say where to continue is not restraint, it is a dead end. Set as
   * text rather than a button for the same reason the rest of this is: it is
   * correspondence, and correspondence does not have buttons.
   */
  action?: { label: string; url: string };
}

/** Sizes, not colours: the dark theme changes what these are set in, never how big. */
const STYLE: Record<RecapRole, string> = {
  // Their own sentence, and the reason anybody opens this. Set large and in a
  // normal weight rather than bold — this is a letter quoting them back, not a
  // headline announcing something at them.
  lead: `margin:0;padding:0 0 32px;font-size:30px;line-height:1.32;font-weight:400;letter-spacing:-0.018em;`,
  body: `margin:0;padding:0 0 26px;font-size:16px;line-height:1.65;`,
  quiet: `margin:0;padding:0;font-size:14px;line-height:1.65;`,
  signoff: `margin:0;padding:16px 0 0;font-size:13px;line-height:1.6;letter-spacing:0.02em;`,
};

const INK: Record<RecapRole, string> = {
  lead: C.ink,
  body: C.ink,
  quiet: C.quiet,
  signoff: C.quiet,
};

/**
 * The recap as a letter on headed paper.
 *
 * The first one that went out was plain text and read as machine output —
 * correctly, because a note with nothing at the top and nothing at the bottom
 * is not restraint, it is absence. This adds a letterhead, a date, and a
 * hierarchy, and nothing else: no button, no banner, no social footer, no
 * "view in browser", no image that has to load for the email to make sense.
 * BRAND.md §9.
 *
 * The whole page is one focal point. Their sentence is set at 30px and
 * everything else steps down hard from it, because the one job this email has
 * is to be findable on a Thursday by somebody scrolling.
 *
 * Tables and inline styles, because this is email. The `<style>` block carries
 * only the dark-mode swap, so a client that strips it still gets a complete,
 * legible letter on Paper rather than a guess.
 *
 * The `[if mso]` pair around the column is not optional decoration. Outlook on
 * Windows renders with Word, which ignores `max-width` entirely — without the
 * ghost table the 500px column runs the full width of a maximised window and
 * the one thing arrives as a single 1600px line.
 *
 * Every caller-supplied string goes through `esc`. A commitment is somebody
 * else's words, spoken down a phone and transcribed, and it lands in an HTML
 * document — that is exactly the shape of thing that is one apostrophe away
 * from broken markup.
 */
export function letterHtml(recap: Recap, options: LetterOptions = {}): string {
  const ball = options.markUrl
    // No border-radius: the PNG is already a circle on transparency, and
    // Outlook ignores the property anyway — so it can only ever hide a mistake
    // in the image from us while showing it to half the recipients.
    ? `<td style="width:40px;padding:0 13px 0 0;line-height:0;"><img src="${esc(options.markUrl)}" width="40" height="40" alt="" style="display:block;border:0;" /></td>`
    : '';
  const date = options.date
    ? `<td align="right" style="font:400 12px/40px ${FONT};letter-spacing:0.06em;color:${C.quiet};" class="quiet">${esc(options.date)}</td>`
    : '';

  // From the options or from the letter itself. Carrying it on the Recap means
  // every sender does not have to remember to forward it, and forgetting would
  // produce a letter that says "if you want them to keep going:" and then
  // nothing at all.
  const act = options.action ?? recap.action;
  const action = act
    ? `\n            <tr><td style="padding:0 0 26px;font-size:16px;line-height:1.65;"><a href="${esc(act.url)}" style="color:${C.accent};text-decoration:underline;" class="wordmark">${esc(act.label)}</a></td></tr>`
    : '';

  const letter = recap.parts
    .map((p) => {
      // The sign-off sits under a hairline. A letter ends; it does not just stop.
      const rule =
        p.role === 'signoff'
          ? `<tr><td style="padding:34px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule" style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>\n            `
          : '';
      // The action sits after the body and before the sign-off, where a
      // postscript would go in a letter that had one.
      const before = p.role === 'signoff' ? action : '';
      return `${before}${rule}<tr><td class="${p.role}" style="${STYLE[p.role]}color:${INK[p.role]};">${esc(p.text)}</td></tr>`;
    })
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
    .ground { background: #1A2920 !important; }
    .wordmark { color: #E2B653 !important; }
    .rule { border-color: #414D44 !important; }
    .lead, .body { color: #F4F1E8 !important; }
    .quiet, .signoff { color: #9DA198 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};" class="ground">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};" class="ground">
    <tr>
      <td align="center" style="padding:48px 24px 60px;">
        <!--[if mso]><table role="presentation" width="500" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;">
          <tr><td style="padding:0 0 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${ball}<td style="font:700 13px/40px ${FONT};letter-spacing:0.16em;color:${C.accent};" class="wordmark">8&amp;80</td>
              ${date}
            </tr></table>
          </td></tr>
          <tr><td style="border-top:2px solid ${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="height:38px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="font-family:${FONT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${letter}
            </table>
          </td></tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
