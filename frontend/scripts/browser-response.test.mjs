import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { captureJsonResponse } from './browser-response.mjs';
import { observeApiRequests } from './browser-network.mjs';

test('captures the body while the triggering action is still pending', async () => {
  let deliver;
  let armed = false;
  let bodyRead = false;
  let actionFinished = false;
  const predicate = () => true;
  const actual = { decision: 'BLOCK', event_id: 'owned-event' };
  const page = {
    waitForResponse(match) {
      assert.equal(match, predicate);
      armed = true;
      return new Promise(resolve => { deliver = resolve; });
    },
  };
  const result = await captureJsonResponse(page, predicate, async () => {
    assert.ok(armed, 'Listener must be registered before the action');
    deliver({ json: async () => {
      assert.equal(actionFinished, false, 'Body unavailable after action/navigation');
      bodyRead = true;
      return actual;
    } });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(bodyRead, 'Read starts before action completes');
    actionFinished = true;
  });
  assert.equal(result, actual);
  assert.ok(actionFinished, 'Both capture and action must finish');
});

test('response body failures remain fatal without retrying the request', async () => {
  const failure = new SyntaxError('Invalid JSON');
  let actions = 0;
  let reads = 0;
  const page = { waitForResponse: async () => ({ json: async () => {
    reads++;
    throw failure;
  } }) };
  await assert.rejects(captureJsonResponse(page, () => true, async () => { actions++; }), error => error === failure);
  assert.equal(actions, 1);
  assert.equal(reads, 1);
});

test('response timeout and action failure are propagated', async () => {
  const timeout = new Error('Response timeout');
  await assert.rejects(captureJsonResponse({ waitForResponse: async () => { throw timeout; } }, () => true, async () => {}), error => error === timeout);
  const failure = new Error('Action failed');
  await assert.rejects(captureJsonResponse({ waitForResponse: async () => ({ json: async () => ({}) }) }, () => true, async () => { throw failure; }), error => error === failure);
});

