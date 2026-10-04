import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SecurityEventTable } from './components';
import { normalizeEvent } from './adapter';
import { event } from './test-fixtures';

it('keeps the latest five audit events visible and lets judges inspect the whole history', async () => {
  const events = Array.from({ length: 7 }, (_, index) => normalizeEvent({ ...event, id: `event-${index}` }));
  render(<SecurityEventTable events={events} selectedId={null} onSelect={vi.fn()} />);
  expect(screen.getAllByRole('button', { name: /Inspect event-/ })).toHaveLength(5);
  await userEvent.click(screen.getByRole('button', { name: 'Show all 7 events' }));
  expect(screen.getAllByRole('button', { name: /Inspect event-/ })).toHaveLength(7);
  await userEvent.click(screen.getByRole('button', { name: 'Show latest 5' }));
  expect(screen.getAllByRole('button', { name: /Inspect event-/ })).toHaveLength(5);
});
