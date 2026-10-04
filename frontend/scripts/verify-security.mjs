// Fresh loopback services and synthetic credentials; no existing service is used.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { captureJsonResponse } from './browser-response.mjs';
import { observeApiRequests } from './browser-network.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.AEGIS_EVIDENCE_DIR || path.join(root, 'output/release-verification');
const python = process.env.AEGIS_TEST_PYTHON || path.join(root, 'backend/.venv/Scripts/python.exe');
const offlineGuard = process.env.AEGIS_OFFLINE_GUARD === '1';
const evidencePrefix = offlineGuard ? 'frontend-offline' : 'frontend-live';
const pythonGuardProbes = [];
const tokens = Object.fromEntries(['manager_1', 'security_admin_1'].map(user => [user, randomBytes(32).toString('base64url')]));
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
const children = [];
let browser;
let evidence;
const startedAt = new Date().toISOString();
const hostile = http.createServer((_request, response) => response.end('<!doctype html><title>Synthetic untrusted origin</title>'));
const guardedBrowserBlocks = [];
const offlineProxy = http.createServer((request, response) => {
  guardedBrowserBlocks.push(new URL(request.url).origin);
  response.writeHead(403, { Connection: 'close' }); response.end();
});
offlineProxy.on('connect', (request, socket) => {
  guardedBrowserBlocks.push(new URL('https://' + request.url).origin);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
let backendPort;
const dist = path.join(root, 'frontend/dist');
const frontend = http.createServer(async (request, response) => {
  // This owned fixture server has no favicon asset; avoid a browser-generated
  // 404 unrelated to the application's security or asset loading.
  if (request.url === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
  if (request.url.startsWith('/api/')) {
    const proxy = http.request({ hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method, headers: request.headers }, upstream => {
      response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
    });
    proxy.on('error', () => { response.statusCode = 502; response.end('Unavailable'); });
    request.pipe(proxy); return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(dist + path.sep)) throw new Error('Invalid path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Unavailable'); }
});

async function startBackend(profile, port, frontendOrigin, policyPath = path.join(root, 'policies/default.yaml')) {
  const statePath = path.join(root, 'output/security-audit', `verify-${randomBytes(8).toString('hex')}.sqlite3`);
  const args = offlineGuard ? [path.join(root, 'frontend/scripts/offline-guard.py'), String(port)] : ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(port), '--workers', '1', '--no-access-log'];
  const processHandle = spawn(python, args, {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONPATH: root, AEGIS_PROFILE: profile, AEGIS_AUTH_FILE: '', AEGIS_AUTH_TOKENS: JSON.stringify(tokens),
      AEGIS_STATE_PATH: profile === 'authenticated' ? statePath : '', AEGIS_POLICY_PATH: policyPath,
      AEGIS_ALLOWED_HOSTS: '127.0.0.1,localhost', AEGIS_ALLOWED_ORIGINS: frontendOrigin },
  });
  children.push(processHandle);
  let failure;
  let started = false;
  processHandle.once('error', error => { failure = error; });
  // Drain logs without publishing environment values or response payloads.
  processHandle.stdout.on('data', () => {});
  processHandle.stderr.on('data', data => {
    if (String(data).includes(`Uvicorn running on http://127.0.0.1:${port}`)) started = true;
    if (String(data).includes('AEGIS_OFFLINE_GUARD_SELF_PROBE_PASS')) pythonGuardProbes.push({ pid: processHandle.pid, dnsAndConnectBlocked: true });
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failure) throw failure;
    if (processHandle.exitCode !== null) throw new Error('Dedicated backend failed to start');
    try { if (started && (await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Dedicated backend readiness timeout');
}

async function verifyBuildPreview(targetPort) {
  const probe = http.createServer(); const port = await listen(probe); await close(probe);
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.join(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AEGIS_BACKEND_URL: `http://127.0.0.1:${targetPort}`, VITE_API_BASE_URL: '' },
  });
  children.push(child);
  let failure;
  child.once('error', error => { failure = error; });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error('Dedicated preview failed to start');
    let response;
    try { response = await fetch(`http://127.0.0.1:${port}/`); } catch {}
    if (response) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
      await response.body?.cancel();
      const session = await fetch(`http://127.0.0.1:${port}/api/session`, { headers: { Authorization: 'Bearer ' + tokens.manager_1 } });
      assert.equal(session.status, 200, 'Build preview must proxy protected API requests');
      assert.deepEqual(await session.json(), { profile: 'authenticated', user: 'manager_1', role: 'PORTFOLIO_MANAGER', can_observe: false, can_admin: false });
      return { servedBuild: true, securityHeaders: true, authenticatedApiProxy: true };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Dedicated preview readiness timeout');
}

try {
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(path.join(root, 'output/security-audit'), { recursive: true });
  const backendProbe = http.createServer();
  backendPort = await listen(backendProbe); await close(backendProbe);
  const hostilePort = await listen(hostile);
  const frontendPort = await listen(frontend);
  const base = `http://127.0.0.1:${backendPort}`;
  await startBackend('authenticated', backendPort, `http://127.0.0.1:${frontendPort}`);
  const buildPreview = await verifyBuildPreview(backendPort);
  const adminHeaders = { Authorization: 'Bearer ' + tokens.security_admin_1 };
  assert.equal((await fetch(base + '/api/events')).status, 401);
  const offlineProxyPort = offlineGuard ? await listen(offlineProxy) : null;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true,
    ...(offlineGuard ? { proxy: { server: `http://127.0.0.1:${offlineProxyPort}`, bypass: '127.0.0.1,localhost,[::1]' } } : {}) });
  const context = await browser.newContext();
  if (offlineGuard) {
    const probePage = await context.newPage();
    await assert.rejects(probePage.goto('https://aegis-owned-negative.invalid/'), /ERR_TUNNEL_CONNECTION_FAILED/);
    assert.ok(guardedBrowserBlocks.includes('https://aegis-owned-negative.invalid'));
    await probePage.close();
  }
  const page = await context.newPage();
  const apiTransfers = observeApiRequests(page);
  async function settleDashboard() {
    // React may launch follow-up summaries/events after evaluation. Wait for
    // their rendered loading states and actual current transfers, not the
    // document's already-fired networkidle event.
    await expect(page.getByRole('button', { name: 'Refresh events', exact: true })).toBeEnabled();
    await expect(page.getByText('Checking summary access…', { exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await apiTransfers.waitForIdle();
  }
  const pageErrors = [];
  const networkFailures = [];
  const consoleErrors = [];
  const externalRequests = [];
  const responseStatuses = new Map();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('response', response => responseStatuses.set(response.request(), response.status()));
  page.on('requestfailed', request => networkFailures.push({ path: new URL(request.url()).pathname, status: responseStatuses.get(request), failure: request.failure()?.errorText }));
  page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(url.origin); });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text().replace(/data:[^\s]+/g, 'data:[REDACTED_ASSET]'));
  });
  await page.goto(`http://127.0.0.1:${hostilePort}`);
  const hostileResponse = await page.evaluate(async target => {
    const response = await fetch(target + '/api/redteam/run', { method: 'POST', mode: 'no-cors' });
    return { type: response.type, status: response.status };
  }, base);
  const beforeResponse = await fetch(base + '/api/redteam/results', { headers: adminHeaders });
  assert.equal(beforeResponse.status, 200, 'Admin red-team results HTTP status');
  const before = await beforeResponse.json();
  assert.equal(before.status, 'not_run');
  const runResponse = await fetch(base + '/api/redteam/run', { method: 'POST', headers: adminHeaders });
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json(); assert.equal(run.passed, 16); assert.equal(run.failed, 0);
  assert.equal((await fetch(base + '/api/redteam/run', { method: 'POST', headers: adminHeaders })).status, 429);
  const hostileConsoleErrors = consoleErrors.splice(0);
  assert.ok(hostileConsoleErrors.every(message => /^Failed to load resource: the server responded with a status of 403\b/.test(message)));
  await page.goto(`http://127.0.0.1:${frontendPort}`);
  await page.getByRole('alert').filter({ hasText: '/api/events (HTTP 401)' }).waitFor();
  await page.getByRole('alert').filter({ hasText: '/api/session (HTTP 401)' }).waitFor();
  await page.getByLabel('API credential').fill(tokens.manager_1);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText(/Global security summaries require/).waitFor();
  await expect(page.getByRole('button', { name: 'Run red-team' })).toHaveCount(0);
  await page.getByLabel('Demo scenario').selectOption('manager');
  await page.getByRole('button', { name: 'Evaluate proposal', exact: true }).click();
  const result = page.getByRole('region', { name: 'Evaluation result' });
  await result.getByText('ALLOW', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Inspect audited event' }).click();
  const detail = page.getByRole('region', { name: 'Event details' });
  await detail.getByText('manager_1', { exact: true }).waitFor();
  await detail.getByText('read', { exact: true }).waitFor();
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  assert.deepEqual(storage, { local: 0, session: 0 });
  await settleDashboard();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '/api/events (HTTP 401)' }).waitFor();
  await expect(result).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  await expect(page.getByLabel('API credential')).toHaveValue('');
  // An administrator can observe global summaries without granting business
  // resource access to regular credentials or retaining the previous session.
  await page.getByRole('alert').filter({ hasText: '/api/session (HTTP 401)' }).waitFor();
  await page.getByLabel('API credential').fill(tokens.security_admin_1);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Decisions and budget' })).toContainText('lifetime decisions');
  await expect(page.getByRole('region', { name: 'Red-team evidence' })).toContainText('16 passed · 0 failed');
  await expect(page.getByRole('button', { name: 'Run red-team' })).toBeVisible();
  await settleDashboard();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '/api/events (HTTP 401)' }).waitFor();
  await page.getByRole('alert').filter({ hasText: '/api/session (HTTP 401)' }).waitFor();
  await expect(page.getByRole('region', { name: 'Decisions and budget' })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-disconnected-375.png`), fullPage: true });

  const manager = { user: 'manager_1', role: 'PORTFOLIO_MANAGER', action: 'read', resource: 'portfolio/current_positions', classification: 'RESTRICTED', destination: 'INTERNAL' };
  const syntheticSecret = 'sk-AEGISSYNTHETIC01234567890123456789';
  const leaked = await fetch(base + '/api/security/evaluate', { method: 'POST', headers: { ...adminHeaders, Authorization: 'Bearer ' + tokens.manager_1, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...manager, output: 'Synthetic output ' + syntheticSecret }) });
  assert.equal(leaked.status, 200);
  const redacted = await leaked.json();
  assert.equal(redacted.decision, 'REDACT');
  assert.ok(redacted.sanitized_output.includes('[REDACTED]'));
  assert.ok(!JSON.stringify(redacted).includes(syntheticSecret));
  const denied = await fetch(base + '/api/security/evaluate', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.manager_1, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...manager, destination: 'EXTERNAL', output: syntheticSecret }) });
  const deniedResult = await denied.json();
  assert.equal(denied.status, 200);
  assert.equal(deniedResult.decision, 'BLOCK');
  assert.equal(deniedResult.policy, 'external_exfiltration');
  assert.ok(!('sanitized_output' in deniedResult));
  const sensitiveAudit = await (await fetch(base + '/api/events', { headers: adminHeaders })).json();
  assert.ok(!JSON.stringify(sensitiveAudit).includes(syntheticSecret));

  // Preserve the separate simulation acceptance check on a fresh explicit demo.
  const demoProbe = http.createServer(); const demoPort = await listen(demoProbe); await close(demoProbe);
  await startBackend('local-demo', demoPort, `http://127.0.0.1:${frontendPort}`);
  const integration = await new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.live.config.ts', '--configLoader=runner'], {
      cwd: path.join(root, 'frontend'), windowsHide: true, env: { ...process.env, AEGIS_API_URL: `http://127.0.0.1:${demoPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child); child.once('error', reject);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.once('exit', code => resolve({ code, output }));
  });
  await writeFile(path.join(evidenceDir, offlineGuard ? 'frontend-offline-integration.log' : 'frontend-integration.log'), integration.output);
  assert.equal(integration.code, 0);

  // A second real browser journey through the same-origin proxy, without routes,
  // mocked responses or a network connection to an external service.
  // Its own fresh demo prevents preceding HTTP/integration evidence from using
  // the demo's bounded rejection-telemetry sampling allowance.
  const browserProbe = http.createServer(); const browserPort = await listen(browserProbe); await close(browserProbe);
  await startBackend('local-demo', browserPort, `http://127.0.0.1:${frontendPort}`);
  await settleDashboard();
  backendPort = browserPort;
  await page.goto(`http://127.0.0.1:${frontendPort}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  const liveCases = [];
  for (const [scenario, decision, policy] of [['normal', 'ALLOW', 'market_public'], ['analyst', 'BLOCK', 'portfolio_restricted'], ['manager', 'ALLOW', 'portfolio_restricted'], ['external', 'BLOCK', 'external_exfiltration'], ['tool', 'BLOCK', 'tool_guard']]) {
    await page.getByLabel('Demo scenario').selectOption(scenario);
    await page.getByRole('button', { name: 'Evaluate proposal', exact: true }).focus();
    const actual = await captureJsonResponse(page,
      response => response.url().endsWith('/api/security/evaluate') && response.request().method() === 'POST',
      () => page.keyboard.press('Enter'));
    assert.equal(actual.decision, decision); assert.equal(actual.policy, policy);
    await expect(result.locator('.decision')).toHaveText(decision);
    await expect(result.locator('.reason-box p')).toHaveText(actual.reason);
    await page.getByRole('button', { name: 'Inspect audited event' }).click();
    await expect(detail.locator('.detail-id')).toHaveText(actual.event_id);
    await expect(detail.locator('.reason-box p')).toHaveText(actual.reason);
    await expect(detail.locator('.decision')).toHaveText(decision);
    await expect(page.getByRole('button', { name: 'Inspect ' + actual.event_id, exact: true })).toBeVisible();
    await settleDashboard();
    await expect(page.getByRole('alert')).toHaveCount(0);
    liveCases.push({ scenario, decision, policy, event_id: actual.event_id });
  }
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await expect(page.getByLabel('API credential')).toHaveValue('');
    await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-security-${width}.png`), fullPage: true });
  }

  // Serial real-browser policy lifecycle checks use only this run's own copy.
  // Run separately from the native-proxy offline journey below.
  let lifecycleExit = null;
  await settleDashboard();
  if (!offlineGuard) {
    const lifecyclePolicyPath = path.join(root, 'output/security-audit', `browser-policy-${randomBytes(8).toString('hex')}.yaml`);
    await writeFile(lifecyclePolicyPath, await readFile(path.join(root, 'policies/default.yaml')));
    const lifecycleProbe = http.createServer(); const lifecyclePort = await listen(lifecycleProbe); await close(lifecycleProbe);
    await startBackend('local-demo', lifecyclePort, `http://127.0.0.1:${frontendPort}`, lifecyclePolicyPath);
    backendPort = lifecyclePort;
    const lifecycle = await new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--reporter=line'], {
        cwd: path.join(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AEGIS_REAL_BROWSER: '1', AEGIS_FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
          AEGIS_SECURITY_POLICY_PATH: lifecyclePolicyPath, AEGIS_CHECK_ADMIN_TOKEN: tokens.security_admin_1 },
      });
      children.push(child); child.once('error', reject);
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.once('exit', code => resolve({ code, output }));
    });
    await writeFile(path.join(evidenceDir, 'frontend-policy-lifecycle.log'), lifecycle.output);
    const lifecycleOutput = lifecycle.output.replaceAll(tokens.security_admin_1, '[REDACTED]').slice(-12000);
    assert.equal(lifecycle.code, 0, `Real browser policy lifecycle must pass. Subprocess output:\n${lifecycleOutput}`);
    assert.deepEqual(await readFile(lifecyclePolicyPath), await readFile(path.join(root, 'policies/default.yaml')), 'Disposable policy restored');
    lifecycleExit = lifecycle.code;
  }

  const quotaPolicyPath = path.join(root, 'output/security-audit', `browser-quota-${randomBytes(8).toString('hex')}.yaml`);
  const originalPolicy = await readFile(path.join(root, 'policies/default.yaml'), 'utf8');
  assert.ok(originalPolicy.includes('requests: 60'));
  await writeFile(quotaPolicyPath, originalPolicy.replace('requests: 60', 'requests: 2'));
  const quotaProbe = http.createServer(); const quotaPort = await listen(quotaProbe); await close(quotaProbe);
  await startBackend('local-demo', quotaPort, `http://127.0.0.1:${frontendPort}`, quotaPolicyPath);
  await settleDashboard();
  backendPort = quotaPort;
  await page.goto(`http://127.0.0.1:${frontendPort}`);
  await page.getByLabel('Demo scenario').selectOption('manager');
  const quotaDecisions = [];
  for (const decision of ['ALLOW', 'ALLOW', 'THROTTLE']) {
    const actual = await captureJsonResponse(page,
      response => response.url().endsWith('/api/security/evaluate') && response.request().method() === 'POST',
      () => page.getByRole('button', { name: 'Evaluate proposal', exact: true }).click());
    assert.equal(actual.decision, decision);
    assert.ok(!('sanitized_output' in actual));
    await expect(result.locator('.decision')).toHaveText(decision);
    await page.getByRole('button', { name: 'Inspect audited event' }).click();
    await expect(detail.locator('.detail-id')).toHaveText(actual.event_id);
    await expect(detail.locator('.reason-box p')).toHaveText(actual.reason);
    quotaDecisions.push(decision);
    await settleDashboard();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-quota-375.png`), fullPage: true });
  await settleDashboard();
  const rendered = await page.locator('body').innerText();
  for (const secret of [...Object.values(tokens), syntheticSecret]) assert.ok(!rendered.includes(secret));
  assert.deepEqual(pageErrors, []);
  const expectedCancellations = networkFailures.filter(request => (['/api/events', '/api/session'].includes(request.path) && request.status === 401) || (request.path === '/api/redteam/run' && request.status === 403));
  assert.deepEqual(networkFailures.filter(request => !expectedCancellations.includes(request)), []);
  assert.deepEqual(externalRequests, []);
  // Anonymous initial/disconnect 401s are required refusals, not hidden failures.
  assert.deepEqual(consoleErrors.filter(message => !/^Failed to load resource: the server responded with a status of 401\b/.test(message)), []);
  if (offlineGuard) assert.equal(pythonGuardProbes.length, 4);
  const sourcePaths = ['frontend/src/adapter.ts', 'frontend/src/api.ts', 'frontend/src/App.tsx', 'frontend/src/SummaryPanels.tsx', 'frontend/src/schemas.ts', 'frontend/src/components.tsx', 'frontend/src/scenarios.ts', 'frontend/e2e-live/security.spec.ts', 'frontend/vite.config.ts', 'frontend/scripts/verify-security.mjs', 'frontend/scripts/browser-response.mjs', 'frontend/scripts/browser-network.mjs', 'frontend/scripts/offline-guard.py', 'backend/main.py', 'backend/security.py', 'backend/state.py', 'backend/credentials.py', 'backend/live_check.py', 'backend/guards.py', 'backend/redteam.py', 'policies/default.yaml'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
  evidence = { startedAt, completedAt: new Date().toISOString(), timezone: 'Europe/Warsaw', browser: await browser.version(), hostileResponse, hostileRunStatus: before.status,
    authenticatedRedteam: { total: run.total, passed: run.passed, failed: run.failed },
    dashboard: 'PASS: authenticated manager evaluation, own event detail, action; admin-only summaries; disconnect clears results, detail and global summaries', storage,
    outputSecrecy: { permitted: redacted.decision, restrictedExternal: deniedResult.decision, auditContainsSecret: false },
    liveCases, freshQuota: quotaDecisions, browserResponsesIntercepted: false,
    offlineGuard: { enabled: offlineGuard, browserRequestRouting: 'None', browserNetworkBoundary: offlineGuard ? 'Browser-native loopback refusing proxy; exact loopback bypass; no forwarding or API interception' : 'None', guardedBrowserBlocks: [...new Set(guardedBrowserBlocks)], pythonGuardProbes },
    pageErrors, networkFailures: [], expectedDeniedResponseCancellations: expectedCancellations, expected401ConsoleErrors: consoleErrors.length, expectedHostile403ConsoleErrors: hostileConsoleErrors.length, otherConsoleErrors: 0, externalRequests,
    frontendIntegrationExit: integration.code, policyLifecycleExit: lifecycleExit, buildPreview, sourceHashes,
    scope: offlineGuard ? 'Separate simulation of external-network unavailability after locked prerequisites: browser-native refusing loopback proxy with exact loopback bypass, and per-child Python DNS/connect audit hook; self-probes blocked before outbound networking and actual owned loopback journeys succeeded without API interception. No host firewall/global disconnect or offline installation claim. Production TLS/identity-provider/runtime deployment, axe, screen-reader, CWV and visual baseline comparison not verified.' : 'Fresh loopback HTTP services after locked prerequisites; observer recorded no external browser requests. This normal journey has no request/response routing. Offline installation, production TLS/identity-provider/runtime deployment, axe, screen-reader, CWV and visual baseline comparison not verified.' };
} finally {
  if (browser) await browser.close();
  const shutdown = await Promise.all(children.map(async child => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); timer.unref(); })]);
      assert.equal(stopped, true, 'Owned process must stop');
    }
    return { pid: child.pid, stopped: child.exitCode !== null || child.signalCode !== null };
  }));
  await close(hostile); await close(frontend);
  if (offlineProxy.listening) await close(offlineProxy);
  if (evidence) {
    evidence.cleanup = { ownedProcesses: shutdown, ownedServersClosed: true };
    await writeFile(path.join(evidenceDir, offlineGuard ? 'frontend-offline-browser-verification.json' : 'frontend-real-browser-verification.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
}
