import { test, expect } from '@playwright/test';
import { scenarios } from '../src/scenarios';
test('real gateway journey and nullable audit inspection without interception', async ({ page }) => {
  await page.goto('/');
  for (const scenario of scenarios) {
    await page.getByLabel('Demo scenario').selectOption(scenario.id);
    await page.getByRole('button', { name: 'Evaluate proposal' }).click();
    const result = page.getByRole('region', { name: 'Evaluation result' });
    await expect(result.locator('.decision')).toHaveText(scenario.expected);
    await expect(result.locator('.result-fields')).toContainText(scenario.expectedPolicy);
    if (scenario.id === 'redact') {
      await expect(result).toContainText('[REDACTED]');
      await expect(result).not.toContainText('sk-AEGISSYNTHETIC');
    }
    await page.getByRole('button', { name: 'Inspect audited event' }).click();
    await expect(page.getByRole('region', { name: 'Event details' })).toContainText(scenario.expectedPolicy);
  }
  const response = await page.request.post('/api/security/evaluate', { data: { action: 'execute' } });
  expect(response.status()).toBe(422);
  const { event_id } = await response.json();
  await page.getByRole('button', { name: 'Refresh events' }).click();
  await page.getByRole('button', { name: 'Inspect ' + event_id, exact: true }).click();
  const detail = page.getByRole('region', { name: 'Event details' });
  await expect(detail).toContainText('Not reported');
  await expect(detail).toContainText('fail_closed');
  await expect(detail.locator('.decision')).toHaveText('BLOCK');
  await expect(page.getByRole('region', { name: 'Policy status' })).toContainText('Policy evaluation available');
  await expect(page.getByRole('region', { name: 'Decisions and budget' })).toContainText('Aggregate usage');
  await page.getByRole('button', { name: 'Run red-team' }).click();
  await expect(page.getByRole('region', { name: 'Red-team evidence' })).toContainText('Completed');
  await expect(page.getByRole('region', { name: 'Red-team evidence' })).toContainText('16 passed');
  console.log('REAL BROWSER PASS: nullable audit ' + event_id + ', seven decision/policy pairs, summary panels and real corpus');
});
