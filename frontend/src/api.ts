import { ContractError, normalizeEvent, normalizeEvents, normalizeEvaluation, normalizeStats, normalizePolicyStatus, normalizeRedteam, normalizeApproval, normalizeSession } from './adapter';
import type { ApprovalRequest, ApprovalResponse, EvaluateRequest, EvaluateResponse, PolicyStatusResponse, RedteamResponse, StatsResponse } from './types';

type FetchTransport = (url: string, options: RequestInit) => Promise<Response>;
const nativeFetch: FetchTransport = (url, options) => fetch(url, options);
const MAX_RESPONSE_BYTES = 524288;
let sessionToken = '';
let sessionRevision = 0;
const sessionRequests = new Set<AbortController>();
const currentToken = () => sessionToken;
export function setSessionToken(token: string) {
  sessionToken = token;
  ++sessionRevision;
  for (const controller of sessionRequests) controller.abort();
  sessionRequests.clear();
}
function validateBase(base: string) {
  const invalid = () => { throw new Error('Invalid API base: use a same-origin path, HTTPS, or loopback HTTP.'); };
  if (/\s|\\/.test(base) || base.startsWith('//')) invalid();
  if (!base) return;
  let url: URL;
  try { url = new URL(base, 'https://aegis-relative.invalid'); } catch { return invalid(); }
  const relative = base.startsWith('/');
  if ((!relative && !/^https?:\/\//.test(base)) || url.username || url.password || url.search || url.hash ||
    (!relative && url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) invalid();
}
export function createApi(baseUrl = '', fetcher: FetchTransport = nativeFetch, token: () => string = currentToken) {
  validateBase(baseUrl);
  const base = baseUrl.replace(/\/$/, '');
  async function request(path: string, body?: unknown): Promise<{ data: unknown; status: number }> {
    const controller = new AbortController();
    const revision = sessionRevision;
    const usesSession = token === currentToken;
    const credential = token();
    if (usesSession) sessionRequests.add(controller);
    const assertSession = () => {
      if (usesSession && revision !== sessionRevision) throw new Error('Session changed; previous request refused. Retry with the current credential.');
    };
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response | undefined;
    let nativeCompletion: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let consumed = false;
    let completed = false;
    function waitForBody<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const finish = (settle: () => void) => {
          controller.signal.removeEventListener('abort', interrupted);
          settle();
        };
        const interrupted = () => finish(() => reject(new DOMException('Response timed out', 'AbortError')));
        if (controller.signal.aborted) { interrupted(); return; }
        controller.signal.addEventListener('abort', interrupted, { once: true });
        try {
          void operation().then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
        } catch (error) { finish(() => reject(error)); }
      });
    }
    try {
      try {
        response = await fetcher(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error',
        });
      } catch {
        assertSession();
        throw new Error(`Backend unreachable: ${path}. Check the API server and connection, then retry.`);
      }
      assertSession();
      if (!response.ok) throw new Error(`Backend request failed: ${path} (HTTP ${response.status}). Check the API server and proxy, then retry.`);
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_RESPONSE_BYTES) throw new ContractError();
      // Chromium can cancel its network loader when a manual stream reader is
      // the only consumer, even after EOF. Retain a native completion branch
      // for the browser fetch transport. It is consumed ONLY after the guarded
      // reader has verified EOF within the byte limit. No unbounded native
      // consumer runs ahead of the size guard.
      if (fetcher === nativeFetch && typeof window !== 'undefined') nativeCompletion = response.clone();
      reader = response.body?.getReader();
      if (!reader) throw new ContractError();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await waitForBody(() => reader!.read());
          if (done) { consumed = true; break; }
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new ContractError();
          chunks.push(value);
        }
      } catch (error) {
        assertSession();
        if (error instanceof ContractError) throw error;
        throw new Error(`Backend unreachable: ${path}. Response interrupted or timed out; retry.`);
      }
      assertSession();
      if (nativeCompletion) {
        try {
          const complete = await waitForBody(() => nativeCompletion!.arrayBuffer());
          if (complete.byteLength !== bytes || complete.byteLength > MAX_RESPONSE_BYTES) throw new ContractError();
        } catch (error) {
          assertSession();
          if (error instanceof ContractError) throw error;
          throw new Error(`Backend unreachable: ${path}. Response interrupted or timed out; retry.`);
        }
        assertSession();
      }
      try {
        const raw = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        completed = true;
        return { data: parsed, status: response.status };
      } catch { throw new ContractError(); }
    } finally {
      sessionRequests.delete(controller);
      clearTimeout(timeout);
      if (!completed) {
        controller.abort();
        if (!consumed) {
          // Cancellation is best effort. Never await an untrusted stream's
          // cancellation promise or replace the sanitized request error.
          try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); } catch { /* synchronous cancellation failure */ }
          // Cancel both tee branches so an oversized/stalled peer cannot keep
          // supplying bytes through the unused native completion branch.
          try { void nativeCompletion?.body?.cancel()?.catch(() => undefined); } catch { /* best effort */ }
        }
      }
      reader?.releaseLock();
    }
  }
  return {
    session: async () => normalizeSession((await request('/api/session')).data),
    events: async () => normalizeEvents((await request('/api/events')).data),
    event: async (id: string) => {
      const event = normalizeEvent((await request(`/api/events/${encodeURIComponent(id)}`)).data);
      if (event.id !== id) throw new ContractError();
      return event;
    },
    stats: async (): Promise<StatsResponse> => normalizeStats((await request('/api/stats')).data),
    policyStatus: async (): Promise<PolicyStatusResponse> => normalizePolicyStatus((await request('/api/policies/status')).data),
    evaluate: async (body: EvaluateRequest): Promise<EvaluateResponse> => {
      return normalizeEvaluation((await request('/api/security/evaluate', body)).data);
    },
    runRedteam: async (): Promise<RedteamResponse> => normalizeRedteam((await request('/api/redteam/run', {})).data),
    redteamResults: async (): Promise<RedteamResponse> => normalizeRedteam((await request('/api/redteam/results')).data),
    resolveApproval: async (id: string, body: ApprovalRequest): Promise<ApprovalResponse> => {
      const response = normalizeApproval((await request(`/api/approvals/${encodeURIComponent(id)}`, body)).data);
      if (response.id !== id || response.status !== (body.approve ? 'approved' : 'denied')) throw new ContractError();
      return response;
    },
  };
}
export type SecurityApi = ReturnType<typeof createApi>;
export const api = createApi(import.meta.env.VITE_API_BASE_URL || '');
