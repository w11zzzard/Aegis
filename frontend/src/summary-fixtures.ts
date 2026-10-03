// Test fixtures only, shaped after backend/core.py and backend/redteam.py.
export const notRun = { status: 'not_run', total: 0, unexpected_allows: 0, results: [] };
export const policyStatus = { loaded: true, version: 'v1', rule_count: 4, last_reload: '2026-10-03T17:00:00Z', error: null };
export const stats = {
  total_events: 0, retained_events: 0,
  decisions: { ALLOW: 0, BLOCK: 0, REDACT: 0, REQUIRE_APPROVAL: 0, THROTTLE: 0 },
  latency_ms: { samples: 0, mean: null, max: null }, unexpected_allows: 0,
  budgets: { requests_used: 3, tokens_used: 120, requests_limit_per_user: 60, tokens_limit_per_user: 32000, window_seconds: 60, accounting: 'conservative_character_units' },
  approvals: {}, redteam: { status: 'not_run', total: 0, unexpected_allows: 0 }
};
export const completed = {
  status: 'completed', run_id: 'run-1', timestamp: '2026-10-03T17:00:00Z', policy_version: 'v1',
  total: 1, passed: 1, failed: 0, unexpected_allows: 0, latency_ms: 4,
  results: [{ id: 'case-1', expected: 'BLOCK', actual: 'BLOCK', passed: true, policy: 'tool_guard', reason: 'Shell denied', latency_ms: 0.3 }]
};
