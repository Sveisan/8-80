import { palette } from './tokens.ts';

/** Shared identity metadata, including system-theme-aware browser chrome. */
export const BRAND_HEAD = `
<meta name="theme-color" content="${palette.paper}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${palette.night}" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">`;
