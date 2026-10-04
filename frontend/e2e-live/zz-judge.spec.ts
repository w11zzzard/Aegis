import { expect, test } from '@playwright/test';

test('five-minute judge walkthrough uses real decisions and matching audit events', async ({ page }) => {
  test.setTimeout(45000);
  const cases = [
    ['normal', 'ALLOW', 'market_public'],
    ['analyst', 'BLOCK', 'portfolio_restricted'],
    ['manager', 'ALLOW', 'portfolio_restricted'],
  ] as const;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('link', { name: 'Try the live policy check' }).click();
    for (const [index, [scenario, decision, policy]] of cases.entries()) {
      await page.getByLabel('Demo scenario').selectOption(scenario);
      await page.getByRole('button', { name: 'Evaluate proposal', exact: true }).click();
      const result = page.getByRole('region', { name: 'Evaluation result' });
      await expect(result.locator('.decision')).toHaveText(decision);
      await expect(result.locator('.result-fields')).toContainText(policy);
      if (index < 3) {
        const eventId = await result.locator('.result-fields dd').last().innerText();
        await page.getByRole('button', { name: 'Inspect audited event' }).click();
        const detail = page.getByRole('region', { name: 'Event details' });
        await expect(detail.locator('.detail-id')).toHaveText(eventId);
        if (width === 375) await expect(detail).toBeInViewport({ ratio: 0.1 });
      }
      await expect(page.getByRole('region', { name: 'Put the policy to the test.' }).getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'The audit trail.' }).getByRole('alert')).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});
