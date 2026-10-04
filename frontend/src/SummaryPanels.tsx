import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SecurityApi } from './api';
import { decisions } from './types';
import type { StatsResponse, PolicyStatusResponse, RedteamResponse } from './types';

function ResourcePanel<T>({ title, loader, revision, render, run }: { title: string; loader: () => Promise<T>; revision: number; render: (data: T) => ReactNode; run?: () => Promise<T> }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const version = useRef(0);
  async function load(operation = loader) {
    const current = ++version.current;
    setPending(true); setError(null); setData(null);
    try { const next = await operation(); if (current === version.current) setData(next); }
    catch (failure) {
      if (current === version.current) setError((failure as Error).message);
      // A failed run is not a successful previous run. Retrieve the backend's failed status.
      if (run && operation === run) {
        try {
          const next = await loader();
          // Restore only the backend's failed-run evidence, never an older completed run.
          if (current === version.current && next && typeof next === 'object' && 'status' in next && next.status === 'failed') setData(next);
        } catch { /* Original error remains visible. */ }
      }
    }
    finally { if (current === version.current) setPending(false); }
  }
  useEffect(() => { void load(); return () => { ++version.current; }; }, [loader, revision]);
  return <section aria-label={title} className="summary-card" aria-busy={pending}>
    <h3>{title}</h3>
    {pending && <p className="loading">Loading backend summary…</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {data && render(data)}
    {run && <button className="secondary" disabled={pending} onClick={() => void load(run)}>{pending ? 'Waiting for backend…' : 'Run red-team'}</button>}
  </section>;
}
function Stats({ data }: { data: StatsResponse }) {
  const budget = data.budgets;
  return <>
    <p>{data.total_events} lifetime decisions · {data.retained_events} retained audit events</p>
    <dl>{decisions.map(decision => <div key={decision}><dt>{decision}</dt><dd>{data.decisions[decision]}</dd></div>)}</dl>
    <p>{data.latency_ms.samples === 0 ? 'Unavailable — no latency samples' : 'Mean ' + data.latency_ms.mean + ' ms · max ' + data.latency_ms.max + ' ms · ' + data.latency_ms.samples + ' samples'}</p>
    <h4>Budget window</h4>
    <p>Aggregate usage across all users: {budget.requests_used} requests · {budget.tokens_used} units</p>
    <p>Conservative character units (conservative_character_units); not model tokens or monetary cost.</p>
    <p>Per-user limits: {budget.requests_limit_per_user ?? 'Not reported'} requests · {budget.tokens_limit_per_user ?? 'Not reported'} units · window {budget.window_seconds ?? 'Not reported'} seconds</p>
  </>;
}
function Policy({ data }: { data: PolicyStatusResponse }) {
  return <>
    <p className={data.loaded ? '' : 'error-message'}>{data.loaded ? 'Policy evaluation available' : 'Policy evaluation unavailable'}</p>
    <p>{data.loaded ? 'Loaded version' : 'Previous version'}: {data.version ?? 'Not reported'} · {data.rule_count} resource rules</p>
    <p>Last successful hot reload: {data.last_reload ?? 'Not reported'}</p>
    {data.error && <p>{data.error}</p>}
  </>;
}
function Redteam({ data }: { data: RedteamResponse }) {
  if (data.status === 'not_run') return <p>Not run</p>;
  if (data.status === 'failed') return <><p className="error-message">Failed</p><p>{data.error}</p></>;
  return <>
    <p>Completed</p><p>Run {data.run_id} · {data.timestamp} · policy {data.policy_version ?? 'Not reported'}</p>
    <p>{data.passed} passed · {data.failed} failed · {data.unexpected_allows} unexpected allows · {data.latency_ms} ms</p>
    {data.failed > 0 && <p className="error-message">One or more cases failed.</p>}
    {data.results.length === 0 ? <p>No case results returned</p> : <ul>{data.results.map(item => <li key={item.id}>{item.id}: {item.passed ? 'PASS' : 'FAIL'} · expected {item.expected}, actual {item.actual} · {item.policy} · {item.reason} · {item.latency_ms} ms</li>)}</ul>}
  </>;
}
export function SummaryPanels({ api, revision = 0 }: { api: SecurityApi; revision?: number }) {
  const [refresh, setRefresh] = useState(0);
  const [session, setSession] = useState<Awaited<ReturnType<SecurityApi['session']>> | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSession(null); setSessionError(null);
    void api.session().then(value => { if (active) setSession(value); }, failure => {
      if (active) setSessionError((failure as Error).message);
    });
    return () => { active = false; };
  }, [api, refresh]);
  return <section aria-label="Security summaries" className="summary-section">
    <div className="section-header"><div><p className="eyebrow">Current backend state</p><h2>Security summaries.</h2></div><button className="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh summaries</button></div>
    {!session && !sessionError && <p className="loading">Checking summary access…</p>}
    {sessionError && <p role="alert" className="error-message">{sessionError}</p>}
    {session && !session.can_observe && <p>Global security summaries require a SECURITY_ADMIN credential. Your own audit trail and proposal evaluations remain available.</p>}
    {session?.profile === 'local-demo' && <p>Synthetic local demo — identities are not authenticated without a credential. Admin operations still require an administrator credential.</p>}
    {session?.can_observe && <div className="summary-grid">
      <ResourcePanel title="Decisions and budget" loader={api.stats} revision={revision + refresh} render={data => <Stats data={data} />} />
      <ResourcePanel title="Policy status" loader={api.policyStatus} revision={revision + refresh} render={data => <Policy data={data} />} />
      <ResourcePanel title="Red-team evidence" loader={api.redteamResults} run={session.can_admin ? api.runRedteam : undefined} revision={revision + refresh} render={data => <Redteam data={data} />} />
    </div>}
  </section>;
}
