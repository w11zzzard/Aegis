import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { normalizeStats, normalizePolicyStatus, normalizeRedteam, normalizeApproval, normalizeEvaluation } from './adapter';
import { stats, policyStatus, notRun, completed } from './summary-fixtures';
import { result } from './test-fixtures';
describe('validated summary boundaries', () => {
  it('accepts backend summaries, nullable latency and strips payloads', () => {
    expect(() => normalizeStats({ ...stats, prompt: 'secret' })).toThrow(/contract/i);
    expect(normalizePolicyStatus(policyStatus)).toEqual(policyStatus);
    expect(normalizeRedteam(notRun)).toEqual(notRun);
    expect(normalizeRedteam(completed)).toEqual(completed);
    expect(normalizeRedteam({ ...notRun, status: 'failed', error: 'Corpus unavailable' }).status).toBe('failed');
  });
  it.each([
    { ...stats, decisions: { ...stats.decisions, BLOCK: -1 } },
    { ...stats, latency_ms: { samples: 0, mean: 0, max: 0 } },
    { ...stats, latency_ms: { samples: 1, mean: null, max: null } },
    { ...stats, budgets: { ...stats.budgets, accounting: 'model_tokens' } },
    { ...stats, redteam: { status: 'success' } }, {}
  ])('rejects invalid stats %j', value => expect(() => normalizeStats(value)).toThrow(/contract/i));
  it('rejects incomplete and inconsistent runs and policies', () => {
    expect(() => normalizeRedteam({ status: 'completed' })).toThrow(/contract/i);
    expect(() => normalizeRedteam({ ...completed, total: 2 })).toThrow(/contract/i);
    expect(() => normalizePolicyStatus({ loaded: 'true' })).toThrow(/contract/i);
  });
  it('never admits sanitized output on blocked or pending responses', () => {
    for (const decision of ['BLOCK', 'REQUIRE_APPROVAL', 'THROTTLE']) expect(() => normalizeEvaluation({ ...result, decision, sanitized_output: 'secret' })).toThrow(/contract/i);
    expect(normalizeEvaluation({ ...result, decision: 'REDACT', sanitized_output: '[REDACTED]' })).not.toHaveProperty('sanitized_output');
  });
});
describe('demo approval boundary', () => {
  it('sends approve boolean and admin identity only on approval, verifies response id', async () => {
    const approved = { id: 'approval-1', status: 'approved', resolved_by: 'security_admin_1', executed: false };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(policyStatus))).mockResolvedValueOnce(new Response(JSON.stringify(approved)));
    const api = createApi('', fetcher, () => 'synthetic-admin-token');
    await api.policyStatus(); expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('X-Aegis-User');
    expect(await api.resolveApproval('approval-1', { approve: true })).toEqual(approved);
    expect(fetcher.mock.calls[1][1].headers).toHaveProperty('Authorization', 'Bearer synthetic-admin-token');
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('X-Aegis-User');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ approve: true });
    await expect(createApi('', async () => new Response(JSON.stringify(approved))).resolveApproval('other', { approve: false })).rejects.toThrow(/contract/i);
  });
  it.each([403, 404, 409, 422])('reports approval HTTP %i without private response bodies', async status => {
    const api = createApi('', async () => new Response('private trace', { status }));
    await expect(api.resolveApproval('approval-1', { approve: false })).rejects.toThrow('HTTP ' + status);
  });
  it.each([{ id: '', status: 'approved', resolved_by: 'security_admin_1', executed: false }, { id: 'a', status: 'pending', resolved_by: 'security_admin_1', executed: false }, { id: 'a', status: 'approved', resolved_by: 'intruder', executed: false }, { id: 'a', status: 'approved', resolved_by: 'security_admin_1', executed: true }])('rejects invalid approval response %j', value => expect(() => normalizeApproval(value)).toThrow(/contract/i));
});
