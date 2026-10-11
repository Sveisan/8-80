export function beliefConfig() {
  const value = (key: string): string => (process.env[key] ?? '').trim();
  return {
    enabled: value('BELIEFS_ENABLED') === 'true',
    live: value('BELIEFS_LIVE_CALLS') === 'true',
    safetyReady: value('BELIEFS_SAFETY_APPROVED') === 'true',
    price: value('BELIEFS_PRICE_LABEL'),
    checkout: value('BELIEFS_CHECKOUT_URL'),
    productId: value('BELIEFS_PRODUCT_ID'),
    basePriceId: value('BELIEFS_BASE_PRICE_ID'),
    priceApproved: value('BELIEFS_PRICE_VERIFIED') === 'true',
    amdReady: value('BELIEFS_AGENTS_VERIFIED') === 'true',
    scriptsReady: value('BELIEFS_SCRIPTS_APPROVED') === 'true',
    toolSecret: value('BELIEFS_TOOL_SECRET'),
    agentIds: { onboarding: value('BELIEFS_ONBOARDING_AGENT_ID'), daily: value('BELIEFS_DAILY_AGENT_ID'), weekly: value('BELIEFS_WEEKLY_AGENT_ID') },
    supportHours: value('BELIEFS_SUPPORT_HOURS'),
    coverageStart: value('BELIEFS_COVERAGE_START'),
    coverageEnd: value('BELIEFS_COVERAGE_END'),
  };
}
