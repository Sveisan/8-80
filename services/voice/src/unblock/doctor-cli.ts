import { unblockConfig } from './config.ts';
import { unblockReadiness } from './readiness.ts';
const missing = unblockReadiness();
console.log('8&80 Unblock readiness — configuration values are never printed');
console.log(unblockConfig().price ? 'Price label: set' : 'Price label: not set (UNBLOCK_PRICE_LABEL)');
console.log(unblockConfig().live ? 'Live-call switch: ON' : 'Live-call switch: OFF');
console.log('Placement also requires today’s manual Available check-in; inspect with npm run unblock:availability -- --status.');
if (missing.length) { for (const item of missing) console.log('Required: ' + item); process.exitCode = 1; }
else console.log('Configuration gates present. Private provider configuration, the payment seam, staffed coverage and remaining approvals still need verification. Live call/alert testing was owner-waived; audible behaviour and real delivery remain unverified.');
