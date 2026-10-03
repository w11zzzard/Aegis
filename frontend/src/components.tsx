import { useState } from 'react';
import type { SecurityApi } from './api';
import type { Decision, EvaluateResponse, SecurityEvent } from './types';
import { scenarios } from './scenarios';

const display = (value: string | undefined) => value || 'Not reported';
export function DecisionBadge({ decision }: { decision?: Decision }) {
  return <span className={`decision decision-${decision || 'unknown'}`}>{display(decision)}</span>;
}

export function SecurityEventTable({ events, selectedId, onSelect }: { events: SecurityEvent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (events.length === 0) return <div className="empty-state"><span className="empty-mark" aria-hidden="true">[ ]</span><p>No audit events returned by the backend.</p><span>Evaluate a proposal to create real audit evidence.</span></div>;
  return <div className="table-scroll"><table>
    <caption className="sr-only">Sanitized backend security events, newest first</caption>
    <thead><tr><th scope="col">Event / actor</th><th scope="col">Resource</th><th scope="col">Decision / evidence</th></tr></thead>
    <tbody>{events.map(event => <tr key={event.id} className={selectedId === event.id ? 'selected' : ''}>
      <td><button className="event-link" aria-label={`Inspect ${event.id}`} aria-pressed={selectedId === event.id} onClick={() => onSelect(event.id)}>{event.id}</button><strong>{display(event.user)}</strong><small>{display(event.role)} · {display(event.timestamp)}</small></td>
      <td><span className="resource">{display(event.resource)}</span><small>{display(event.classification)} · {display(event.destination)}</small></td>
      <td><DecisionBadge decision={event.decision} /><strong className="policy-name">{display(event.policy)}</strong><small>{display(event.reason)}</small></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EventDetails({ event }: { event: SecurityEvent }) {
  const fields = [
    ['User', display(event.user)], ['Role', display(event.role)], ['Attempted action', display(event.action)],
    ['Resolution actor', display(event.actor)], ['Approval ID', display(event.approval_id)],
    ['Resource', display(event.resource)], ['Classification', display(event.classification)],
    ['Destination', display(event.destination)], ['Policy', display(event.policy)],
    ['Measured latency', event.latency_ms === undefined ? 'Not reported' : `${event.latency_ms} ms`],
    ['Request ID', display(event.request_id)], ['Timestamp', display(event.timestamp)], ['Category', display(event.category)],
  ];
  return <section role="region" aria-label="Event details" className="details-body">
    <div className="detail-id">{event.id}</div>
    <dl className="detail-fields"><div><dt>Decision</dt><dd><DecisionBadge decision={event.decision} /></dd></div>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="reason-box"><h3>Backend reason</h3><p>{display(event.reason)}</p></div>
  </section>;
}

export function EvaluationConsole({ api, onEvaluated, onInspect }: { api: SecurityApi; onEvaluated: () => void; onInspect: (id: string) => void }) {
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const scenario = scenarios[index];
  async function evaluate() {
    setPending(true); setResult(null); setError(null);
    try { setResult(await api.evaluate(scenario.request)); onEvaluated(); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <section id="console" aria-labelledby="console-heading" className="console-section">
    <div className="section-header"><div><p className="eyebrow">Propose. Evaluate. Inspect.</p><h2 id="console-heading">Put the policy to the test.</h2><p>Send a proposal to the real engine. Every result belongs to the backend.</p></div><span className="source-label">POST /api/security/evaluate</span></div>
    <div className="console-grid">
      <div className="proposal-panel">
        <label htmlFor="scenario">Demo scenario</label>
        <select id="scenario" value={scenario.id} disabled={pending} onChange={event => { setIndex(scenarios.findIndex(s => s.id === event.target.value)); setResult(null); setError(null); }}>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <p className="expectation">Expected policy behavior: <strong>{scenario.expected}</strong> · {scenario.expectedPolicy} · not a result</p>
        <pre aria-label="Proposed request payload">{JSON.stringify(scenario.request, null, 2)}</pre>
        <p className="scenario-note">{scenario.note}</p>
        <button className="primary" disabled={pending} onClick={() => void evaluate()}>{pending ? 'Evaluating…' : 'Evaluate proposal'}</button>
      </div>
      <div className="result-panel" aria-live="polite" aria-busy={pending}>
        {error && <p role="alert" className="error-message">{error}</p>}
        {pending && <p className="loading">Waiting for the backend decision…</p>}
        {result && <section role="region" aria-label="Evaluation result">
          <p className="eyebrow">Backend response</p><DecisionBadge decision={result.decision} />
          <dl className="result-fields"><div><dt>Policy</dt><dd>{result.policy}</dd></div><div><dt>Measured latency</dt><dd>{result.latency_ms} ms</dd></div><div><dt>Audit event</dt><dd>{result.event_id}</dd></div></dl>
          <div className="reason-box"><h3>Backend reason</h3><p>{result.reason}</p></div>
          <button className="secondary" onClick={() => onInspect(result.event_id)}>Inspect audited event</button>
        </section>}
        {!result && !error && !pending && <div className="result-empty"><span className="empty-mark" aria-hidden="true">→</span><h3>Evidence starts with a request.</h3><p>A decision, policy, reason and measured latency will appear after the backend responds.</p></div>}
      </div>
    </div>
  </section>;
}
