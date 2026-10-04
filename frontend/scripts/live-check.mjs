import assert from 'node:assert/strict';
export async function liveCheck(base = process.env.AEGIS_API_URL || 'http://127.0.0.1:8000') {
  async function call(path, body, status = 200) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, path + ': HTTP ' + response.status);
    return response.json();
  }
  const publicRead = { user: 'analyst_42', role: 'ANALYST', action: 'read', resource: 'public/market_summary', classification: 'PUBLIC', destination: 'INTERNAL' };
  const restricted = { ...publicRead, resource: 'portfolio/current_positions', classification: 'RESTRICTED' };
  const manager = { ...restricted, user: 'manager_1', role: 'PORTFOLIO_MANAGER' };
  const cases = [[publicRead, 'ALLOW', 'market_public'], [restricted, 'BLOCK', 'portfolio_restricted'], [manager, 'ALLOW', 'portfolio_restricted'], [{ ...manager, destination: 'EXTERNAL' }, 'BLOCK', 'external_exfiltration'], [{ ...manager, tool: 'shell', tool_arguments: { command: 'echo AEGIS_SYNTHETIC_PROPOSAL' } }, 'BLOCK', 'tool_guard']];
  const evidence = [];
  for (const [proposal, decision, policy] of cases) {
    const request_id = 'dashboard-' + crypto.randomUUID();
    const result = await call('/api/security/evaluate', { ...proposal, request_id });
    assert.equal(result.decision, decision); assert.equal(result.policy, policy);
    assert.ok(result.event_id && Number.isFinite(result.latency_ms) && result.latency_ms >= 0);
    const event = await call('/api/events/' + encodeURIComponent(result.event_id));
    assert.equal(event.id, result.event_id); assert.equal(event.request_id, request_id);
    assert.equal(event.decision, decision); assert.equal(event.policy, policy);
    assert.equal(event.reason, result.reason);
    evidence.push({ id: event.id, decision, policy });
  }
  const ordinary = await call('/api/security/evaluate', publicRead);
  const ordinaryEvent = await call('/api/events/' + ordinary.event_id);
  assert.equal(ordinaryEvent.request_id, null);
  assert.equal(ordinaryEvent.reason, ordinary.reason);
  const unknown = await call('/api/security/evaluate', { ...publicRead, user: 'unknown_dashboard_actor' });
  assert.equal(unknown.decision, 'BLOCK'); assert.equal(unknown.policy, 'identity');
  const unknownEvent = await call('/api/events/' + unknown.event_id);
  assert.equal(unknownEvent.user, null); assert.equal(unknownEvent.request_id, null);
  assert.equal(unknownEvent.reason, unknown.reason);
  const malformed = await call('/api/security/evaluate', { action: 'execute' }, 422);
  const nullable = await call('/api/events/' + malformed.event_id);
  assert.equal(nullable.id, malformed.event_id); assert.equal(nullable.user, null); assert.equal(nullable.role, null);
  const { events } = await call('/api/events');
  for (const id of [...evidence.map(event => event.id), ordinaryEvent.id, unknownEvent.id, nullable.id]) assert.ok(events.some(event => event.id === id));
  return { evidence, nullableEvent: nullable.id, ordinaryEvent: ordinaryEvent.id, unknownEvent: unknownEvent.id };
}
if (process.argv[1]?.endsWith('live-check.mjs')) {
  try { console.log('LIVE PASS', JSON.stringify(await liveCheck(), null, 2)); }
  catch (error) { console.error('LIVE NOT VERIFIED: ' + error.message); process.exitCode = 1; }
}
