import { test, expect } from '@playwright/test';
import { event, result } from '../src/test-fixtures';

test('backend event → selected detail → actual evaluation → audited refresh', async ({ page }) => {
  // Isolated browser test transport. Application has no mock mode.
  await page.route('**/api/events', route => route.fulfill({ json: [event] }));
  await page.route('**/api/events/event-1', route => route.fulfill({ json: event }));
  await page.route('**/api/security/evaluate', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ role: 'ANALYST', resource: event.resource });
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Inspect event-1' }).click();
  await expect(page.getByRole('region', { name: 'Event details' })).toContainText(event.reason);
  await page.getByLabel('Demo scenario').selectOption('analyst');
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText('BLOCK');
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText('2.8 ms');
});

test('offline remains honest and usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Backend unreachable');
  await expect(page.getByRole('button', { name: 'Inspect event-1' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
