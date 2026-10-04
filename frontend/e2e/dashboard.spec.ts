import { test, expect } from '@playwright/test';
import { event, result } from '../src/test-fixtures';
import { stats, policyStatus, notRun } from '../src/summary-fixtures';

test('judge reaches the live evaluation first and sees aligned evidence at desktop and mobile widths', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { profile: 'local-demo', user: null, role: null, can_observe: true, can_admin: false } }));
  await page.route('**/api/events', route => route.fulfill({ json: { events: [] } }));
  await page.route('**/api/stats', route => route.fulfill({ json: stats }));
  await page.route('**/api/policies/status', route => route.fulfill({ json: policyStatus }));
  await page.route('**/api/redteam/results', route => route.fulfill({ json: notRun }));
  await page.route('**/api/security/evaluate', route => route.fulfill({ json: result }));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const consoleSection = page.locator('#console');
    const auditSection = page.locator('#audit');
    expect(await consoleSection.evaluate(element => element.compareDocumentPosition(document.querySelector('#audit')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    await page.getByRole('link', { name: 'Try the live policy check' }).click();
    await expect(page).toHaveURL(/#console$/);
    await expect(page.getByRole('button', { name: 'Evaluate proposal' })).toBeVisible();
    await page.getByLabel('Demo scenario').selectOption('analyst');
    await page.getByRole('button', { name: 'Evaluate proposal' }).click();
    await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText('BLOCK');
    await expect(page.getByRole('region', { name: 'Security summaries' })).toBeVisible();
    const leftEdges = await page.evaluate(() => ({ console: document.querySelector('#console')!.getBoundingClientRect().left, summary: document.querySelector('[aria-label="Security summaries"]')!.getBoundingClientRect().left }));
    expect(Math.abs(leftEdges.console - leftEdges.summary)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(auditSection).toBeVisible();
  }
});

test('backend event → selected detail → actual evaluation → audited refresh', async ({ page }) => {
  // Isolated browser test transport. Application has no mock mode.
  await page.route('**/api/session', route => route.fulfill({ json: { profile: 'local-demo', user: null, role: null, can_observe: true, can_admin: false } }));
  await page.route('**/api/events', route => route.fulfill({ json: [event] }));
  await page.route('**/api/stats', route => route.fulfill({ json: stats }));
  await page.route('**/api/policies/status', route => route.fulfill({ json: policyStatus }));
  await page.route('**/api/redteam/results', route => route.fulfill({ json: notRun }));
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
  await expect(page.getByRole('alert').first()).toContainText('Backend unreachable');
  await expect(page.getByRole('button', { name: 'Inspect event-1' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
