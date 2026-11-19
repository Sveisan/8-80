/** Owner-approved initial scope. A declaration, not geolocation or proof of current location during a later call. */
export const NORWAY_SCOPE_VERSION = 'norway-v1';
export const NORWAY_SIGNUP_PRODUCT = 'unblock-norway-v1';
export const norwayScopeConfirmed = (version: string | undefined): boolean => version === NORWAY_SCOPE_VERSION;
