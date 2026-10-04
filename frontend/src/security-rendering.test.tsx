import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createApi } from './api';
import { EvaluationConsole } from './components';
import { result } from './test-fixtures';

it('renders permitted untrusted output as text without HTML or script execution', async () => {
  const hostile = '<img src=x onerror="window.AEGIS_XSS=1"><script>window.AEGIS_XSS=1</script>';
  const api = createApi('', async () => new Response(JSON.stringify({ ...result, decision: 'ALLOW', sanitized_output: hostile })));
  const { container } = render(<EvaluationConsole api={api} onEvaluated={vi.fn()} onInspect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Evaluate proposal' }));
  const region = await screen.findByRole('region', { name: 'Evaluation result' });
  expect(within(region).queryByText(hostile)).not.toBeInTheDocument();
  expect(container.querySelector('img,script')).toBeNull();
  expect('AEGIS_XSS' in window).toBe(false);
});
