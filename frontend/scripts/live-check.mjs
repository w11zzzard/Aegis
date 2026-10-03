// Opt-in acceptance check: writes real evaluation/audit events to the chosen backend.
import assert from 'node:assert/strict';
const base = process.env.AEGIS_API_URL || 'http://127.0.0.1:8000';
async function call(path, body) {
  const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  assert.equal(response.ok, true, `${path}: HTTP ${response.status}`);
  return response.json();
}
const request = { user: 'dashboard_integration', role: 'ANALYST', action: 'read', resource: 'portfolio/current_positions', classification: 'RESTRICTED', destination: 'INTERNAL' };
try {
  const blocked = await call('/api/security/evaluate', request);
  assert.equal(blocked.decision, 'BLOCK');
  assert.equal(blocked.policy, 'portfolio_restricted');
  assert.ok(typeof blocked.latency_ms === 'number' && blocked.latency_ms >= 0);
  const event = await call(`/api/events/${encodeURIComponent(blocked.event_id)}`);
  assert.equal(event.id, blocked.event_id);
  assert.equal(event.decision, 'BLOCK');
  const listing = await call('/api/events');
  assert.ok((Array.isArray(listing) ? listing : listing.events).some(item => item.id === event.id));
  const allowed = await call('/api/security/evaluate', { ...request, role: 'PORTFOLIO_MANAGER' });
  assert.equal(allowed.decision, 'ALLOW');
  const external = await call('/api/security/evaluate', { ...request, role: 'PORTFOLIO_MANAGER', destination: 'EXTERNAL' });
  assert.equal(external.decision, 'BLOCK');
  console.log('LIVE PASS: backend BLOCK → audited event → listing; manager ALLOW; external BLOCK.');
} catch (error) {
  console.error(`LIVE NOT VERIFIED: ${error.message}`);
  process.exitCode = 1;
}
