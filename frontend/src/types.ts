// Canonical values from docs/API_CONTRACT.md. Never infer authorization in the UI.
export const decisions = ['ALLOW', 'BLOCK', 'REDACT', 'REQUIRE_APPROVAL', 'THROTTLE'] as const;
export const classifications = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
export const roles = ['INTERN', 'ANALYST', 'SENIOR_ANALYST', 'PORTFOLIO_MANAGER', 'SECURITY_ADMIN'] as const;
export type Decision = typeof decisions[number];
export type Classification = typeof classifications[number];
export type Role = typeof roles[number];
export type Action = 'read' | 'export';
export type Destination = 'INTERNAL' | 'EXTERNAL';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SecurityEvent {
  id: string;
  timestamp: string;
  request_id?: string;
  user?: string;
  role?: Role;
  category: string;
  action?: Action;
  resource?: string;
  classification?: Classification;
  destination?: Destination;
  decision: Decision;
  policy: string;
  reason: string;
  latency_ms: number;
}

export interface EvaluateRequest {
  user: string;
  role: Role;
  action: Action;
  resource: string;
  classification: Classification;
  destination: Destination;
  request_id?: string;
  prompt?: string;
  output?: string;
  tool?: string;
  tool_arguments?: { [key: string]: JsonValue };
  estimated_tokens?: number;
  model?: string;
  source?: string;
}

export interface EvaluateResponse {
  decision: Decision;
  policy: string;
  reason: string;
  event_id: string;
  latency_ms: number;
}

// These responses have no field schema in v1; do not invent metric/status types.
export type StatsResponse = JsonValue;
export type PolicyStatusResponse = JsonValue;
export type RedteamResponse = JsonValue;
export type ApprovalResponse = JsonValue;
// Provisional body; Developer A must confirm before an approval UI is exposed.
export interface ApprovalRequest { decision: 'approve' | 'deny' }
