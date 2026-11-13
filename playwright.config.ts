import { defineConfig, devices } from '@playwright/test';

const journeys = process.env['DESIGN_VISUAL_ONLY'] !== '1';
export default defineConfig({
  testDir: './tests/design', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  forbidOnly: !!process.env['CI'], retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000, expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: .002, animations: 'disabled', caret: 'hide' } },
  outputDir: './output/playwright/results',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8791', locale: 'en-GB', timezoneId: 'Europe/Oslo',
    reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-safari', testIgnore: '**/visual.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  webServer: [
    { command: 'npm run design:preview', url: 'http://127.0.0.1:8790/', timeout: 30_000,
      reuseExistingServer: false, env: { DESIGN_PREVIEW_PORT: '8790', DESIGN_TEST_TIME: '2026-11-08T12:00:00.000Z' } },
    ...(journeys ? [{ command: 'node --import tsx tests/design/server.ts', url: 'http://127.0.0.1:8791/health', timeout: 60_000, reuseExistingServer: false }] : []),
  ],
});
