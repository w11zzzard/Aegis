// Test fixtures only. Never imported by the application.
export const event = {
  id: 'event-1', timestamp: '2026-10-03T13:00:00Z', request_id: 'request-1',
  user: 'analyst_42', role: 'ANALYST', category: 'authorization', action: 'read',
  resource: 'portfolio/current_positions', classification: 'RESTRICTED', destination: 'INTERNAL',
  decision: 'BLOCK', policy: 'portfolio_restricted', reason: 'ANALYST cannot access RESTRICTED portfolio data', latency_ms: 2.8
};
export const result = { decision: 'BLOCK', policy: event.policy, reason: event.reason, event_id: event.id, latency_ms: 2.8 };
