import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvaluationConsole } from './components';
import { createApi } from './api';
import { scenarios } from './scenarios';
import { result } from './test-fixtures';
it('provides authorized synthetic REDACT and budget THROTTLE proposals', () => {
  expect(scenarios.find(value => value.id === 'redact')).toMatchObject({ expected: 'REDACT', expectedPolicy: 'output_secrets', request: { user: 'analyst_42', action: 'read', resource: 'public/market_summary', classification: 'PUBLIC' } });
  expect(scenarios.find(value => value.id === 'throttle')).toMatchObject({ expected: 'THROTTLE', expectedPolicy: 'budget', request: { estimated_tokens: 1000000 } });
});
it.each(['ALLOW', 'REDACT', 'BLOCK', 'THROTTLE', 'REQUIRE_APPROVAL'])('shows sanitized output only for allowed/redacted %s responses', async decision => {
  render(<EvaluationConsole api={createApi('', async () => new Response(JSON.stringify({ ...result, decision, sanitized_output: 'SAFE_SANITIZED_VALUE' })))} onEvaluated={vi.fn()} onInspect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
  if (decision === 'ALLOW' || decision === 'REDACT') await screen.findByRole('region', { name: 'Evaluation result' });
  else expect(await screen.findByRole('alert')).toHaveTextContent(/contract/i);
  expect(screen.queryByText('SAFE_SANITIZED_VALUE')).not.toBeInTheDocument();
});
it('labels mismatched backend decision or policy instead of claiming scenario success', async () => {
  render(<EvaluationConsole api={createApi('', async () => new Response(JSON.stringify({ ...result, decision: 'ALLOW', policy: 'identity' })))} onEvaluated={vi.fn()} onInspect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
  expect(await screen.findByText(/Backend result differs from this scenario/)).toBeVisible();
});
