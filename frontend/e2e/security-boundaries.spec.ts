import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { event, result } from '../src/test-fixtures';

test('fixture security fields stay inert and content extras never reach the dashboard at three widths', async ({ page }, testInfo) => {
  const payload = '<img data-aegis-xss="1" src=x onerror="alert(1)">';
  const raw = { ...event, reason: payload, resource: payload, actor: payload };
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const dialogs: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.route('**/api/events', route => route.fulfill({ json: { events: [raw] } }));
  await page.route('**/api/events/event-1', route => route.fulfill({ json: raw }));
  await page.route('**/api/security/evaluate', route => route.fulfill({ json: { ...result, decision: 'REDACT', reason: payload, sanitized_output: 'SYNTHETIC_SANITIZED_CONTENT' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Inspect event-1' }).click();
  const detail = page.getByRole('region', { name: 'Event details' });
  await expect(detail).toContainText(payload);
  // Keyboard activation follows the same form/response path as pointer input.
  await page.getByRole('button', { name: 'Evaluate proposal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText(payload);
  await expect(page.locator('[data-aegis-xss]')).toHaveCount(0);
  for (const extra of ['SYNTHETIC_RAW_PROMPT', 'SYNTHETIC_RAW_OUTPUT', 'SYNTHETIC_TOOL_CONTENT', 'SYNTHETIC_SANITIZED_CONTENT']) await expect(page.getByText(extra, { exact: true })).toHaveCount(0);
  const evidenceDir = process.env.AEGIS_EVIDENCE_DIR || testInfo.outputPath('screenshots');
  await mkdir(evidenceDir, { recursive: true });
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Evaluation result' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `frontend-fixture-security-${width}.png`), fullPage: true });
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(dialogs).toEqual([]);
});

test('fixture malformed feed and HTTP errors clear successful detail and evaluation without reflecting private bodies', async ({ page }) => {
  let malformedFeed = false;
  let evaluations = 0;
  await page.route('**/api/events', route => route.fulfill({ json: !malformedFeed ? { events: [event] } : { events: [{ ...event, decision: 'BYPASS', output: 'SYNTHETIC_PRIVATE_RESPONSE' }] } }));
  await page.route('**/api/events/event-1', route => route.fulfill({ json: event }));
  await page.route('**/api/security/evaluate', route => ++evaluations === 1 ? route.fulfill({ json: { ...result, decision: 'ALLOW' } }) : route.fulfill({ status: 503, body: 'SYNTHETIC_PRIVATE_RESPONSE' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText('ALLOW');
  await page.getByRole('button', { name: 'Inspect event-1' }).click();
  await expect(page.getByRole('region', { name: 'Event details' })).toBeVisible();
  malformedFeed = true;
  await page.getByRole('button', { name: 'Refresh events' }).click();
  await expect(page.getByRole('alert')).toContainText('Backend contract error');
  await expect(page.getByRole('region', { name: 'Event details' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inspect event-1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'HTTP 503' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_PRIVATE_RESPONSE', { exact: true })).toHaveCount(0);
});

test('fixture credential connects only in memory and disconnect clears all sensitive views on a narrow screen', async ({ page }, testInfo) => {
  const syntheticCredential = 'SYNTHETIC_FIXTURE_CREDENTIAL';
  const sentHeaders: boolean[] = [];
  await page.route('**/api/events', route => {
    const authenticated = route.request().headers().authorization === `Bearer ${syntheticCredential}`;
    sentHeaders.push(authenticated);
    return route.fulfill({ json: { events: authenticated ? [event] : [] } });
  });
  await page.route('**/api/events/event-1', route => route.fulfill({ json: event }));
  await page.route('**/api/security/evaluate', route => route.fulfill({ json: result }));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  await page.getByLabel('API credential').fill(syntheticCredential);
  await page.getByRole('button', { name: 'Connect', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('API credential')).toHaveValue('');
  await page.getByRole('button', { name: 'Inspect event-1' }).click();
  await expect(page.getByRole('region', { name: 'Event details' })).toBeVisible();
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toBeVisible();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('No audit events returned by the backend.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Event details' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toHaveCount(0);
  await expect(page.getByLabel('API credential')).toHaveValue('');
  await expect(page.getByText(syntheticCredential, { exact: true })).toHaveCount(0);
  expect(sentHeaders).toContain(true);
  expect(sentHeaders.at(-1)).toBe(false);
  const evidenceDir = process.env.AEGIS_EVIDENCE_DIR || testInfo.outputPath('screenshots');
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, 'frontend-fixture-disconnected-375.png'), fullPage: true });
});

test('fixture sensitive response fields are rejected and clear prior successful evidence', async ({ page }) => {
  let contaminated = false;
  await page.route('**/api/events', route => route.fulfill({ json: contaminated ? { events: [event], unexpected: { Authorization: 'SYNTHETIC_PRIVATE_RESPONSE' } } : { events: [event] } }));
  await page.route('**/api/events/event-1', route => route.fulfill({ json: event }));
  await page.route('**/api/security/evaluate', route => route.fulfill({ json: contaminated ? { ...result, decision: 'ALLOW', output: 'SYNTHETIC_PRIVATE_RESPONSE' } : { ...result, decision: 'ALLOW' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toContainText('ALLOW');
  await page.getByRole('button', { name: 'Inspect event-1' }).click();
  await expect(page.getByRole('region', { name: 'Event details' })).toBeVisible();
  contaminated = true;
  await page.getByRole('button', { name: 'Refresh events' }).click();
  await expect(page.getByRole('alert')).toContainText('Backend contract error');
  await expect(page.getByRole('region', { name: 'Event details' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inspect event-1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Evaluate proposal' }).click();
  await expect(page.getByRole('region', { name: 'Evaluation result' })).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_PRIVATE_RESPONSE', { exact: true })).toHaveCount(0);
});
