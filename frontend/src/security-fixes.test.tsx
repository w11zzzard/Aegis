import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { createApi, setSessionToken } from './api';
import { ContractError, normalizeEvent, normalizeEvents, normalizeJson } from './adapter';
import { EventDetails } from './components';
import { event } from './test-fixtures';

describe('security remediation', () => {
  it('rejects the original valid 1000-row reproduction and oversized reasons', () => {
    expect(() => normalizeEvents(Array.from({ length: 1000 }, () => event))).toThrow(ContractError);
    expect(() => normalizeEvent({ ...event, reason: 'x'.repeat(4096) })).toThrow(ContractError);
    expect(normalizeEvents(Array.from({ length: 100 }, () => event))).toHaveLength(100);
  });
  it('rejects advertised and streamed response bodies above 512 KiB', async () => {
    const advertised = createApi('', async () => new Response('[]', { headers: { 'Content-Length': '524289' } }));
    await expect(advertised.events()).rejects.toBeInstanceOf(ContractError);
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(524289)); }, cancel });
    await expect(createApi('', async () => new Response(stream)).events()).rejects.toBeInstanceOf(ContractError);
    expect(cancel).toHaveBeenCalled();
  });
  it.each(['AbortError', 'TypeError'])('reports %s during body reads as transport failure', async name => {
    const stream = new ReadableStream({ start(controller) { controller.error(new DOMException('synthetic failure', name)); } });
    await expect(createApi('', async () => new Response(stream)).events()).rejects.toThrow(/backend unreachable/i);
  });
  it('enforces timeout during a stalled response body even if the transport ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream();
      const promise = createApi('', async () => new Response(stream)).events();
      const assertion = expect(promise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('uses the agreed approval body and bearer header without cookie credentials', async () => {
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('{}'));
    await createApi('', transport, () => 'synthetic-test-credential').resolveApproval('synthetic/id', { approve: true });
    const options = transport.mock.calls[0][1];
    expect(options.headers).toHaveProperty('Authorization', 'Bearer synthetic-test-credential');
    expect(options.headers).not.toHaveProperty('X-Aegis-User');
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toEqual({ approve: true });
  });
  it('renders resolution actor and correlation as text', () => {
    render(<EventDetails event={normalizeEvent({ ...event, actor: 'security_admin_1', approval_id: 'synthetic-approval' })} />);
    expect(screen.getByText('security_admin_1')).toBeInTheDocument();
    expect(screen.getByText('synthetic-approval')).toBeInTheDocument();
  });
  it('bounds miscellaneous JSON depth, node counts and strings', () => {
    expect(() => normalizeJson('x'.repeat(16001))).toThrow(ContractError);
    expect(() => normalizeJson(Array(10001).fill(0))).toThrow(ContractError);
    let deep: unknown = {};
    for (let i = 0; i < 18; i++) deep = { nested: deep };
    expect(() => normalizeJson(deep)).toThrow(ContractError);
    expect(normalizeJson({ total: 16 })).toEqual({ total: 16 });
  });
  it('keeps the dashboard credential in memory and clears it on disconnect', async () => {
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('{"events":[]}'));
    vi.stubGlobal('fetch', transport);
    const persistentWrite = vi.spyOn(Storage.prototype, 'setItem');
    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText('API credential'), { target: { value: 'synthetic-test-credential' } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(screen.getByLabelText('API credential')).toHaveValue('');
      await createApi('', transport).events();
      expect(transport.mock.lastCall?.[1].headers).toHaveProperty('Authorization', 'Bearer synthetic-test-credential');
      expect(persistentWrite).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      await createApi('', transport).events();
      expect(transport.mock.lastCall?.[1].headers).not.toHaveProperty('Authorization');
    } finally { setSessionToken(''); }
  });
});
