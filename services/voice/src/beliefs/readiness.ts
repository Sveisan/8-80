import { config, smsConfigured } from '../config.ts';
import { beliefConfig } from './config.ts';
import { coverageReady } from './coverage.ts';
export function beliefReadiness(): string[] {
  const c=beliefConfig();const missing:string[]=[];
  if(!c.enabled)missing.push('BELIEFS_ENABLED');
  if(!c.safetyReady)missing.push('BELIEFS_SAFETY_APPROVED');
  if(!c.scriptsReady)missing.push('BELIEFS_SCRIPTS_APPROVED');
  if(!c.amdReady)missing.push('BELIEFS_AGENTS_VERIFIED');
  if(!c.priceApproved || !c.price || !c.productId || !c.basePriceId || !c.checkout)missing.push('one-time product and matching monthly price');
  if(c.toolSecret.length<32)missing.push('BELIEFS_TOOL_SECRET');
  if(!c.supportHours || !config.company.supportEmail() || !config.operator.phones().length)missing.push('human support and safety response coverage');
  if(!coverageReady())missing.push('BELIEFS_COVERAGE_START and BELIEFS_COVERAGE_END');
  if(Object.values(c.agentIds).some(id=>!id) || new Set(Object.values(c.agentIds)).size!==3)missing.push('three distinct Beliefs agents');
  if(!smsConfigured())missing.push('verification SMS');
  if(!process.env['SPEECHIFY_API_KEY'] || !process.env['SPEECHIFY_WEBHOOK_SECRET'])missing.push('Speechify API and signed callbacks');
  if(!config.link.publicUrl().startsWith('https://'))missing.push('HTTPS PUBLIC_URL');
  if(!process.env['DATA_ENCRYPTION_KEY'])missing.push('encryption key');
  if(!config.billing.webhookSecret() || !process.env[config.billing.provider()==='stripe'?'STRIPE_SECRET_KEY':'LEMONSQUEEZY_API_KEY'])missing.push('payment API and signed callbacks');
  return missing;
}
