import { expect, test } from 'vitest';
// @ts-expect-error Independent Node HTTP acceptance script.
import { liveCheck } from '../scripts/live-check.mjs';
test('real backend decisions, policies, audit identity and nullable context', async () => {
  const evidence = await liveCheck();
  expect(evidence.evidence).toHaveLength(5);
  expect(evidence.nullableEvent).toBeTruthy();
});
