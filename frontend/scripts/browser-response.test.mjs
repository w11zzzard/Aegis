import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { captureJsonResponse } from './browser-response.mjs';

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
