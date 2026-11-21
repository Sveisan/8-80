import { createHmac } from 'node:crypto';
import { test, expect, activate, fixture, signIn } from './fixtures.ts';

test.beforeEach(async ({ request }) => { await fixture(request, 'reset'); });

test('booking verifies the SMS code before creating a caller and preserves field errors', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792110101' : '+4792110201';
  await page.goto('/start');
  await page.getByLabel('What shall we call you? (optional)', { exact: true }).fill('Alex');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await page.getByLabel('Email', { exact: true }).fill('alex@');
  await activate(page.getByRole('button', { name: 'Book my first call', exact: true }));
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('What shall we call you? (optional)', { exact: true })).toHaveValue('Alex');
  await page.getByLabel('Email', { exact: true }).fill('alex@example.com');
  await activate(page.getByRole('button', { name: 'Book my first call', exact: true }));
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
  await activate(page.locator('#move-call summary'));
  await page.locator('#first-day').selectOption({ index: 2 });
  await page.locator('#first-time').fill('18:00');
  await activate(page.getByRole('button', { name: 'Review new time' }));
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText('This changes your first call and sets your usual weekly time.', { exact: false })).toBeVisible();
  const firstProposal = await page.getByRole('region', { name: 'Proposed' }).locator('time').getAttribute('datetime');
  await expect(page.getByRole('region', { name: 'Current' }).locator('time')).toHaveAttribute('datetime', (caller as { next_call_at: string }).next_call_at);
  expect((await fixture(request, 'state', { phone })).caller).toEqual(caller);
  await page.screenshot({ path: testInfo.outputPath('weekly-first-move-review.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Save new time' }));
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
  await activate(page.getByRole('button', { name: 'Text me a code', exact: true }));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#code')).toBeVisible();
  await expect(page.getByRole('link', { name: /different number/i })).toBeVisible();
});

