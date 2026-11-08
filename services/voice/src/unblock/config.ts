export function unblockConfig() {
  const value = (key: string): string => (process.env[key] ?? '').trim();
  return {
    enabled: value('UNBLOCK_ENABLED') === 'true',
    live: value('UNBLOCK_LIVE_CALLS') === 'true',
    safetyReady: value('UNBLOCK_SAFETY_APPROVED') === 'true',
    price: value('UNBLOCK_PRICE_LABEL'),
    checkout: value('UNBLOCK_CHECKOUT_URL'),
    productId: value('UNBLOCK_PRODUCT_ID'),
    priceApproved: value('UNBLOCK_PRICE_VERIFIED') === 'true',
    amdReady: value('UNBLOCK_AGENTS_VERIFIED') === 'true',
    scriptsReady: value('UNBLOCK_SCRIPTS_APPROVED') === 'true',
    toolSecret: value('UNBLOCK_TOOL_SECRET'),
    agentIds: { opening: value('UNBLOCK_OPENING_AGENT_ID'), weekly: value('UNBLOCK_WEEKLY_AGENT_ID'), light: value('UNBLOCK_LIGHT_AGENT_ID') },
    supportHours: value('UNBLOCK_SUPPORT_HOURS'),
    coverageStart: value('UNBLOCK_COVERAGE_START'),
    coverageEnd: value('UNBLOCK_COVERAGE_END'),
  };
}
