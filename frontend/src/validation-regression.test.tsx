import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createApi } from './api';
import { EvaluationConsole } from './components';
import { result } from './test-fixtures';
import { scenarios } from './scenarios';

it.each([422, 413])('retains HTTP %i and navigation for a sanitized validation BLOCK', async status => {
  const failure = { ...result, policy: 'fail_closed', reason: status === 422 ? 'Malformed request' : 'Request body too large' };
  const api = createApi('', async () => new Response(JSON.stringify(failure), { status }));
  expect(await api.evaluate(scenarios[0].request)).toEqual({ ...failure, http_status: status });
  const inspect = vi.fn();
  render(<EvaluationConsole api={api} onEvaluated={vi.fn()} onInspect={inspect} />);
  await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
  const region = await screen.findByRole('region', { name: 'Evaluation result' });
  expect(within(region).getByText(new RegExp('HTTP ' + status))).toBeVisible();
  expect(region).toHaveTextContent('BLOCK');
  await userEvent.click(within(region).getByRole('button', { name: 'Inspect audited event' }));
  expect(inspect).toHaveBeenCalledWith(result.event_id);
});

it.each([
  { ...result, decision: 'ALLOW', policy: 'fail_closed', reason: 'Malformed request' },
  { ...result, policy: 'portfolio_restricted', reason: 'Malformed request' },
  { ...result, policy: 'fail_closed', reason: 'private error trace' },
  { detail: 'private error trace' },
])('rejects arbitrary 422 bodies without exposing them: %j', async body => {
  const api = createApi('', async () => new Response(JSON.stringify(body), { status: 422 }));
  await expect(api.evaluate(scenarios[0].request)).rejects.toThrow(/contract/i);
});

it('does not trust error status fields returned inside a successful JSON body', async () => {
  const api = createApi('', async () => new Response(JSON.stringify({ ...result, http_status: 422 })));
  expect(await api.evaluate(scenarios[0].request)).not.toHaveProperty('http_status');
});
