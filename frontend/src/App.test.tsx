import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import App from './App';
import { createApi } from './api';
import { event, result } from './test-fixtures';
// Audit/evaluation tests isolate summary transports; summary journeys are tested separately.
vi.mock('./SummaryPanels', () => ({ SummaryPanels: () => null }));

function serve(handler: (url: string, options: RequestInit) => unknown) {
  const fetcher = vi.fn(async (url: string, options: RequestInit) => new Response(JSON.stringify(handler(url, options))));
  render(<App api={createApi('', fetcher)} />);
  return fetcher;
}

describe('real-evidence dashboard journeys', () => {
  it('loads events, selects a row and displays backend event details', async () => {
    const fetcher = serve(url => url === '/api/events' ? [event] : { ...event, reason: 'Detail from backend' });
    await userEvent.click(await screen.findByRole('button', { name: /inspect event-1/i }));
    const details = await screen.findByRole('region', { name: 'Event details' });
    await within(details).findByText('Detail from backend');
    for (const value of ['analyst_42', 'ANALYST', 'read', event.resource, 'RESTRICTED', 'INTERNAL', 'BLOCK', event.policy, '2.8 ms']) {
      expect(within(details).getByText(value, { exact: true })).toBeVisible();
    }
    expect(fetcher).toHaveBeenCalledWith('/api/events/event-1', expect.anything());
  });
  it('shows absent fields as Not reported, never a guessed action or zero latency', async () => {
    const missing = { ...event, id: 'missing', decision: 'REQUIRE_APPROVAL', user: null, role: null, action: null, resource: null, classification: null, destination: null, request_id: null };
    serve(url => url === '/api/events' ? [missing] : missing);
    await userEvent.click(await screen.findByRole('button', { name: /inspect missing/i }));
    const details = await screen.findByRole('region', { name: 'Event details' });
    expect(await within(details).findAllByText('Not reported')).not.toHaveLength(0);
    expect(within(details).queryByText('0 ms')).not.toBeInTheDocument();
  });
  it('has an honest empty state', async () => {
    serve(() => []);
    expect(await screen.findByText('No audit events returned by the backend.')).toBeVisible();
  });
  it('shows backend offline and recovers on explicit refresh', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError()).mockResolvedValue(new Response(JSON.stringify([event])));
    render(<App api={createApi('', fetcher)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend unreachable/i);
    expect(screen.queryByText(event.user)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
    expect(await screen.findByRole('button', { name: /inspect event-1/i })).toBeVisible();
  });
  it('clears old rows when a refresh fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([event]))).mockRejectedValue(new TypeError());
    render(<App api={createApi('', fetcher)} />);
    await screen.findByRole('button', { name: /inspect event-1/i });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /inspect event-1/i })).not.toBeInTheDocument();
  });
  it('reports event-detail errors without showing another event', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([event]))).mockRejectedValue(new TypeError());
    render(<App api={createApi('', fetcher)} />);
    await userEvent.click(await screen.findByRole('button', { name: /inspect event-1/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend unreachable/i);
    expect(screen.queryByRole('region', { name: 'Event details' })).not.toBeInTheDocument();
  });
  it('does not let an old detail response replace a newer selection', async () => {
    let resolveOld!: (response: Response) => void;
    const other = { ...event, id: 'event-2', reason: 'Latest selection' };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([event, other])))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify(other)));
    render(<App api={createApi('', fetcher)} />);
    await userEvent.click(await screen.findByRole('button', { name: /inspect event-1/i }));
    await userEvent.click(screen.getByRole('button', { name: /inspect event-2/i }));
    await within(await screen.findByRole('region', { name: 'Event details' })).findByText('Latest selection');
    await act(async () => { resolveOld(new Response(JSON.stringify(event))); });
    expect(screen.getByRole('region', { name: 'Event details' })).toHaveTextContent('Latest selection');
  });
  it('submits all five proposals to the backend and shows actual decisions, not scenario expectations', async () => {
    const fetcher = serve((url) => url === '/api/events' ? [] : { ...result, decision: 'REDACT', reason: 'Actual backend reason' });
    const scenario = screen.getByLabelText('Demo scenario');
    for (const id of ['normal', 'analyst', 'manager', 'external', 'tool']) {
      await userEvent.selectOptions(scenario, id);
      expect(screen.queryByText('Actual backend reason')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
      expect(await screen.findByText('Actual backend reason')).toBeVisible();
      expect(screen.getByRole('region', { name: 'Evaluation result' })).toHaveTextContent('REDACT');
    }
    const posts = fetcher.mock.calls.filter(([url]) => url === '/api/security/evaluate').map(([, options]) => JSON.parse(options.body as string));
    expect(posts).toHaveLength(5);
    expect(posts[1]).toMatchObject({ role: 'ANALYST', resource: 'portfolio/current_positions' });
    expect(posts[2]).toMatchObject({ role: 'PORTFOLIO_MANAGER', resource: 'portfolio/current_positions' });
    expect(posts[3]).toMatchObject({ classification: 'RESTRICTED', destination: 'EXTERNAL' });
    expect(posts[4]).toHaveProperty('tool_arguments');
    expect(fetcher.mock.calls.every(([url]) => ['/api/events', '/api/security/evaluate'].includes(url))).toBe(true);
  });
  it('shows evaluation failure without keeping a previous success', async () => {
    let posts = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/events') return new Response('[]');
      if (++posts === 1) return new Response(JSON.stringify(result));
      throw new TypeError();
    });
    render(<App api={createApi('', fetcher)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    await screen.findByRole('region', { name: 'Evaluation result' });
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/backend unreachable/i);
    expect(screen.queryByRole('region', { name: 'Evaluation result' })).not.toBeInTheDocument();
  });
  it('opens the actual audit event returned by evaluation', async () => {
    serve(url => url === '/api/events' ? [] : url === '/api/security/evaluate' ? result : event);
    await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect audited event' }));
    expect(await screen.findByRole('region', { name: 'Event details' })).toHaveTextContent(event.policy);
  });
});
