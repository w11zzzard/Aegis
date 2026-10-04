import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createApi } from './api';
import { SummaryPanels } from './SummaryPanels';
import { stats, policyStatus, notRun, completed } from './summary-fixtures';
function transport(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => new Response(JSON.stringify(overrides[url] ?? ({ '/api/session': { profile: 'authenticated', user: 'security_admin_1', role: 'SECURITY_ADMIN', can_observe: true, can_admin: true }, '/api/stats': stats, '/api/policies/status': policyStatus, '/api/redteam/results': notRun, '/api/redteam/run': completed } as Record<string, unknown>)[url])));
}
it('does not query global security summaries for a regular authenticated user', async () => {
  const fetcher = transport({ '/api/session': { profile: 'authenticated', user: 'manager_1', role: 'PORTFOLIO_MANAGER', can_observe: false, can_admin: false } });
  render(<SummaryPanels api={createApi('', fetcher)} />);
  expect(await screen.findByText(/Global security summaries require/)).toBeVisible();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/session']);
  expect(screen.queryByRole('button', { name: 'Run red-team' })).not.toBeInTheDocument();
});
it('allows explicit demo observations but hides unauthenticated administrative actions', async () => {
  render(<SummaryPanels api={createApi('', transport({ '/api/session': { profile: 'local-demo', user: null, role: null, can_observe: true, can_admin: false } }))} />);
  expect(await screen.findByText('Not run')).toBeVisible();
  expect(screen.getByText(/Synthetic local demo/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Run red-team' })).not.toBeInTheDocument();
});
it('shows unavailable latency, aggregate character units, policies and not-run honestly', async () => {
  render(<SummaryPanels api={createApi('', transport())} />);
  expect(await screen.findByText('Not run')).toBeVisible();
  expect(screen.getByText('Unavailable — no latency samples')).toBeVisible();
  expect(screen.getByText(/Aggregate usage across all users/)).toBeVisible();
  expect(screen.getByText(/Conservative character units/)).toBeVisible();
  expect(screen.getByText(/Policy evaluation available/)).toBeVisible();
});
it('shows unloaded policy as unavailable despite a previous version, and red-team failure', async () => {
  render(<SummaryPanels api={createApi('', transport({ '/api/policies/status': { ...policyStatus, loaded: false, error: 'Policy invalid' }, '/api/redteam/results': { ...notRun, status: 'failed', error: 'Corpus unavailable' } }))} />);
  expect(await screen.findByText('Policy evaluation unavailable')).toBeVisible();
  expect(await screen.findByText('Failed')).toBeVisible();
  expect(screen.getByText('Corpus unavailable')).toBeVisible();
});
it('runs the endpoint and clears previous success on a failed refresh', async () => {
  const fetcher = transport();
  render(<SummaryPanels api={createApi('', fetcher)} />);
  await screen.findByText('Not run');
  await userEvent.click(screen.getByRole('button', { name: 'Run red-team' }));
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(screen.getByText(/Shell denied/)).toBeVisible();
  fetcher.mockRejectedValue(new TypeError('offline'));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh summaries' }));
  expect(await screen.findAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  expect(screen.queryByText('Policy evaluation available')).not.toBeInTheDocument();
  expect(screen.queryByText(/Shell denied/)).not.toBeInTheDocument();
});

it('does not restore an old completed run when the run request fails', async () => {
  const fetcher = transport({ '/api/redteam/results': completed });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async url => url === '/api/redteam/run' ? new Response('', { status: 503 }) : original(url));
  render(<SummaryPanels api={createApi('', fetcher)} />);
  await screen.findByText('Completed');
  await userEvent.click(screen.getByRole('button', { name: 'Run red-team' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Completed')).not.toBeInTheDocument();
});
it('shows initial errors without invented summaries', async () => {
  render(<SummaryPanels api={createApi('', vi.fn().mockRejectedValue(new TypeError()))} />);
  expect(await screen.findAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByText('Not run')).not.toBeInTheDocument();
});
it('shows real sampled latency and empty completed result state', async () => {
  const data = { ...stats, latency_ms: { samples: 1, mean: 0.25, max: 0.25 } };
  render(<SummaryPanels api={createApi('', transport({ '/api/stats': data, '/api/redteam/results': { ...completed, total: 0, passed: 0, results: [] } }))} />);
  expect(await screen.findByText('Mean 0.25 ms · max 0.25 ms · 1 samples')).toBeVisible();
  expect(screen.getByText('No case results returned')).toBeVisible();
});
it('retrieves the backend failed status after a failed run instead of retaining a successful run', async () => {
  const fetcher = transport({ '/api/redteam/results': completed });
  const original = fetcher.getMockImplementation()!;
  let failed = false;
  fetcher.mockImplementation(async url => {
    if (url === '/api/redteam/run') { failed = true; return new Response('Private corpus error', { status: 503 }); }
    if (url === '/api/redteam/results' && failed) return new Response(JSON.stringify({ ...notRun, status: 'failed', error: 'Corpus invalid' }));
    return original(url);
  });
  render(<SummaryPanels api={createApi('', fetcher)} />);
  await screen.findByText('Completed');
  await userEvent.click(screen.getByRole('button', { name: 'Run red-team' }));
  expect(await screen.findByText('Failed')).toBeVisible();
  expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503');
  expect(screen.queryByText('Private corpus error')).not.toBeInTheDocument();
});
