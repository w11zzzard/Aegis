import { ContractError, normalizeEvent, normalizeEvents, normalizeEvaluation, normalizeStats, normalizePolicyStatus, normalizeRedteam, normalizeApproval } from './adapter';
import type { ApprovalRequest, ApprovalResponse, EvaluateRequest, PolicyStatusResponse, RedteamResponse, StatsResponse } from './types';

type FetchTransport = (url: string, options: RequestInit) => Promise<Response>;
export function createApi(baseUrl = '', fetcher: FetchTransport = (url, options) => fetch(url, options)) {
  const base = baseUrl.replace(/\/$/, '');
  async function request(path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
          body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
        });
      } catch {
        throw new Error(`Backend unreachable: ${path}. Check the API server and connection, then retry.`);
      }
      if (!response.ok) {
        const approvalErrors: Record<number, string> = { 403: 'Demo admin authorization required.', 404: 'Approval not found.', 409: 'Approval expired, already resolved, or authorization changed. Evaluate again.', 422: 'Approval request validation failed.' };
        const guidance = path.startsWith('/api/approvals/') && approvalErrors[response.status] || 'Check the API server and proxy, then retry.';
        throw new Error(`Backend request failed: ${path} (HTTP ${response.status}). ${guidance}`);
      }
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
    stats: async (): Promise<StatsResponse> => normalizeStats(await request('/api/stats')),
    policyStatus: async (): Promise<PolicyStatusResponse> => normalizePolicyStatus(await request('/api/policies/status')),
    evaluate: async (body: EvaluateRequest) => normalizeEvaluation(await request('/api/security/evaluate', body)),
    runRedteam: async (): Promise<RedteamResponse> => normalizeRedteam(await request('/api/redteam/run', {})),
    redteamResults: async (): Promise<RedteamResponse> => normalizeRedteam(await request('/api/redteam/results')),
    resolveApproval: async (id: string, body: ApprovalRequest): Promise<ApprovalResponse> => {
      const response = normalizeApproval(await request(`/api/approvals/${encodeURIComponent(id)}`, body, { 'X-Aegis-User': 'security_admin_1' }));
      if (response.id !== id || response.status !== (body.approve ? 'approved' : 'denied')) throw new ContractError();
      return response;
    },
  };
}
export type SecurityApi = ReturnType<typeof createApi>;
export const api = createApi(import.meta.env.VITE_API_BASE_URL || '');
