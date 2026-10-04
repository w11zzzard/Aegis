import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { normalizeEvent, normalizeEvents } from './adapter';
import { event, result } from './test-fixtures';
import type { EvaluateRequest } from './types';

describe('typed backend adapter', () => {
  it('accepts sanitized events, omits benign extras and rejects restricted payloads', () => {
    expect(normalizeEvent({ ...event, evidence_class: 'protected' })).toEqual(event);
    expect(() => normalizeEvent({ ...event, prompt: 'secret', output: 'restricted' })).toThrow(/contract/i);
  });
  it('supports a direct list and an explicit events envelope', () => {
    expect(normalizeEvents([event])).toEqual([event]);
    expect(normalizeEvents({ events: [event] })).toEqual([event]);
  });
  it('preserves unknown fields as absent, including measured latency', () => {
    expect(normalizeEvent({ ...event, user: null, action: null }).user).toBeUndefined();
  });
  it.each([{ ...event, decision: 'DENY' }, { ...event, classification: 'SECRET' }, { ...event, latency_ms: -1 }, {}, { ...event, latency_ms: '2.8' }])('rejects incompatible data %j', (value) => {
    expect(() => normalizeEvent(value)).toThrow(/contract/i);
  });
  it('rejects an unrecognized event envelope instead of inventing an empty list', () => {
    expect(() => normalizeEvents({ data: [] })).toThrow(/contract/i);
  });
});

describe('API requests', () => {
  it('calls all eight endpoints with correct methods, encoded IDs and bodies', async () => {
    const responses = [[event], { ...event, id: 'a/b' }, stats, policyStatus, result, completed, notRun, { id: 'a/b', status: 'denied', resolved_by: 'security_admin_1', executed: false }];
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(responses.shift())));
    const api = createApi('http://localhost:8000/', fetcher);
    const request: EvaluateRequest = { user: 'analyst_42', role: 'ANALYST', action: 'read', resource: event.resource, classification: 'RESTRICTED', destination: 'INTERNAL' };
    expect(await api.events()).toEqual([event]);
    expect(await api.event('a/b')).toEqual({ ...event, id: 'a/b' });
    expect(await api.stats()).toEqual(stats);
    expect(await api.policyStatus()).toEqual(policyStatus);
    expect(await api.evaluate(request)).toEqual(result);
    await api.runRedteam(); await api.redteamResults(); await api.resolveApproval('a/b', { approve: false });
    expect(fetcher.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['http://localhost:8000/api/events', 'GET'], ['http://localhost:8000/api/events/a%2Fb', 'GET'],
      ['http://localhost:8000/api/stats', 'GET'], ['http://localhost:8000/api/policies/status', 'GET'],
      ['http://localhost:8000/api/security/evaluate', 'POST'], ['http://localhost:8000/api/redteam/run', 'POST'],
      ['http://localhost:8000/api/redteam/results', 'GET'], ['http://localhost:8000/api/approvals/a%2Fb', 'POST']
    ]);
    expect(JSON.parse(fetcher.mock.calls[4][1].body)).toEqual(request);
    expect(JSON.parse(fetcher.mock.calls[7][1].body)).toEqual({ approve: false });
  });
  it('surfaces network failure without a fallback', async () => {
    const api = createApi('', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.events()).rejects.toThrow(/backend unreachable/i);
  });
  it('reports HTTP failures without exposing raw response contents', async () => {
    const api = createApi('', vi.fn().mockResolvedValue(new Response('private trace', { status: 503 })));
    await expect(api.events()).rejects.toThrow('HTTP 503');
  });
  it('explains how to recover from a development proxy 500 when the backend is offline', async () => {
    const api = createApi('', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(api.events()).rejects.toThrow(/check the api server and proxy/i);
  });
  it('reports malformed JSON and malformed decisions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<html>')).mockResolvedValueOnce(new Response(JSON.stringify({ ...result, decision: 'DENY' })));
    const api = createApi('', fetcher);
    await expect(api.events()).rejects.toThrow(/contract/i);
    await expect(api.evaluate({ user: 'a', role: 'ANALYST', action: 'read', resource: 'a', classification: 'PUBLIC', destination: 'INTERNAL' })).rejects.toThrow(/contract/i);
  });
  it('rejects a detail response for a different event ID', async () => {
    const api = createApi('', vi.fn().mockResolvedValue(new Response(JSON.stringify(event))));
    await expect(api.event('other')).rejects.toThrow(/contract/i);
  });
  it('times out and reports aborts as unavailable', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const promise = createApi('', fetcher).events();
    const assertion = expect(promise).rejects.toThrow(/backend unreachable/i);
    await vi.advanceTimersByTimeAsync(10000); await assertion;
    vi.useRealTimers();
  });
});
import { stats, policyStatus, completed, notRun } from './summary-fixtures';