test('an expired verification code and an expired link lead back to recovery', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792160101' : '+4792160201';
  await fixture(request, 'seed', { phone });
  await page.goto('/access');
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await activate(page.getByRole('button', { name: 'Text me a code', exact: true }));
  await expect(page.locator('#code')).toBeVisible();
  const { code } = await fixture(request, 'code', { phone });
  expect(code).toMatch(/^\d{6}$/);
  await fixture(request, 'expire', { phone });
  await page.locator('#code').fill(String(code));
  await activate(page.locator('form[action="/access/verify"] button'));
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
  const click = activate(button);
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
  const calls = page.getByRole('region', { name: 'Your next call' });
  const notes = page.getByRole('region', { name: 'Your commitment and goals' });
  await expect(calls.getByRole('button', { name: 'Pause calls', exact: true })).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Plan and billing' }).getByRole('button', { name: 'Pause calls' })).toHaveCount(0);
  const callBounds = (await calls.boundingBox())!;
  const notesBounds = (await notes.boundingBox())!;
  if (testInfo.project.name === 'chromium') expect(callBounds.x + callBounds.width).toBeLessThan(notesBounds.x);
  else expect(callBounds.y + callBounds.height).toBeLessThan(notesBounds.y);
  await page.screenshot({ path: testInfo.outputPath('weekly-returning.png'), fullPage: true });
  await activate(page.locator('#move-call summary'));
  const originalDay = await page.locator('#once-day').inputValue();
  const initialAt = await page.locator('.appointment').getAttribute('datetime');
  const pauseAndResume = async (expectedAt: string) => {
    await activate(page.getByRole('button', { name: 'Pause calls', exact: true }));
    await expect(page.getByRole('heading', { name: 'Pause your calls?' })).toBeVisible();
    await expect(page.getByText('Billing continues while calls are paused.')).toBeVisible();
    await activate(page.locator('button[value="stop-confirm"]'));
    await expect(page.getByRole('heading', { name: 'Calls paused' })).toBeVisible();
    await activate(page.getByRole('button', { name: 'Resume calls' }));
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', expectedAt);
  };
  await page.locator('#once-time').fill('18:00');
  await activate(page.getByRole('button', { name: 'Review new time' }));
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText(/This changes one call. Your usual weekly time stays the same/)).toBeVisible();
  await activate(page.getByRole('button', { name: 'Edit my choice' }));
  await expect(page.locator('#once-time')).toHaveValue('18:00');
  await expect(page.locator('#once-day')).toHaveValue(originalDay);
  await activate(page.getByRole('button', { name: 'Review new time' }));
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  const onceAt = await page.getByRole('region', { name: 'Proposed' }).locator('time').getAttribute('datetime');
  expect(onceAt).not.toBe(initialAt);
  await activate(page.getByRole('button', { name: 'Save new time' }));
  await expect(page).toHaveURL(/\?schedule=once$/);
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', onceAt!);
  await expect(page.getByRole('status')).toContainText('Your usual weekly time stays the same.');
  await expect(page.locator('.usual-time')).toContainText('17:30');
  await page.reload();
  await activate(page.locator('#move-call summary'));
  await expect(page.locator('#once-time')).toHaveValue('18:00');
  await expect(page.locator('#once-day')).toHaveValue(originalDay);
  await expect(page.locator('#weekly-time')).toHaveValue('17:30');
  await pauseAndResume(onceAt!);
  await activate(page.getByRole('button', { name: 'Skip this call' }));
  await expect(page.getByRole('status')).toContainText('Skipped');
  await expect(page.locator('.appointment')).not.toHaveAttribute('datetime', onceAt!);
  await expect(page.locator('.usual-time')).toContainText('17:30');
  const skippedTo = await page.locator('.appointment').getAttribute('datetime');
  await page.goto(String(link));
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', skippedTo!);
  await expect(page.getByRole('button', { name: 'Undo skip' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('weekly-undo-skip.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Undo skip' }));
  await expect(page.getByRole('status')).toContainText('Your skipped call is back on the schedule.');
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', onceAt!);
  await page.goto(String(link));
  await expect(page.getByRole('button', { name: 'Undo skip' })).toHaveCount(0);
  await activate(page.getByRole('button', { name: 'Skip this call' }));
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', skippedTo!);
  await pauseAndResume(skippedTo!);

  await activate(page.getByRole('link', { name: 'Open my commitment and goals' }));
  await expect(page).toHaveURL(/\/access\?for=memory$/);
  await expect(page.getByText(/Confirm your phone number again/)).toBeVisible();
  await page.getByLabel('Your number', { exact: true }).fill(phone);
  await activate(page.getByRole('button', { name: 'Text me a code', exact: true }));
  await expect(page.locator('#code')).toBeVisible();
  const { code } = await fixture(request, 'code', { phone });
  await page.locator('#code').fill(String(code));
  await activate(page.getByRole('button', { name: 'Open my notes', exact: true }));
  await expect(page).toHaveURL(/\/memory$/);
  await page.locator('#goals').fill('Spend more time outside with friends.');
  await activate(page.locator('button[value="save"]'));
  await expect(page.getByRole('status')).toBeVisible();
  await page.reload();
  await expect(page.locator('#goals')).toHaveValue('Spend more time outside with friends.');
  expect((await fixture(request, 'state', { phone })).goals).toBe('Spend more time outside with friends.');

  await page.goto('/me');
  await expect(page.getByRole('link', { name: 'Verify your phone to manage billing or cancel renewal' })).toBeVisible();
  await activate(page.locator('#preferences > summary'));
  await activate(page.getByRole('button', { name: 'Turn on calendar invitations' }));
  await expect(page.getByRole('button', { name: 'Turn off calendar invitations' })).toBeVisible();
  const weeklyEditor = page.locator('#move-weekly');
  if (testInfo.project.name === 'chromium') await weeklyEditor.locator('summary').press('Enter');
  else await activate(weeklyEditor.locator('summary'));
  await weeklyEditor.getByLabel('Weekly day').selectOption('2');
  await weeklyEditor.getByLabel('Time', { exact: true }).fill('19:00');
  await activate(weeklyEditor.getByRole('button', { name: 'Review new time' }));
  await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
  await expect(page.getByText(/This changes your next call and your usual time every week/)).toBeVisible();
  const weeklyAt = await page.getByRole('region', { name: 'Proposed' }).locator('time').getAttribute('datetime');
  await activate(page.getByRole('button', { name: 'Save new time' }));
  await expect(page).toHaveURL(/\/me\?schedule=weekly$/);
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', weeklyAt!);
  await expect(page.locator('.usual-time')).toContainText('Tuesday 19:00');
  await page.reload();
  const weeklyState = await fixture(request, 'state', { phone });
  expect(weeklyState.caller).toMatchObject({ slot_weekday: 2, slot_minute: 1140, next_call_at: weeklyAt, calendar_invites_enabled: true });
  expect(weeklyState.calendarEmails).toEqual(expect.arrayContaining([expect.objectContaining({ at: weeklyAt, method: 'REQUEST' })]));
  await activate(page.getByRole('button', { name: 'Skip this call' }));
  await expect(page.getByRole('status')).toContainText('Skipped');
  const laterAt = await page.locator('.appointment').getAttribute('datetime');
  expect(laterAt).not.toBe(weeklyAt);
  await activate(page.getByRole('button', { name: 'Undo skip' }));
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', weeklyAt!);
  const restoredState = await fixture(request, 'state', { phone });
  const calendar = restoredState.calendarEmails as { at: string; method: string }[];
  expect(calendar.slice(-2)).toMatchObject([{ at: laterAt, method: 'REQUEST' }, { at: weeklyAt, method: 'REQUEST' }]);
  await activate(page.getByRole('button', { name: 'Pause calls', exact: true }));
  await expect(page.getByRole('heading', { name: 'Pause your calls?' })).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false });
  await activate(page.locator('button[value="stop-confirm"]'));
  await expect(page.getByRole('heading', { name: 'Calls paused' })).toBeVisible();
  await expect(page.getByText('Billing continues while calls are paused.')).toBeVisible();
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: true, billing_status: 'active' });
  await page.goto(String(link));
  await expect(page.getByRole('button', { name: 'Cancel subscription renewal' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('weekly-paused.png'), fullPage: true });
  await activate(page.getByRole('button', { name: 'Resume calls' }));
  await expect(page.locator('.appointment')).toHaveAttribute('datetime', weeklyAt!);
  expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ paused: false, billing_status: 'active' });
});

