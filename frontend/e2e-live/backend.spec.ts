import { test, expect } from '@playwright/test';
import { scenarios } from '../src/scenarios';
test('real gateway journey and nullable audit inspection without interception', async ({ page }) => {
  await page.goto('/');
  const evidence = [];
  for (const scenario of scenarios) {
    await page.getByLabel('Demo scenario').selectOption(scenario.id);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/security/evaluate') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Evaluate proposal' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const actual = await response.json();
    expect(actual.decision).toBe(scenario.expected);
    expect(actual.policy).toBe(scenario.expectedPolicy);
    evidence.push({ scenario: scenario.id, ...actual });
    const result = page.getByRole('region', { name: 'Evaluation result' });
    await expect(result.locator('.decision')).toHaveText(scenario.expected);
    await expect(result.locator('.result-fields')).toContainText(scenario.expectedPolicy);
    if (scenario.id === 'redact') {
      await expect(result).toContainText('[REDACTED]');
      await expect(result).not.toContainText('sk-AEGISSYNTHETIC');
    }
    await expect(page.getByRole('button', { name: 'Inspect ' + actual.event_id, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect audited event' }).click();
    const details = page.getByRole('region', { name: 'Event details' });
    await expect(details.locator('.detail-id')).toHaveText(actual.event_id);
    await expect(details.locator('.reason-box p')).toHaveText(actual.reason);
    await expect(details).toContainText(scenario.expectedPolicy);
    await expect(details).toContainText('read');
    if (scenario.id === 'analyst') await details.screenshot({ path: 'test-results/live-analyst-detail.png' });
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
  await expect(detail.locator('.detail-id')).toHaveText(event_id);
  await expect(page.getByRole('region', { name: 'Policy status' })).toContainText('Policy evaluation available');
  await expect(page.getByRole('region', { name: 'Decisions and budget' })).toContainText('Aggregate usage');
  await page.getByRole('button', { name: 'Run red-team' }).click();
  await expect(page.getByRole('region', { name: 'Red-team evidence' })).toContainText('Completed');
  await expect(page.getByRole('region', { name: 'Red-team evidence' })).toContainText('16 passed');
  await page.screenshot({ path: 'test-results/live-integrated.png', fullPage: true });
  await page.getByRole('region', { name: 'Security summaries' }).screenshot({ path: 'test-results/live-summaries.png' });
  console.log('REAL BROWSER EVIDENCE: ' + JSON.stringify({ scenarios: evidence, nullable_event_id: event_id }));
  console.log('REAL BROWSER PASS: nullable audit ' + event_id + ', seven decision/policy pairs, summary panels and real corpus');
});

test('fresh two-request quota shows ALLOW, ALLOW, then THROTTLE in the real browser', async ({ page }) => {
  const quotaUrl = process.env.AEGIS_QUOTA_FRONTEND_URL;
  test.skip(!quotaUrl, 'Supply a fresh isolated two-request backend and frontend URL for the quota journey.');
  await page.goto(quotaUrl!);
  await page.getByLabel('Demo scenario').selectOption('manager');
  const evidence = [];
  for (const [decision, policy] of [['ALLOW', 'portfolio_restricted'], ['ALLOW', 'portfolio_restricted'], ['THROTTLE', 'budget']]) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/security/evaluate') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Evaluate proposal' }).click();
    const actual = await (await responsePromise).json();
    expect([actual.decision, actual.policy]).toEqual([decision, policy]);
    const result = page.getByRole('region', { name: 'Evaluation result' });
    await expect(result.locator('.decision')).toHaveText(decision);
    await expect(result.locator('.result-fields')).toContainText(policy);
    await expect(page.getByRole('button', { name: 'Inspect ' + actual.event_id, exact: true })).toBeVisible();
    evidence.push(actual);
  }
  await expect(page.getByRole('region', { name: 'Decisions and budget' })).toContainText('Per-user limits: 2 requests');
  console.log('REAL QUOTA BROWSER EVIDENCE: ' + JSON.stringify(evidence));
});
