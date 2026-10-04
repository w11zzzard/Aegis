import { expect, test } from 'vitest';
import { createApi } from '../src/api';
import { scenarios } from '../src/scenarios';
// @ts-expect-error Independent Node HTTP acceptance script.
import { liveCheck } from '../scripts/live-check.mjs';
test('real backend decisions, policies, audit identity and nullable context', async () => {
  const evidence = await liveCheck();
  expect(evidence.evidence).toHaveLength(5);
  expect(evidence.nullableEvent).toBeTruthy();
  const api = createApi(process.env.AEGIS_API_URL || 'http://127.0.0.1:8000');
  const mixed = await api.events();
  for (const id of [evidence.nullableEvent, evidence.ordinaryEvent, evidence.unknownEvent]) {
    const detail = await api.event(id);
    expect(mixed.find(event => event.id === id)).toEqual(detail);
    expect(detail.request_id).toBeUndefined();
  }
  expect((await api.event(evidence.nullableEvent)).user).toBeUndefined();
  expect((await api.event(evidence.unknownEvent)).user).toBeUndefined();
  for (const scenario of scenarios) {
    const result = await api.evaluate(scenario.request);
    expect(result.decision).toBe(scenario.expected);
    expect(result.policy).toBe(scenario.expectedPolicy);
    const detail = await api.event(result.event_id);
    expect(detail.id).toBe(result.event_id);
    expect(detail.reason).toBe(result.reason);
  }
});
