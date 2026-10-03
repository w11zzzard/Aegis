import { ContractError, normalizeEvent, normalizeEvents, normalizeEvaluation, normalizeJson } from './adapter';
import type { ApprovalRequest, ApprovalResponse, EvaluateRequest, PolicyStatusResponse, RedteamResponse, StatsResponse } from './types';

type FetchTransport = (url: string, options: RequestInit) => Promise<Response>;
export function createApi(baseUrl = '', fetcher: FetchTransport = (url, options) => fetch(url, options)) {
  const base = baseUrl.replace(/\/$/, '');
  async function request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
        });
      } catch {
        throw new Error(`Backend unreachable: ${path}. Check the API server and connection, then retry.`);
      }
      if (!response.ok) throw new Error(`Backend request failed: ${path} (HTTP ${response.status}).`);
      try { return await response.json(); } catch { throw new ContractError(); }
    } finally { clearTimeout(timeout); }
  }
  return {
    events: async () => normalizeEvents(await request('/api/events')),
    event: async (id: string) => {
      const event = normalizeEvent(await request(`/api/events/${encodeURIComponent(id)}`));
      if (event.id !== id) throw new ContractError();
      return event;
    },
    stats: async (): Promise<StatsResponse> => normalizeJson(await request('/api/stats')),
    policyStatus: async (): Promise<PolicyStatusResponse> => normalizeJson(await request('/api/policies/status')),
    evaluate: async (body: EvaluateRequest) => normalizeEvaluation(await request('/api/security/evaluate', body)),
    runRedteam: async (): Promise<RedteamResponse> => normalizeJson(await request('/api/redteam/run', {})),
    redteamResults: async (): Promise<RedteamResponse> => normalizeJson(await request('/api/redteam/results')),
    resolveApproval: async (id: string, body: ApprovalRequest): Promise<ApprovalResponse> => normalizeJson(await request(`/api/approvals/${encodeURIComponent(id)}`, body)),
  };
}
export type SecurityApi = ReturnType<typeof createApi>;
export const api = createApi(import.meta.env.VITE_API_BASE_URL || '');
