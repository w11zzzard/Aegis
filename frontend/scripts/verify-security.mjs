// Fresh loopback services and synthetic credentials; no existing service is used.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.AEGIS_EVIDENCE_DIR || path.join(root, 'docs/security-review/2026-10-04');
const python = process.env.AEGIS_TEST_PYTHON || path.join(root, 'backend/.venv/Scripts/python.exe');
const tokens = Object.fromEntries(['manager_1', 'security_admin_1'].map(user => [user, randomBytes(32).toString('base64url')]));
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
const children = [];
let browser;
const hostile = http.createServer((_request, response) => response.end('<!doctype html><title>Synthetic untrusted origin</title>'));
let backendPort;
const dist = path.join(root, 'frontend/dist');
const frontend = http.createServer(async (request, response) => {
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
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Unavailable'); }
});

async function startBackend(profile, port, frontendOrigin) {
  const statePath = path.join(root, 'output/security-audit', `verify-${randomBytes(8).toString('hex')}.sqlite3`);
  const processHandle = spawn(python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(port), '--no-access-log'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AEGIS_PROFILE: profile, AEGIS_AUTH_FILE: '', AEGIS_AUTH_TOKENS: JSON.stringify(tokens),
      AEGIS_STATE_PATH: profile === 'authenticated' ? statePath : '', AEGIS_POLICY_PATH: path.join(root, 'policies/default.yaml'),
      AEGIS_ALLOWED_HOSTS: '127.0.0.1,localhost', AEGIS_ALLOWED_ORIGINS: frontendOrigin },
  });
  children.push(processHandle);
  let failure;
  let started = false;
  processHandle.once('error', error => { failure = error; });
  // Drain logs without publishing environment values or response payloads.
  processHandle.stdout.on('data', () => {});
  processHandle.stderr.on('data', data => { if (String(data).includes(`Uvicorn running on http://127.0.0.1:${port}`)) started = true; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failure) throw failure;
    if (processHandle.exitCode !== null) throw new Error('Dedicated backend failed to start');
    try { if (started && (await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Dedicated backend readiness timeout');
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
  const adminHeaders = { Authorization: 'Bearer ' + tokens.security_admin_1 };
  assert.equal((await fetch(base + '/api/events')).status, 401);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
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
  await page.goto(`http://127.0.0.1:${frontendPort}`);
  await page.getByLabel('API credential').fill(tokens.manager_1);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
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
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'HTTP 401' }).waitFor();

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
  await writeFile(path.join(evidenceDir, 'frontend-integration.log'), integration.output);
  assert.equal(integration.code, 0);
  const evidence = { browser: await browser.version(), hostileResponse, hostileRunStatus: before.status,
    authenticatedRedteam: { total: run.total, passed: run.passed, failed: run.failed },
    dashboard: 'PASS: authenticated manager evaluation, own event detail, action, disconnect', storage,
    frontendIntegrationExit: integration.code, scope: 'Fresh loopback HTTP services; production TLS/identity-provider/runtime deployment not verified.' };
  await writeFile(path.join(evidenceDir, 'browser-verification.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (browser) await browser.close();
  for (const child of children) if (child.exitCode === null) child.kill();
  await close(hostile); await close(frontend);
}
