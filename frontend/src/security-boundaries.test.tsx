import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { createApi, setSessionToken } from './api';
import { ContractError, normalizeEvent, normalizeEvaluation } from './adapter';
import { event, result } from './test-fixtures';

const encoded = (value: unknown) => new Response(JSON.stringify(value));

describe('browser security boundary invariants', () => {
  it('renders attacker-controlled audit and evaluation strings as inert text and omits content extras', async () => {
    const payload = '<img data-aegis-xss="1" src=x onerror="alert(1)">';
    const raw = { ...event, resource: payload, reason: payload, actor: payload };
    const fetcher = vi.fn(async (url: string) => encoded(url === '/api/events' ? { events: [raw] } : url === '/api/security/evaluate' ? { ...result, decision: 'REDACT', reason: payload, sanitized_output: 'SYNTHETIC_SANITIZED_CONTENT' } : raw));
    render(<App api={createApi('', fetcher)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Inspect event-1' }));
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(within(detail).getAllByText(payload)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    expect(await screen.findByRole('region', { name: 'Evaluation result' })).toHaveTextContent(payload);
    expect(document.querySelector('[data-aegis-xss]')).toBeNull();
    for (const content of ['SYNTHETIC_RAW_PROMPT', 'SYNTHETIC_RAW_OUTPUT', 'SYNTHETIC_TOOL_CONTENT', 'SYNTHETIC_SANITIZED_CONTENT']) expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it('drops prototype-like response fields without prototype pollution', () => {
    const extras = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    expect(normalizeEvent({ ...event, ...extras })).toEqual(event);
    expect(normalizeEvaluation({ ...result, ...extras })).toEqual(result);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each(['ALLOW', 'BLOCK', 'REDACT', 'REQUIRE_APPROVAL', 'THROTTLE'])('preserves canonical %s decisions without inventing an allow', decision => {
    expect(normalizeEvent({ ...event, decision }).decision).toBe(decision);
    expect(normalizeEvaluation({ ...result, decision }).decision).toBe(decision);
  });

  it.each(['malformed', 'sensitive', 'http-error', 'offline'])('clears successful evaluation evidence after %s failure', async mode => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/events') return encoded({ events: [] });
      if (++calls === 1) return encoded({ ...result, decision: 'ALLOW' });
      if (mode === 'malformed') return encoded({ ...result, decision: 'BYPASS', output: 'SYNTHETIC_PRIVATE_ERROR' });
      if (mode === 'sensitive') return encoded({ ...result, decision: 'ALLOW', output: 'SYNTHETIC_PRIVATE_ERROR' });
      if (mode === 'http-error') return new Response('SYNTHETIC_PRIVATE_ERROR', { status: 503 });
      throw new Error('SYNTHETIC_PRIVATE_ERROR');
    });
    render(<App api={createApi('', fetcher)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    expect(await screen.findByRole('region', { name: 'Evaluation result' })).toHaveTextContent('ALLOW');
    await user.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Evaluation result' })).not.toBeInTheDocument();
    expect(screen.queryByText('SYNTHETIC_PRIVATE_ERROR')).not.toBeInTheDocument();
  });

  it('clears both audit rows and selected detail if a later feed is malformed', async () => {
    let feeds = 0;
    const fetcher = vi.fn(async (url: string) => encoded(url === '/api/events' ? ++feeds === 1 ? { events: [event] } : { events: [{ ...event, decision: 'BYPASS' }] } : event));
    render(<App api={createApi('', fetcher)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Inspect event-1' }));
    await screen.findByRole('region', { name: 'Event details' });
    await user.click(screen.getByRole('button', { name: 'Refresh events' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend contract error');
    expect(screen.queryByRole('button', { name: 'Inspect event-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Event details' })).not.toBeInTheDocument();
  });

  it('refuses a malformed detail instead of retaining a previously selected event', async () => {
    const other = { ...event, id: 'event-2' };
    const fetcher = vi.fn(async (url: string) => encoded(url === '/api/events' ? [event, other] : url.endsWith('event-1') ? event : { ...other, reason: 'x'.repeat(1025) }));
    render(<App api={createApi('', fetcher)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Inspect event-1' }));
    await screen.findByRole('region', { name: 'Event details' });
    await user.click(screen.getByRole('button', { name: 'Inspect event-2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend contract error');
    expect(screen.queryByRole('region', { name: 'Event details' })).not.toBeInTheDocument();
  });

  it('invalidates pending credential-bound feed, detail and evaluation responses on disconnect', async () => {
    let resolveFeed!: (response: Response) => void;
    let resolveDetail!: (response: Response) => void;
    let resolveEvaluation!: (response: Response) => void;
    let authenticatedFeeds = 0;
    const fetcher = vi.fn((url: string, options: RequestInit) => {
      const authenticated = new Headers(options.headers).has('Authorization');
      if (url === '/api/events') {
        if (!authenticated) return Promise.resolve(encoded({ events: [] }));
        if (++authenticatedFeeds === 1) return Promise.resolve(encoded({ events: [event] }));
        return new Promise<Response>(resolve => { resolveFeed = resolve; });
      }
      if (url.startsWith('/api/events/')) return new Promise<Response>(resolve => { resolveDetail = resolve; });
      return new Promise<Response>(resolve => { resolveEvaluation = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    setSessionToken('');
    try {
      render(<App />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('API credential'), 'SYNTHETIC_TEST_CREDENTIAL');
      await user.click(screen.getByRole('button', { name: 'Connect' }));
      await user.click(await screen.findByRole('button', { name: 'Inspect event-1' }));
      await user.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
      await user.click(screen.getByRole('button', { name: 'Refresh events' }));
      await user.click(screen.getByRole('button', { name: 'Disconnect' }));
      await screen.findByText('No audit events returned by the backend.');
      await act(async () => {
        resolveFeed(encoded({ events: [event] }));
        resolveDetail(encoded(event));
        resolveEvaluation(encoded({ ...result, decision: 'ALLOW' }));
      });
      expect(screen.queryByRole('button', { name: 'Inspect event-1' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Event details' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Evaluation result' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('API credential')).toHaveValue('');
      expect(new Headers(fetcher.mock.lastCall?.[1].headers).has('Authorization')).toBe(false);
    } finally { setSessionToken(''); }
  });

  it.each([NaN, Infinity, -Infinity, -1])('refuses nonfinite or negative latency %s', latency_ms => {
    expect(() => normalizeEvent({ ...event, latency_ms })).toThrow(ContractError);
    expect(() => normalizeEvaluation({ ...result, latency_ms })).toThrow(ContractError);
  });
});
