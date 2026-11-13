import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export const fixtureHeaders = { 'x-design-fixture-key': 'synthetic-design-fixture' };
export const fixture = async (request: APIRequestContext, action: string, data = {}): Promise<Record<string, unknown>> => {
  const response = await request.post(`/__test/${action}`, { headers: fixtureHeaders, data });
  expect(response.ok(), `fixture ${action}: ${await response.text()}`).toBeTruthy();
  return response.json();
};
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/*', route => {
      const hostname = new URL(route.request().url()).hostname;
      return hostname === '127.0.0.1' || hostname === 'localhost' ? route.continue() : route.abort();
    });
    await use(page);
  },
});
export { expect };
export async function signIn(page: Page, request: APIRequestContext, phone: string): Promise<void> {
  await page.goto('/access');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Text me a code', exact: true }).click();
  await expect(page.locator('#code')).toBeVisible();
  const { code } = await fixture(request, 'code', { phone });
  expect(code).toMatch(/^\d{6}$/);
  await page.locator('#code').fill(String(code));
  await page.locator('form[action="/access/verify"] button').click();
  await expect(page.getByRole('heading', { name: 'Your calls', exact: true })).toBeVisible();
}