test.describe('while travelling', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('review compares both clocks and cancel keeps the saved appointment', async ({ page, request }, testInfo) => {
    const phone = testInfo.project.name === 'chromium' ? '+4792180101' : '+4792180201';
    const { link } = await fixture(request, 'seed', { phone });
    await page.goto(String(link));
    const booked = await page.locator('.appointment').getAttribute('datetime');
    await activate(page.locator('#move-call summary'));
    await page.locator('#once-time').fill('18:00');
    await activate(page.getByRole('button', { name: 'Review new time' }));
    await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
    const current = page.getByRole('region', { name: 'Current' });
    const proposal = page.getByRole('region', { name: 'Proposed' });
    await expect(current.locator('time')).toHaveAttribute('datetime', booked!);
    const changed = await proposal.locator('time').getAttribute('datetime');
    expect(changed).not.toBe(booked);
    const local = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Los_Angeles',
    });
    for (const [card, instant, bookingTime] of [[current, booked!, '17:30'], [proposal, changed!, '18:00']] as const) {
      await expect(card.locator('.appointment-zone')).toHaveText('Los Angeles time');
      await expect(card.locator('.appointment-clock')).toHaveText(local.format(new Date(instant)));
      await expect(card.locator('.booking-clock')).toBeVisible();
      await expect(card.locator('.booking-clock')).toContainText(`${bookingTime} · Norwegian time`);
      await expect(card.locator('.booking-date')).toBeHidden();
    }
    await expect(page.locator('.review-date')).toBeVisible();
    const currentBounds = (await current.boundingBox())!;
    const proposalBounds = (await proposal.boundingBox())!;
    if (testInfo.project.name === 'chromium') expect(currentBounds.x + currentBounds.width).toBeLessThan(proposalBounds.x);
    else expect(currentBounds.y + currentBounds.height).toBeLessThan(proposalBounds.y);
    await page.screenshot({ path: testInfo.outputPath('weekly-review-travel.png'), fullPage: true });
    const cancel = page.getByRole('link', { name: 'Cancel change' });
    if (testInfo.project.name !== 'chromium') {
      await page.setViewportSize({ width: 320, height: 667 });
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath('weekly-review-320.png') });
      await page.addStyleTag({ content: 'html {font-size: 200% !important}' });
      const width = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
      expect(width[1]).toBeLessThanOrEqual(width[0]! + 1);
      await expect(cancel).toBeInViewport({ ratio: 1 });
    }
    await activate(cancel);
    await expect(page.getByRole('heading', { name: 'Your next call' })).toBeVisible();
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', booked!);
    expect((await fixture(request, 'state', { phone })).caller).toMatchObject({ next_call_at: booked, slot_minute: 1050 });

    await activate(page.locator('#move-call summary'));
    await page.locator('#once-time').fill('06:00');
    await activate(page.getByRole('button', { name: 'Review new time' }));
    await expect(proposal.locator('.booking-date')).toBeVisible();
    await expect(page.locator('.review-date')).toBeHidden();
    await expect(proposal.locator('.appointment-date')).toBeVisible();
    await activate(cancel);
    await activate(page.getByRole('button', { name: 'Skip this call' }));
    await expect(page.getByRole('status')).toHaveText('Skipped one call.');
    await expect(page.locator('.appointment-zone')).toHaveText('Los Angeles time');
    await expect(page.locator('.booking-clock')).toContainText('17:30 · Norwegian time');
    await page.goto(String(link));
    await activate(page.getByRole('button', { name: 'Undo skip' }));
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', booked!);
  });
});

