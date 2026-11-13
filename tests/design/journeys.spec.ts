import { createHmac } from 'node:crypto';
import { test, expect, fixture, signIn } from './fixtures.ts';

test.beforeEach(async ({ request }) => { await fixture(request, 'reset'); });

test('booking verifies the SMS code before creating a caller and preserves field errors', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792110101' : '+4792110201';
  await page.goto('/start');
  await page.getByLabel('What shall we call you?', { exact: true }).fill('Alex');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByLabel('Email', { exact: true }).fill('alex@');
  await page.getByRole('button', { name: 'Book my first call', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('What shall we call you?', { exact: true })).toHaveValue('Alex');
  await page.getByLabel('Email', { exact: true }).fill('alex@example.com');
  await page.getByRole('button', { name: 'Book my first call', exact: true }).click();
  await expect(page.locator('#code')).toBeVisible();
  const { code } = await fixture(request, 'code', { phone });
  const wrong = code === '123456' ? '654321' : '123456';
  await page.locator('#code').fill(wrong);
  await expect(page.locator('#code')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('#code').fill(String(code));
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('.appointment')).toBeVisible();
  const { caller } = await fixture(request, 'state', { phone });
  expect(caller).toMatchObject({ billing_status: 'trialing', onboarding: 'pending', paused: false });
});

test('SMS delivery failure gives a usable way forward', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792120101' : '+4792120201';
  await fixture(request, 'seed', { phone });
  await fixture(request, 'failure', { sms: true });
  await page.goto('/access');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Text me a code', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#code')).toBeVisible();
  await expect(page.getByRole('link', { name: /different number/i })).toBeVisible();
});

test('an expired verification code and an expired link lead back to recovery', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792160101' : '+4792160201';
  await fixture(request, 'seed', { phone });
  await page.goto('/access');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Text me a code', exact: true }).click();
  const { code } = await fixture(request, 'code', { phone });
  await fixture(request, 'expire', { phone });
  await page.locator('#code').fill(String(code));
  await page.locator('form[action="/access/verify"] button').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#code')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('form[action="/access"] button')).toBeEnabled();
  const response = await page.goto('/r/expired-link');
  expect(response?.status()).toBe(410);
  await expect(page.getByRole('link', { name: 'Open your calls', exact: true })).toBeVisible();
});

test('a slow submission keeps its accessible label and back navigation restores the form', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792170101' : '+4792170201';
  await page.goto('/start');
  await page.getByLabel('What shall we call you?', { exact: true }).fill('Alex');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByLabel('Email', { exact: true }).fill('alex@example.com');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/start', async route => {
    if (route.request().method() === 'POST') await pending;
    await route.continue();
  });
  const button = page.getByRole('button', { name: 'Book my first call', exact: true });
  let submitted: { busy: string | null; label: string | null } | undefined;
  // Capture in the submit event: Chromium suspends page.evaluate while a
  // document navigation is pending, even while the POST is held by the route.
  await page.exposeFunction('recordSubmitState', (state: typeof submitted) => { submitted = state; });
  await page.evaluate(() => {
    document.addEventListener('submit', event => {
      const submitter = (event as SubmitEvent).submitter!;
      const report = window as unknown as { recordSubmitState: (state: { busy: string | null; label: string | null }) => Promise<void> };
      void report.recordSubmitState({ busy: submitter.getAttribute('aria-busy'), label: submitter.querySelector('.label')?.textContent ?? null });
    }, { once: true });
  });
  const click = button.click();
  try { await expect.poll(() => submitted).toEqual({ busy: 'true', label: 'Book my first call' }); }
  finally { release(); }
  await click;
  await expect(page.locator('#code')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Book my first call', exact: true })).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByLabel('Your number', { exact: true })).toBeEnabled();
});

test('a saved schedule and private corrections survive reload; pause and resume are explicit', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792130101' : '+4792130201';
  await fixture(request, 'seed', { phone });
  await signIn(page, request, phone);
  await page.locator('#move-call summary').click();
  await page.locator('input[name="weekday"][value="2"]').check();
  await page.locator('input[name="time"][value="18:00"]').check();
  await page.locator('input[name="always"]').check();
  const accountPath = new URL(page.url()).pathname;
  // WebKit can finish the click before the form navigation starts. Await the
  // save response so the following goto cannot abort that pending POST.
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === accountPath),
    page.locator('button[value="move"]').click(),
  ]);
  expect(saved.ok()).toBeTruthy();
  await page.goto('/me');
  await expect(page.locator('.usual-time')).toContainText('18:00');
  await page.reload();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ slot_weekday: 2, slot_minute: 1080 });
  await page.goto('/memory');
  await page.locator('#goals').fill('Spend more time outside with friends.');
  await page.locator('button[value="save"]').click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.reload();
  await expect(page.locator('#goals')).toHaveValue('Spend more time outside with friends.');
  expect((await fixture(request, 'state', { phone })).goals).toBe('Spend more time outside with friends.');
  await page.goto('/me');
  await page.locator('button[value="stop"]').click();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false });
  await page.locator('button[value="stop-confirm"]').click();
  await expect(page.getByRole('heading', { name: /stopped/i })).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: true });
  await page.reload();
  await page.locator('button[value="start"]').click();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false });
});

test('a stale private form does not overwrite newer saved goals', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792140101' : '+4792140201';
  await fixture(request, 'seed', { phone });
  await signIn(page, request, phone);
  await page.goto('/memory');
  await page.locator('#goals').fill('This older tab must not overwrite the new goal.');
  await fixture(request, 'revision', { phone });
  await page.locator('button[value="save"]').click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('#goals')).toHaveValue('A newer goal saved elsewhere.');
});

test('payment confirmation and cancellation use provider state and survive reload', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792150101' : '+4792150201';
  const { hash, link } = await fixture(request, 'seed', { phone, paid: true });
  const payload = JSON.stringify({ id: 'evt_design', type: 'checkout.session.completed', data: { object: {
    object: 'checkout.session', client_reference_id: hash, subscription: 'sub_design', customer: 'cus_design', payment_status: 'paid',
  } } });
  const time = Math.floor(Date.now() / 1000);
  const signature = `t=${time},v1=${createHmac('sha256', 'design-test-webhook').update(`${time}.${payload}`).digest('hex')}`;
  const response = await request.post('/webhooks/payments', { data: payload, headers: { 'stripe-signature': signature } });
  expect(response.ok()).toBeTruthy();
  await page.goto(String(link));
  await page.locator('button[value="cancel-renewal"]').click();
  expect((await fixture(request, 'state', { phone })).cancellations).toBe(0);
  await page.locator('button[value="cancel-renewal-confirm"]').click();
  await page.reload();
  const result = await fixture(request, 'state', { phone });
  expect(result.caller).toMatchObject({ cancel_at_period_end: true, billing_status: 'active' });
  expect(result.cancellations).toBe(1);
});
