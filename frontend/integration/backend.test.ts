import { expect, test } from 'vitest';
import { createApi } from '../src/api';
import { scenarios } from '../src/scenarios';
// @ts-expect-error Independent Node HTTP acceptance script.
import { liveCheck } from '../scripts/live-check.mjs';
const base = process.env.AEGIS_API_URL || 'http://127.0.0.1:8000';
const api = createApi(base);
test('real backend decisions, policies, audit identity and nullable context', async () => {
  const evidence = await liveCheck();
  expect(evidence.evidence).toHaveLength(5);
  const nullable = await api.event(evidence.nullableEvent);
  expect(nullable.user).toBeUndefined();
  expect(nullable.action).toBeUndefined();
  expect((await api.events()).some(event => event.id === nullable.id)).toBe(true);
  console.log('Nullable event inspected through typed adapter:', nullable.id);
});
test.each(scenarios)('typed real evaluation: $id', async scenario => {
  const request_id = 'typed-' + crypto.randomUUID();
  const result = await api.evaluate({ ...scenario.request, request_id });
  expect(result.decision).toBe(scenario.expected);
  expect(result.policy).toBe(scenario.expectedPolicy);
  const event = await api.event(result.event_id);
  expect(event.id).toBe(result.event_id);
  expect(event.request_id).toBe(request_id);
  expect(event.decision).toBe(result.decision);
  expect(event.policy).toBe(result.policy);
  expect(event).not.toHaveProperty('sanitized_output');
  if (scenario.id === 'redact') {
    expect(result.sanitized_output).toContain('[REDACTED]');
    expect(result.sanitized_output).not.toContain('sk-AEGISSYNTHETIC');
  }
  console.log(scenario.id, result.decision, result.policy, result.event_id);
});
test('unknown actor is sanitized and mixed real feed stays usable', async () => {
  const response = await api.evaluate({ ...scenarios[0].request, user: 'unknown_dashboard_actor' });
  expect(response.decision).toBe('BLOCK');
  expect(response.policy).toBe('identity');
  const event = await api.event(response.event_id);
  expect(event.user).toBeUndefined();
  const mixed = await api.events();
  expect(mixed.some(item => item.id === event.id)).toBe(true);
  expect(mixed.some(item => item.policy === 'fail_closed' && item.user === undefined)).toBe(true);
  expect(mixed.some(item => item.decision === 'ALLOW' && item.user !== undefined)).toBe(true);
});
test('typed real stats, policy load and corpus results', async () => {
  expect((await api.policyStatus()).loaded).toBe(true);
  expect((await api.stats()).latency_ms.samples).toBeGreaterThan(0);
  const run = await api.runRedteam();
  expect(run.status).toBe('completed');
  if (run.status !== 'completed') throw new Error('No completed corpus run');
  expect(run.failed).toBe(0);
  expect(run.unexpected_allows).toBe(0);
  expect(await api.redteamResults()).toEqual(run);
  expect((await api.stats()).redteam.status).toBe('completed');
  console.log('Real corpus:', run.run_id, run.passed + '/' + run.total);
});
test('typed demo approval resolves without execution and rejects replay/missing approval', async () => {
  const manager = scenarios.find(scenario => scenario.id === 'manager')!;
  const pending = await api.evaluate({ ...manager.request, action: 'export' });
  expect(pending.decision).toBe('REQUIRE_APPROVAL');
  expect(pending.policy).toBe('portfolio_restricted');
  const event = await api.event(pending.event_id);
  // Additive field is optional for older main servers; must survive if reported.
  if (event.action !== undefined) expect(event.action).toBe('export');
  expect(await api.resolveApproval(pending.event_id, { approve: true })).toEqual({ id: pending.event_id, status: 'approved', resolved_by: 'security_admin_1', executed: false });
  await expect(api.resolveApproval(pending.event_id, { approve: true })).rejects.toThrow('HTTP 409');
  await expect(api.resolveApproval(crypto.randomUUID(), { approve: false })).rejects.toThrow('HTTP 404');
});
