/** Cloudflare's documented opt-out keeps support usable with a strict script CSP.
 * Do not allow the edge to replace mailto links with script-dependent protection links.
 * https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/
 */
export const protectEmailLinks = (html: string): string => `<!--email_off-->${html}<!--/email_off-->`;
