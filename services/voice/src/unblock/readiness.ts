import { config, smsConfigured } from '../config.ts';
import { unblockConfig } from './config.ts';
import { coverageReady } from './coverage.ts';
/** Names of everything still missing before live Unblock calls may be placed. Empty means ready. */
export function unblockReadiness(): string[] {
  const c = unblockConfig(); const missing: string[] = [];
  if (!c.enabled) missing.push('UNBLOCK_ENABLED');
  if (!c.safetyReady) missing.push('UNBLOCK_SAFETY_APPROVED');
  if (!c.scriptsReady) missing.push('UNBLOCK_SCRIPTS_APPROVED');
  if (!c.amdReady) missing.push('UNBLOCK_AGENTS_VERIFIED');
  if (!c.priceApproved || !c.price || !c.productId || !c.checkout) missing.push('monthly subscription product (UNBLOCK_PRICE_VERIFIED, UNBLOCK_PRICE_LABEL, UNBLOCK_PRODUCT_ID, UNBLOCK_CHECKOUT_URL)');
  if (!config.billing.checkoutReady()) missing.push('payment provider key, webhook secret and HTTPS PUBLIC_URL (subscription checkout, cancel and billing portal)');
  if (c.toolSecret.length < 32) missing.push('UNBLOCK_TOOL_SECRET');
  if (!c.supportHours || !config.company.supportEmail() || !config.operator.phones().length) missing.push('human support and safety response coverage');
  if (!coverageReady()) missing.push('UNBLOCK_COVERAGE_START and UNBLOCK_COVERAGE_END');
  if (Object.values(c.agentIds).some(id => !id) || new Set(Object.values(c.agentIds)).size !== 3) missing.push('three distinct Unblock agents');
  if (!smsConfigured()) missing.push('verification SMS');
  if (!process.env['SPEECHIFY_API_KEY'] || !process.env['SPEECHIFY_WEBHOOK_SECRET']) missing.push('Speechify API and signed callbacks');
  if (!config.link.publicUrl().startsWith('https://')) missing.push('HTTPS PUBLIC_URL');
  if (!process.env['DATA_ENCRYPTION_KEY']) missing.push('encryption key');
  return missing;
}
