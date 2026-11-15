export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env) {
  const calendarId = env['GOOGLE_CALENDAR_ID'] ?? '';
  return {
    enabled: env['GOOGLE_CALENDAR_ENABLED'] === '1', calendarId,
    clientId: env['GOOGLE_CALENDAR_CLIENT_ID'] ?? '',
    clientSecret: env['GOOGLE_CALENDAR_CLIENT_SECRET'] ?? '',
    refreshToken: env['GOOGLE_CALENDAR_REFRESH_TOKEN'] ?? '',
  };
}

export function googleCalendarReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = googleCalendarConfig(env);
  return !!c.clientId && !!c.clientSecret && !!c.refreshToken && !!c.calendarId && c.calendarId !== 'primary' && !/[\r\n]/.test(c.calendarId);
}
