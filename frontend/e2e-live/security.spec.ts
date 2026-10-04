import { expect, test } from '@playwright/test';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';

test('real policy reload, failure/recovery and weakened-policy corpus render honestly', async ({ page }) => {
  const configuredPath = process.env.AEGIS_SECURITY_POLICY_PATH;
  const adminToken = process.env.AEGIS_CHECK_ADMIN_TOKEN;
  test.skip(!configuredPath || !adminToken, 'Use the security verifier to supply a task-owned disposable policy and admin credential.');
  test.setTimeout(45000);
  const policyPath = resolve(configuredPath!);
  expect(policyPath.startsWith(resolve('../output/security-audit') + sep)).toBe(true);
  expect(basename(policyPath)).toMatch(/^browser-policy-[a-f0-9]{16}\.yaml$/);
  const original = await readFile(policyPath, 'utf8');
  expect(original).toContain('roles: [PORTFOLIO_MANAGER]');
  async function replacePolicy(text: string) {
    await writeFile(policyPath + '.pending', text);
    await rename(policyPath + '.pending', policyPath);
  }
  async function evaluate(decision: string, policy: string) {
    await page.getByRole('button', { name: 'Evaluate proposal' }).click();
    const result = page.getByRole('region', { name: 'Evaluation result' });
    await expect(result.locator('.decision')).toHaveText(decision);
    await expect(result.locator('.result-fields')).toContainText(policy);
  }
  try {
    await page.goto('/');
    await page.getByLabel('Demo scenario').selectOption('analyst');
    await evaluate('BLOCK', 'portfolio_restricted');
    await replacePolicy(original.replace('roles: [PORTFOLIO_MANAGER]', 'roles: [PORTFOLIO_MANAGER, ANALYST]'));
    await evaluate('ALLOW', 'portfolio_restricted');
    await page.getByLabel('API credential').fill(adminToken!);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Run red-team' }).waitFor();
    const firstRunAt = Date.now();
    const runResponse = page.waitForResponse(response => response.url().endsWith('/api/redteam/run') && response.request().method() === 'POST').then(response => response.json());
    const [run] = await Promise.all([runResponse, page.getByRole('button', { name: 'Run red-team' }).click()]);
    expect([run.passed, run.failed, run.unexpected_allows]).toEqual([15, 1, 1]);
    const evidence = page.getByRole('region', { name: 'Red-team evidence' });
    await expect(evidence).toContainText('15 passed · 1 failed · 1 unexpected allows');
    await expect(evidence).toContainText('One or more cases failed.');
    await expect(evidence).toContainText('expected BLOCK, actual ALLOW');
    await evidence.screenshot({ path: 'test-results/cp1-weakened-corpus.png' });
    // Public demo diagnostics remain observable during an invalid policy;
    // authenticated identities cannot be verified until the registry recovers.
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await replacePolicy('resources: [invalid');
    await page.getByRole('button', { name: 'Refresh summaries' }).click();
    const readiness = page.getByRole('region', { name: 'Policy status' });
    await expect(readiness).toContainText('Policy evaluation unavailable');
    await expect(readiness).toContainText('Previous version: demo-v1');
    await expect(readiness).not.toContainText('Policy evaluation available');
    await evaluate('BLOCK', 'fail_closed');
    await readiness.screenshot({ path: 'test-results/cp1-invalid-policy.png' });
    await replacePolicy(original);
    // Disconnect intentionally remounts and resets the proposal console.
    await page.getByLabel('Demo scenario').selectOption('analyst');
    await evaluate('BLOCK', 'portfolio_restricted');
    await page.getByLabel('Demo scenario').selectOption('manager');
    await evaluate('ALLOW', 'portfolio_restricted');
    await page.getByRole('button', { name: 'Refresh summaries' }).click();
    await expect(readiness).toContainText('Policy evaluation available');
    await page.getByLabel('API credential').fill(adminToken!);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Run red-team' }).waitFor();
    await page.waitForTimeout(Math.max(0, 10500 - (Date.now() - firstRunAt)));
    await page.getByRole('button', { name: 'Run red-team' }).click();
    await expect(evidence).toContainText('16 passed · 0 failed · 0 unexpected allows');
    await evidence.screenshot({ path: 'test-results/cp1-recovered-corpus.png' });
    console.log('CP1 REAL BROWSER: actual weakened policy 15/16, 1 unexpected ALLOW; invalid-policy readiness and fail_closed BLOCK; repaired policy restores analyst BLOCK, manager ALLOW and real 16/16 corpus');
  } finally {
    await replacePolicy(original);
  }
});
