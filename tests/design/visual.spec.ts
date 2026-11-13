import { test, expect } from './fixtures.ts';

const preview = 'http://127.0.0.1:8790';
for (const theme of ['light', 'dark']) {
  for (const width of [375, 1280]) {
    for (const [name, path] of [['signup', '/start'], ['account', '/me'], ['memory', '/memory'], ['feedback', '/feedback'], ['beliefs', '/beliefs'], ['access', '/access'], ['unblock', '/unblock'], ['unblock-account', '/unblock/account']] as const) {
      test(`@visual ${name} ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${preview}${path}?theme=${theme}`);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${theme}-${width}.png`, { fullPage: true });
      });
    }
  }
}
test('@visual handbook and brand package', async ({ page }) => {
  await page.goto(preview);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('handbook.png');
  await page.getByRole('link', { name: '06 Sidemønstre', exact: true }).click();
  await expect(page.locator('.theme-pair')).toHaveScreenshot('theme-pair.png');
  await page.getByRole('link', { name: '09 Merkevarefiler', exact: true }).click();
  await expect(page.locator('.brand-gallery')).toHaveScreenshot('brand-lockups.png');
  await expect(page.locator('.brand-icons')).toHaveScreenshot('brand-icons.png');
});
