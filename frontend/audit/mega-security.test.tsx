// Isolated characterization of the audited revision; no application behavior changed.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createApi } from '../src/api';
import { ContractError, normalizeEvent, normalizeEvents } from '../src/adapter';
import { EventDetails, SecurityEventTable } from '../src/components';
import { event } from '../src/test-fixtures';

describe('mega security audit evidence', () => {
  it('accepts 1000 structurally valid rows with long reasons', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ ...event, id: `synthetic-${i}`, reason: 'x'.repeat(4096) }));
    expect(normalizeEvents(rows)).toHaveLength(1000);
    expect(normalizeEvents(rows)[0].reason).toHaveLength(4096);
  });
  it('renders untrusted audit strings as text without HTML execution', () => {
    const payload = '<img data-aegis-audit-xss="1" src=x onerror="alert(1)"><svg onload="alert(1)">';
    const value = normalizeEvent({ ...event, reason: payload, resource: payload });
    render(<><SecurityEventTable events={[value]} selectedId={null} onSelect={() => undefined} /><EventDetails event={value} /></>);
    expect(screen.getAllByText(payload).length).toBeGreaterThan(1);
    expect(document.querySelector('[data-aegis-audit-xss]')).toBeNull();
  });
  it('does not accept prototype-like extras into the event view model', () => {
    const value = normalizeEvent(JSON.parse(JSON.stringify(event).replace(/}$/, ',"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}')));
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(value).not.toHaveProperty('polluted');
    expect(value).not.toHaveProperty('__proto__.polluted');
  });
  it('keeps body aborts classified as contract errors in the current implementation', async () => {
    const transport = vi.fn(async () => ({ ok: true, json: async () => { throw new DOMException('Synthetic abort', 'AbortError'); } }) as Response);
    await expect(createApi('', transport).events()).rejects.toBeInstanceOf(ContractError);
  });
  it('sends the provisional approval body and no authenticated identity header', async () => {
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('{}'));
    await createApi('', transport).resolveApproval('synthetic-id', { decision: 'approve' });
    const options = transport.mock.calls[0][1];
    expect(JSON.parse(options.body as string)).toEqual({ decision: 'approve' });
    expect(options.headers).not.toHaveProperty('X-Aegis-User');
  });
  it('uses same-origin browser credentials unless an authentication design is added', async () => {
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('[]'));
    await createApi('https://api.example.invalid', transport).events();
    const [url, options] = transport.mock.calls[0];
    expect(new Request(url, options).credentials).toBe('same-origin');
  });
  it('strips content payloads and rejects unknown decisions', () => {
    expect(normalizeEvent({ ...event, prompt: 'SYNTHETIC', output: 'SYNTHETIC' })).not.toHaveProperty('output');
    expect(() => normalizeEvent({ ...event, decision: 'BYPASS' })).toThrow(ContractError);
  });
});
