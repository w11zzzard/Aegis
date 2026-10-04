import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeEvent, normalizeEvents } from './adapter';
import { createApi } from './api';
import App from './App';
import { event } from './test-fixtures';
import { scenarios } from './scenarios';

export const malformedEvent = { ...event, id: 'malformed', category: 'fail_closed', policy: 'fail_closed', reason: 'Malformed request', request_id: null, user: null, role: null, action: null, resource: null, classification: null, destination: null };
const unknownActor = { ...event, id: 'unknown', user: null, request_id: null, policy: 'identity', reason: 'Unknown identity or claimed role mismatch' };
describe('backend audit regression', () => {
  it('keeps a mixed feed with request ID, nullable malformed context and unknown actor', () => {
    const events = normalizeEvents({ events: [event, malformedEvent, unknownActor] });
    expect(events).toHaveLength(3);
    expect(events[0].request_id).toBe('request-1');
    expect(events[1].user).toBeUndefined();
    expect(events[1].action).toBeUndefined();
    expect(events[2].user).toBeUndefined();
  });
  it('inspects nullable details and renders unavailable action as Not reported', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/events' ? { events: [event, malformedEvent, unknownActor] } : malformedEvent)));
    render(<App api={createApi('', fetcher)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect malformed' }));
    const region = await screen.findByRole('region', { name: 'Event details' });
    expect(within(region).getAllByText('Not reported').length).toBeGreaterThan(5);
    expect(region).toHaveTextContent('Malformed request');
  });
  it.each(['read', 'export'])('preserves documented action %s', action => expect(normalizeEvent({ ...event, action }).action).toBe(action));
  it.each([{ ...event, action: 'execute' }, { ...event, role: 'ADMIN' }, { ...event, decision: null }, { ...event, latency_ms: Infinity }, { ...event, latency_ms: -1 }, { id: 'only-id' }])('keeps required structure strict %j', value => expect(() => normalizeEvent(value)).toThrow(/contract/i));
  it('rejects untrusted output even when metadata is null', () => {
    expect(() => normalizeEvent({ ...malformedEvent, sanitized_output: 'restricted', prompt: 'secret' })).toThrow(/contract/i);
  });
});
describe('backend-aligned demo proposals', () => {
  it('uses registered identities and reaches the intended guards', () => {
    expect(scenarios.slice(0, 5).map(s => [s.request.user, s.request.resource, s.request.action, s.request.destination, s.expected, s.expectedPolicy])).toEqual([
      ['analyst_42', 'public/market_summary', 'read', 'INTERNAL', 'ALLOW', 'market_public'],
      ['analyst_42', 'portfolio/current_positions', 'read', 'INTERNAL', 'BLOCK', 'portfolio_restricted'],
      ['manager_1', 'portfolio/current_positions', 'read', 'INTERNAL', 'ALLOW', 'portfolio_restricted'],
      ['manager_1', 'portfolio/current_positions', 'read', 'EXTERNAL', 'BLOCK', 'external_exfiltration'],
      ['manager_1', 'portfolio/current_positions', 'read', 'INTERNAL', 'BLOCK', 'tool_guard'],
    ]);
  });
});
