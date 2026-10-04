import { useCallback, useEffect, useRef, useState } from 'react';
import { api as defaultApi, setSessionToken } from './api';
import type { SecurityApi } from './api';
import type { SecurityEvent } from './types';
import { EvaluationConsole, EventDetails, SecurityEventTable } from './components';
import { SummaryPanels } from './SummaryPanels';

export default function App({ api = defaultApi }: { api?: SecurityApi }) {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [credential, setCredential] = useState('');
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecurityEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const eventVersion = useRef(0);
  const detailVersion = useRef(0);
  const revealSelected = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++eventVersion.current;
    ++detailVersion.current;
    setLoading(true); setError(null); setEvents([]); setSelectedId(null); setDetail(null); setDetailError(null); setDetailLoading(false);
    try { const events = await api.events(); if (version === eventVersion.current) setEvents(events); }
    catch (error) { if (version === eventVersion.current) setError((error as Error).message); }
    finally { if (version === eventVersion.current) setLoading(false); }
  }, [api]);
  useEffect(() => { void refresh(); return () => { ++eventVersion.current; ++detailVersion.current; }; }, [refresh]);
  async function inspect(id: string) {
    const version = ++detailVersion.current;
    setSelectedId(id); setDetail(null); setDetailError(null); setDetailLoading(true);
    try { const event = await api.event(id); if (version === detailVersion.current) setDetail(event); }
    catch (error) { if (version === detailVersion.current) setDetailError((error as Error).message); }
    finally { if (version === detailVersion.current) setDetailLoading(false); }
  }
  function inspectAndReveal(id: string) {
    revealSelected.current = true;
    void inspect(id);
  }
  useEffect(() => {
    if (!revealSelected.current || loading || detailLoading || !detail || detail.id !== selectedId) return;
    revealSelected.current = false;
    requestAnimationFrame(() => document.getElementById(window.innerWidth <= 680 ? 'detail-heading' : 'audit')?.scrollIntoView?.({ behavior: 'instant' }));
  }, [loading, detailLoading, detail, selectedId]);
  return <main className="overflow-x-hidden w-full max-w-full">
    <nav aria-label="Main navigation" className="navigation"><a href="#" className="brand"><span className="brand-symbol" aria-hidden="true">A</span>AEGIS<span className="brand-caption">Enforcement gateway</span></a><div className="nav-links"><a href="#console">Evaluation console <span aria-hidden="true">↗</span></a><a href="#audit">Audit trail</a></div></nav>
    <header className="hero">
      <div><p className="eyebrow">The security control room</p><h1 className="max-w-6xl">Security,<br />with evidence.</h1><p className="hero-copy">Choose a proposal. See the gateway's decision.<br />Open the exact reason in the audit trail.</p><a href="#console" className="primary">Try the live policy check <span aria-hidden="true">↗</span></a></div>
      <div className="gateway-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-path" /><div className="gate"><span>AEGIS</span><div className="gate-bars"><i /><i /><i /><i /><i /></div><small>Policy boundary</small></div><span className="art-label art-input">Proposal →</span><span className="art-label art-output">→ Audit</span><span className="art-caption">Illustrative gateway path</span></div>
    </header>
    <div className="principles-grid grid-flow-dense" aria-label="Three-step demo"><div><span className="principle-line" /><h2>01 · Choose a proposal.</h2><p>Try a public read, restricted portfolio, or external destination.</p></div><div><span className="principle-line" /><h2>02 · Read the decision.</h2><p>The running gateway returns the policy, reason and measured latency.</p></div><div><span className="principle-line" /><h2>03 · Inspect the audit.</h2><p>Open the matching event below. No model or tool is executed.</p></div></div>
    <EvaluationConsole key={credentialVersion} api={api} onEvaluated={() => void refresh()} onInspect={inspectAndReveal} />
    <section id="audit" aria-labelledby="audit-heading" className="audit-section">
      {api === defaultApi && <form onSubmit={event => { event.preventDefault(); setSessionToken(credential); setCredential(''); setCredentialVersion(value => value + 1); void refresh(); }}>
        <label htmlFor="credential">API credential</label> <input id="credential" type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} />
        <button className="secondary" type="submit">Connect</button> <button className="secondary" type="button" onClick={() => { setSessionToken(''); setCredential(''); setCredentialVersion(value => value + 1); void refresh(); }}>Disconnect</button>
        <p>Use the credential provided by your operator. It stays in memory until you disconnect or reload.</p>
      </form>}
      <div className="section-header"><div><p className="eyebrow">Sanitized backend evidence</p><h2 id="audit-heading">The audit trail.</h2><p>Choose an event to inspect the decision in context.</p></div><button className="secondary" disabled={loading} onClick={() => void refresh()}>Refresh events</button></div>
      <div className="audit-grid"><div className="events-panel"><div className="panel-header"><h3>Security events</h3><span className="source-label">GET /api/events</span></div>
        <div aria-live="polite" aria-busy={loading}>{error ? <p role="alert" className="error-message">{error}</p> : loading ? <p className="loading">Loading backend audit events…</p> : <SecurityEventTable events={events} selectedId={selectedId} onSelect={inspectAndReveal} />}</div>
      </div><aside className="details-panel" aria-labelledby="detail-heading"><div className="panel-header"><h3 id="detail-heading">Decision context</h3><span className="context-symbol" aria-hidden="true">↗</span></div><div aria-live="polite" aria-busy={detailLoading}>
        {detailError ? <p role="alert" className="error-message">{detailError}</p> : detailLoading ? <p className="loading">Loading event details…</p> : detail ? <EventDetails event={detail} /> : <div className="detail-empty"><div className="context-lines" aria-hidden="true"><i /><i /><i /></div><h4>Follow the evidence.</h4><p>Select an audit event to see the user, action, policy and reason.</p></div>}
      </div></aside></div>
    </section>
    <SummaryPanels key={'summaries-' + credentialVersion} api={api} revision={eventVersion.current} />
    <footer><a href="#" className="footer-brand">AEGIS</a><p>Agent Enforcement Gateway for Intelligent Systems</p><a href="#console">Evaluate a proposal <span aria-hidden="true">↗</span></a></footer>
  </main>;
}