test('retains a real browser response across navigation by the action', async () => {
  const actual = { decision: 'BLOCK', event_id: 'owned-browser-event' };
  let posts = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/security/evaluate' && request.method === 'POST') {
      posts++;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(actual));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<button type="button" onclick="fetch(\'/api/security/evaluate\', {method: \'POST\'}).then(r => r.json()).then(() => window.done = true)">Evaluate</button>');
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await captureJsonResponse(page,
      response => response.url().endsWith('/api/security/evaluate') && response.request().method() === 'POST',
      async () => {
        await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
        await page.waitForFunction(() => window.done === true);
        await page.waitForLoadState('networkidle');
        await page.goto('about:blank');
      });
    assert.deepEqual(result, actual);
    assert.equal(posts, 1, 'Evidence must come from the original browser request');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('waits for a later API body even after document networkidle fired', async () => {
  let upstream;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/stats') {
      upstream = response;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.write('{"total_events":');
    } else response.end('<!doctype html><title>Owned network lifecycle test</title>');
  });
  let browser;
  let observer;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage();
    observer = observeApiRequests(page);
    const failures = [];
    page.on('requestfailed', request => failures.push(request.failure()?.errorText));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForLoadState('networkidle');
    const headers = page.waitForResponse(response => response.url().endsWith('/api/stats'));
    await page.evaluate(() => { window.body = fetch('/api/stats').then(response => response.json()); });
    assert.equal((await headers).status(), 200);
    // The old document lifecycle wait is already satisfied, despite this body.
    await page.waitForLoadState('networkidle');
    let settled = false;
    const idle = observer.waitForIdle().then(() => { settled = true; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(settled, false, 'An HTTP 200 header is not a completed response');
    upstream.end('1}');
    assert.deepEqual(await page.evaluate(() => window.body), { total_events: 1 });
    await idle;
    await page.goto('about:blank');
    assert.deepEqual(failures, []);
  } finally {
    observer?.dispose();
    upstream?.end();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('tracks concurrent API requests until completion, without swallowing failures', async () => {
  const page = new EventEmitter();
  const observer = observeApiRequests(page);
  const request = path => ({ url: () => 'http://127.0.0.1' + path });
  const first = request('/api/events?private=do-not-record');
  const second = request('/api/events');
  const asset = request('/assets/app.js');
  const failures = [];
  page.on('requestfailed', item => failures.push(item));
  page.emit('request', first); page.emit('request', second); page.emit('request', asset);
  assert.deepEqual(observer.pendingPaths(), ['/api/events', '/api/events']);
  page.emit('response', { request: () => first, status: () => 200 });
  assert.equal(observer.pendingPaths().length, 2, 'Headers do not finish a body');
  page.emit('requestfinished', first);
  page.emit('requestfailed', second);
  await observer.waitForIdle();
  assert.deepEqual(failures, [second], 'Failure must remain observable');
  observer.dispose();
  assert.equal(page.listenerCount('request'), 0);
  assert.equal(page.listenerCount('requestfinished'), 0);
  assert.equal(page.listenerCount('requestfailed'), 1);
});

test('unfinished API transfers time out rather than permitting navigation', async () => {
  const page = new EventEmitter();
  const observer = observeApiRequests(page);
  page.emit('request', { url: () => 'http://127.0.0.1/api/stats' });
  try {
    await assert.rejects(observer.waitForIdle(50), /Current API transfers must end/);
  } finally { observer.dispose(); }
});

test('the real API client finishes a slow HTTP body without Chromium aborting it', async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/api.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
  });
  let upstream;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/events') {
      upstream = response;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.flushHeaders();
    } else response.end('<!doctype html><title>Owned real API client test</title>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage();
    const failures = [];
    page.on('requestfailed', request => failures.push(request.failure()?.errorText));
    await page.addInitScript(() => {
      const read = ReadableStreamDefaultReader.prototype.read;
      ReadableStreamDefaultReader.prototype.read = function () {
        window.readerStarted = true;
        return read.call(this);
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ type: 'module', content: bundled.outputFiles[0].text + '\nwindow.aegisApi = api;' });
    await page.waitForFunction(() => !!window.aegisApi);
    const captured = page.waitForResponse(response => response.url().endsWith('/api/events')).then(response => response.json());
    // Handle capture rejection immediately; do not hide it with a retry.
    const evidence = captured.then(data => ({ data }), error => ({ error }));
    await page.evaluate(() => { window.events = window.aegisApi.events(); });
    await page.waitForFunction(() => window.readerStarted === true);
    upstream.end('{"events":[]}');
    assert.deepEqual(await page.evaluate(() => window.events), []);
    const observed = await evidence;
    assert.equal(observed.error, undefined);
    assert.deepEqual(observed.data, { events: [] });
    assert.deepEqual(failures, []);
  } finally {
    upstream?.end();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('native completion preserves oversized, timeout and disconnect refusals', async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/api.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
  });
  let mode;
  let upstream;
  let ended;
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/events') { response.end('<title>Owned client refusals</title>'); return; }
    upstream = response;
    response.once('close', () => { ended = true; });
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.flushHeaders();
    if (mode === 'oversized') response.write(Buffer.alloc(524289, 'x'));
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage();
    await page.clock.install();
    await page.addInitScript(() => {
      const read = ReadableStreamDefaultReader.prototype.read;
      ReadableStreamDefaultReader.prototype.read = function () {
        window.readerStarted = true;
        return read.call(this);
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ type: 'module', content: bundled.outputFiles[0].text + '\nwindow.aegisApi = api; window.setCredential = setSessionToken;' });
    await page.waitForFunction(() => !!window.aegisApi);
    for (mode of ['oversized', 'timeout', 'disconnect']) {
      ended = false;
      const headers = page.waitForResponse(response => response.url().endsWith('/api/events'));
      await page.evaluate(() => {
        window.readerStarted = false;
        window.refusal = window.aegisApi.events().then(() => 'unexpected success', error => error.message);
      });
      await headers;
      await page.waitForFunction(() => window.readerStarted === true);
      if (mode === 'timeout') await page.clock.fastForward(10000);
      if (mode === 'disconnect') await page.evaluate(() => window.setCredential(''));
      const message = await page.evaluate(() => window.refusal);
      assert.match(message, mode === 'oversized' ? /contract/i : mode === 'timeout' ? /interrupted or timed out/i : /session changed/i);
      // Verify the real peer stops, not just that the client's promise rejects.
      await new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          if (ended) { clearInterval(poll); clearTimeout(watchdog); resolve(); }
        }, 10);
        const watchdog = setTimeout(() => {
          clearInterval(poll);
          reject(new Error('Unread upstream transfer did not stop'));
        }, 2000);
      });
      upstream.end();
    }
  } finally {
    upstream?.end();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
