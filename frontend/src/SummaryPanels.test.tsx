import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createApi } from './api';
import { SummaryPanels } from './SummaryPanels';
import { stats, policyStatus, notRun, completed } from './summary-fixtures';
function transport(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => new Response(JSON.stringify(overrides[url] ?? ({ '/api/stats': stats, '/api/policies/status': policyStatus, '/api/redteam/results': notRun, '/api/redteam/run': completed } as Record<string, unknown>)[url])));
}
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
it('runs real endpoint, shows completed cases, and labels previous values stale on failed refresh', async () => {
  const fetcher = transport();
  render(<SummaryPanels api={createApi('', fetcher)} />);
  await screen.findByText('Not run');
  await userEvent.click(screen.getByRole('button', { name: 'Run red-team' }));
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(screen.getByText(/Shell denied/)).toBeVisible();
  fetcher.mockRejectedValue(new TypeError('offline'));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh summaries' }));
  expect(await screen.findAllByText(/Stale — previous backend snapshot/)).toHaveLength(3);
  expect(screen.getAllByRole('alert')).toHaveLength(3);
});
it('shows initial errors without invented summaries', async () => {
  render(<SummaryPanels api={createApi('', vi.fn().mockRejectedValue(new TypeError()))} />);
  expect(await screen.findAllByRole('alert')).toHaveLength(3);
  expect(screen.queryByText('Not run')).not.toBeInTheDocument();
});
it('shows real sampled latency and empty completed result state', async () => {
  const data = { ...stats, latency_ms: { samples: 1, mean: 0.25, max: 0.25 } };
  render(<SummaryPanels api={createApi('', transport({ '/api/stats': data, '/api/redteam/results': { ...completed, total: 0, passed: 0, results: [] } }))} />);
  expect(await screen.findByText('Mean 0.25 ms · max 0.25 ms · 1 samples')).toBeVisible();
  expect(screen.getByText('No case results returned')).toBeVisible();
});
