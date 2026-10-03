import { ContractError, normalizeEvent, normalizeEvents, normalizeEvaluation, normalizeJson } from './adapter';
import type { ApprovalRequest, ApprovalResponse, EvaluateRequest, PolicyStatusResponse, RedteamResponse, StatsResponse } from './types';

type FetchTransport = (url: string, options: RequestInit) => Promise<Response>;
const MAX_RESPONSE_BYTES = 524288;
let sessionToken = '';
export function setSessionToken(token: string) { sessionToken = token; }
export function createApi(baseUrl = '', fetcher: FetchTransport = (url, options) => fetch(url, options), token: () => string = () => sessionToken) {
  const base = baseUrl.replace(/\/$/, '');
  async function request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let consumed = false;
    let completed = false;
    try {
      try {
        response = await fetcher(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error',
        });
      } catch {
        throw new Error(`Backend unreachable: ${path}. Check the API server and connection, then retry.`);
      }
      if (!response.ok) throw new Error(`Backend request failed: ${path} (HTTP ${response.status}). Check the API server and proxy, then retry.`);
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_RESPONSE_BYTES) throw new ContractError();
      reader = response.body?.getReader();
      if (!reader) throw new ContractError();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
            const finish = (settle: () => void) => {
              controller.signal.removeEventListener('abort', interrupted);
              settle();
            };
            const interrupted = () => finish(() => reject(new DOMException('Response timed out', 'AbortError')));
            if (controller.signal.aborted) { interrupted(); return; }
            controller.signal.addEventListener('abort', interrupted, { once: true });
            try {
              void reader!.read().then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
            } catch (error) { finish(() => reject(error)); }
          });
          if (done) { consumed = true; break; }
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new ContractError();
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new Error(`Backend unreachable: ${path}. Response interrupted or timed out; retry.`);
      }
      try {
        const raw = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        completed = true;
        return parsed;
      } catch { throw new ContractError(); }
    } finally {
      clearTimeout(timeout);
      if (!completed) {
        controller.abort();
        if (!consumed) {
          // Cancellation is best effort. Never await an untrusted stream's
          // cancellation promise or replace the sanitized request error.
          try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); } catch { /* synchronous cancellation failure */ }
        }
      }
      reader?.releaseLock();
    }
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