test('site appearance follows the browser preference through scheduling and navigation', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792190101' : '+4792190201';
  const { link } = await fixture(request, 'seed', { phone, paid: true });
  await page.emulateMedia({ colorScheme: 'light' });
  const root = page.locator('html');
  const appearance = async (theme: 'dark' | 'light') => {
    await expect(root).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('button', { name: theme === 'dark' ? 'Light mode' : 'Dark mode', exact: true })).toBeVisible();
    expect(await root.evaluate(el => getComputedStyle(el).colorScheme)).toBe(theme);
    expect(await root.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual((await page.evaluate(() => document.documentElement.clientWidth)) + 1);
  };
  await page.goto('/me');
  await appearance('dark');
  await signIn(page, request, phone);
  if (testInfo.project.name === 'mobile-safari') await page.setViewportSize({ width: 320, height: 667 });
  await page.goto('/me');
  const original = await page.locator('.appointment').getAttribute('datetime');
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') await activate(page.getByRole('button', { name: 'Light mode', exact: true }));
    await page.reload();
    await appearance(theme);
    await page.screenshot({ path: testInfo.outputPath(`account-${theme}.png`) });
    await activate(page.locator('#move-call summary'));
    await page.locator('#once-time').fill('18:00');
    await activate(page.getByRole('button', { name: 'Review new time', exact: true }));
    await expect(page.getByRole('heading', { name: 'Review new time' })).toBeVisible();
    await appearance(theme);
    const cancel = page.getByRole('link', { name: 'Cancel change', exact: true });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`review-${theme}.png`) });
    await activate(cancel);
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', original!);
    await activate(page.getByRole('button', { name: 'Pause calls', exact: true }));
    await expect(page.getByRole('heading', { name: 'Pause your calls?' })).toBeVisible();
    await appearance(theme);
    await activate(page.locator('button[value="stop-confirm"]'));
    await expect(page.getByRole('heading', { name: 'Calls paused' })).toBeVisible();
    await appearance(theme);
    await activate(page.getByRole('button', { name: 'Resume calls', exact: true }));
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', original!);
    await activate(page.getByRole('button', { name: 'Skip this call', exact: true }));
    await expect(page.getByRole('button', { name: 'Undo skip', exact: true })).toBeVisible();
    await page.goto('/me');
    await appearance(theme);
    await activate(page.getByRole('button', { name: 'Undo skip', exact: true }));
    await expect(page.locator('.appointment')).toHaveAttribute('datetime', original!);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/me');
  await appearance('light');
  for (const path of ['/start', '/access', '/terms', '/privacy', String(link)]) {
    await page.goto(path);
    await appearance('light');
  }
  await activate(page.getByRole('button', { name: 'Dark mode', exact: true }));
  await page.emulateMedia({ colorScheme: 'light' });
  for (const path of ['/start', '/access', '/terms', '/privacy', '/me']) {
    await page.goto(path);
    await appearance('dark');
  }
});

test('theme selection works across both practice layouts with their real CSP', async ({ page }) => {
  const preview = 'http://127.0.0.1:8790';
  const root = page.locator('html');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${preview}/unblock`);
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await activate(page.getByRole('button', { name: 'Light mode', exact: true }));
  for (const route of ['/unblock/about', '/unblock/account', '/beliefs', '/beliefs/about', '/beliefs/account']) {
    await page.goto(preview + route);
    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toBeVisible();
  }
  await activate(page.getByRole('button', { name: 'Dark mode', exact: true }));
  await page.goto(`${preview}/unblock`);
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Light mode', exact: true })).toBeVisible();
});

test('a stale private form does not overwrite newer saved goals', async ({ page, request }, testInfo) => {
  const phone = testInfo.project.name === 'chromium' ? '+4792140101' : '+4792140201';
  await fixture(request, 'seed', { phone });
  await signIn(page, request, phone);
  await page.goto('/memory');
  await page.locator('#goals').fill('This older tab must not overwrite the new goal.');
  await fixture(request, 'revision', { phone });
  await activate(page.locator('button[value="save"]'));
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
  await activate(page.locator('button[value="cancel-renewal"]'));
  expect((await fixture(request, 'state', { phone })).cancellations).toBe(0);
  await activate(page.locator('button[value="cancel-renewal-confirm"]'));
  // Wait for the submitted page to finish before testing persistence on reload.
  await expect(page.getByRole('status')).toContainText('Renewal is cancelled.');
  await page.reload();
  const result = await fixture(request, 'state', { phone });
  expect(result.caller).toMatchObject({ cancel_at_period_end: true, billing_status: 'active' });
  expect(result.cancellations).toBe(1);
});
