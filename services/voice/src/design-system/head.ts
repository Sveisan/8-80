import { themes } from './tokens.ts';

/** Shared identity metadata, including the default browser chrome. */
export const BRAND_HEAD = `
<meta name="theme-color" content="${themes.dark.bg}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">`;
