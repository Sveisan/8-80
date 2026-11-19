import { createHmac } from 'node:crypto';
import { test, expect, fixture, signIn } from './fixtures.ts';

test.beforeEach(async ({ request }) => { await fixture(request, 'reset'); });

test('booking verifies the SMS code before creating a caller and preserves field errors', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792110101' : '+4792110201';
  await page.goto('/start');
  await page.getByLabel('What shall we call you? (optional)', { exact: true }).fill('Alex');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByLabel('Email', { exact: true }).fill('alex@');
  await page.getByRole('button', { name: 'Book my first call', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('What shall we call you? (optional)', { exact: true })).toHaveValue('Alex');
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
  await page.screenshot({ path: testInfo.outputPath('weekly-booked.png'), fullPage: true });
  const { caller } = await fixture(request, 'state', { phone });
  expect(caller).toMatchObject({ billing_status: 'trialing', onboarding: 'pending', paused: false });
  await expect(page.getByRole('link', { name: 'Save our number' })).toHaveAttribute('href', '/contact.vcf');
  await expect(page.locator('button[value="skip"], #move-weekly, #notes-heading')).toHaveCount(0);
  await page.locator('#move-call summary').click();
  await page.locator('#first-day').selectOption({ index: 2 });
  await page.locator('#first-time').fill('18:00');
  await page.getByRole('button', { name: 'Review new time' }).click();
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText('This changes your first call and sets your usual weekly time.', { exact: false })).toBeVisible();
  const firstProposal = await page.locator('time').getAttribute('datetime');
  expect((await fixture(request, 'state', { phone })).caller).toEqual(caller);
  await page.screenshot({ path: testInfo.outputPath('weekly-first-move-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save new time' }).click();
  await expect(page).toHaveURL(/\/me\?schedule=weekly$/);
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', firstProposal!);
  await expect(page.locator('.usual-time')).toContainText('18:00');
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ slot_minute: 1080, next_call_at: firstProposal });
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
  await page.getByLabel('What shall we call you? (optional)', { exact: true }).fill('Alex');
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

test('weekly account moves, skips, private corrections and pause survive reload', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792130101' : '+4792130201';
  const { link } = await fixture(request, 'seed', { phone, paid: true });
  await page.goto(String(link));
  await expect(page.getByRole('heading', { name: 'Your next call' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('weekly-returning.png'), fullPage: true });
  await page.locator('#move-call summary').click();
  const originalDay = await page.locator('#once-day').inputValue();
  const initialAt = await page.locator('.appointment').getAttribute('datetime');
  await page.locator('#once-time').fill('18:00');
  await page.getByRole('button', { name: 'Review new time' }).click();
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText(/This changes one call. Your usual weekly time stays the same/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit my choice' }).click();
  await expect(page.locator('#once-time')).toHaveValue('18:00');
  await expect(page.locator('#once-day')).toHaveValue(originalDay);
  await page.getByRole('button', { name: 'Review new time' }).click();
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  const onceAt = await page.locator('time').getAttribute('datetime');
  expect(onceAt).not.toBe(initialAt);
  await page.getByRole('button', { name: 'Save new time' }).click();
  await expect(page).toHaveURL(/\?schedule=once$/);
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', onceAt!);
  await expect(page.getByRole('status')).toContainText('Your usual weekly time stays the same.');
  await expect(page.locator('.usual-time')).toContainText('17:30');
  await page.reload();
  await page.locator('#move-call summary').click();
  await expect(page.locator('#once-time')).toHaveValue('18:00');
  await expect(page.locator('#once-day')).toHaveValue(originalDay);
  await expect(page.locator('#weekly-time')).toHaveValue('17:30');
  await page.getByRole('button', { name: 'Skip this call' }).click();
  await expect(page.getByRole('status')).toContainText('Skipped');
  await expect(page.locator('.appointment')).not.toHaveAttribute('datetime', onceAt!);
  await expect(page.locator('.usual-time')).toContainText('17:30');

  await page.getByRole('link', { name: 'Open my commitment and goals' }).click();
  await expect(page).toHaveURL(/\/access\?for=memory$/);
  await expect(page.getByText(/Confirm your phone number again/)).toBeVisible();
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Text me a code', exact: true }).click();
  await expect(page.locator('#code')).toBeVisible();
  const { code } = await fixture(request, 'code', { phone });
  await page.locator('#code').fill(String(code));
  await page.getByRole('button', { name: 'Open my notes', exact: true }).click();
  await expect(page).toHaveURL(/\/memory$/);
  await page.locator('#goals').fill('Spend more time outside with friends.');
  await page.locator('button[value="save"]').click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.reload();
  await expect(page.locator('#goals')).toHaveValue('Spend more time outside with friends.');
  expect((await fixture(request, 'state', { phone })).goals).toBe('Spend more time outside with friends.');

  await page.goto('/me');
  await expect(page.getByRole('link', { name: 'Verify your phone to manage billing or cancel renewal' })).toBeVisible();
  await page.locator('#preferences > summary').click();
  await page.getByRole('button', { name: 'Turn on calendar invitations' }).click();
  await expect(page.getByRole('button', { name: 'Turn off calendar invitations' })).toBeVisible();
  const weeklyEditor = page.locator('#move-weekly');
  if (testInfo.project.name === 'chromium') await weeklyEditor.locator('summary').press('Enter');
  else await weeklyEditor.locator('summary').click();
  await weeklyEditor.getByLabel('Weekly day').selectOption('2');
  await weeklyEditor.getByLabel('Time', { exact: true }).fill('19:00');
  await weeklyEditor.getByRole('button', { name: 'Review new time' }).click();
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText(/This changes your next call and your usual time every week/)).toBeVisible();
  const weeklyAt = await page.locator('time').getAttribute('datetime');
  await page.getByRole('button', { name: 'Save new time' }).click();
  await expect(page).toHaveURL(/\/me\?schedule=weekly$/);
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', weeklyAt!);
  await expect(page.locator('.usual-time')).toContainText('Tuesday 19:00');
  await page.reload();
  const weeklyState = await fixture(request, 'state', { phone });
  expect(weeklyState.caller).toMatchObject({ slot_weekday: 2, slot_minute: 1140, next_call_at: weeklyAt, calendar_invites_enabled: true });
  expect(weeklyState.calendarEmails).toEqual(expect.arrayContaining([expect.objectContaining({ at: weeklyAt, method: 'REQUEST' })]));
  await page.getByRole('button', { name: 'Pause calls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pause your calls?' })).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false });
  await page.locator('button[value="stop-confirm"]').click();
  await expect(page.getByRole('heading', { name: 'Calls paused' })).toBeVisible();
  await expect(page.getByText('Billing continues while calls are paused.')).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: true, billing_status: 'active' });
  await page.goto(String(link));
  await expect(page.getByRole('button', { name: 'Cancel subscription renewal' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('weekly-paused.png'), fullPage: true });
  await page.getByRole('button', { name: 'Resume calls' }).click();
  await expect(page.locator('.appointment')).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false, billing_status: 'active' });
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
  // Wait for the submitted page to finish before testing persistence on reload.
  await expect(page.getByRole('status')).toContainText('Renewal is cancelled.');
  await page.reload();
  const result = await fixture(request, 'state', { phone });
  expect(result.caller).toMatchObject({ cancel_at_period_end: true, billing_status: 'active' });
  expect(result.cancellations).toBe(1);
});
