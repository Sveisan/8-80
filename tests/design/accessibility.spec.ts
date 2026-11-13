import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.ts';

const preview = 'http://127.0.0.1:8790';
for (const theme of ['light', 'dark']) {
  test(`accessible product surfaces in ${theme}`, async ({ page }) => {
    for (const path of ['/start', '/start/error', '/start/code', '/access', '/access/code', '/me', '/me/paused', '/memory', '/feedback', '/beliefs', '/beliefs/join', '/beliefs/schedule', '/beliefs/daily', '/beliefs/weekly', '/privacy', '/unblock', '/unblock/join', '/unblock/verify', '/unblock/schedule', '/unblock/account', '/unblock/about']) {
      await test.step(path, async () => {
        await page.goto(`${preview}${path}?theme=${theme}`);
        const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
      });
    }
  });
}

test('200 percent text and the narrowest supported viewport preserve reflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ['/start', '/access', '/me', '/memory', '/feedback', '/beliefs', '/beliefs/account', '/privacy', '/unblock', '/unblock/account', '/unblock/schedule']) {
    await page.goto(`${preview}${path}`);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(size.content, path).toBeLessThanOrEqual(size.viewport + 1);
    await expect(page.locator('h1')).toBeVisible();
    for (const day of await page.locator('.days .pick > span').all()) {
      if (!await day.isVisible()) continue;
      const text = await day.evaluate(element => {
        const selection = document.createRange(); selection.selectNodeContents(element);
        return { height: selection.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight) };
      });
      expect(text.height, 'weekday abbreviations stay together').toBeLessThanOrEqual(text.line + 1);
    }
  }
});

test('Unblock keeps native light-call choices visible, labelled and usable', async ({ page }) => {
  await page.goto(`${preview}/unblock/schedule`);
  const none = page.getByRole('radio', { name: 'No light calls', exact: true });
  await expect(none).toBeVisible();
  await none.check();
  await expect(none).toBeChecked();
  await expect(none).toHaveCSS('opacity', '1');
  const monday = page.getByRole('checkbox', { name: 'Mon', exact: true });
  await monday.uncheck();
  await expect(monday).not.toBeChecked();
  await monday.check();
  await expect(monday).toBeChecked();
});

test('keyboard choices, error focus and visible focus survive theme changes', async ({ page }) => {
  await page.goto(preview);
  await page.getByRole('button', { name: 'Papir', exact: true }).click();
  await page.getByRole('radio', { name: 'Thu', exact: true }).press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Fri', exact: true })).toBeChecked();
  const outline = await page.getByRole('radio', { name: 'Fri', exact: true }).evaluate(input => getComputedStyle(input.nextElementSibling!).outlineStyle);
  expect(outline).toBe('solid');
  await page.goto(`${preview}/start/error`);
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-describedby', 'email-wrong');
});

test('changing reduced motion stops the SVG immediately and retains the resting drawing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(preview);
  const mark = page.locator('.mark-moods svg[data-mood="idle"]');
  await expect(mark).toHaveAttribute('data-motion', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(mark).toHaveAttribute('data-motion', 'rest');
  await expect(mark).toBeVisible();
  const rest = await mark.evaluate(svg => [...svg.querySelectorAll('path[fill-opacity]')].map(path => getComputedStyle(path).fillOpacity));
  expect(rest.every(value => value === '0')).toBeTruthy();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(mark).toHaveAttribute('data-motion', 'running');
});

test('native forms remain usable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: preview, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('/start');
  await page.getByLabel('Your number', { exact: true }).fill('+4790000001');
  await page.locator('input[name="weekday"][value="3"]').check();
  await expect(page.locator('input[name="weekday"][value="3"]')).toBeChecked();
  await expect(page.locator('button.primary')).toBeEnabled();
  await expect(page.locator('#appointment-check button')).toBeVisible();
  await context.close();
});
