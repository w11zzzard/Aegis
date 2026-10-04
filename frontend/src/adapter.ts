import { z } from 'zod';
import { classifications, decisions, roles } from './types';
import type { SecurityEvent, EvaluateResponse, JsonValue } from './types';

const eventSchema = z.object({
  id: z.string().min(1).max(128), timestamp: z.string().min(1).max(64), request_id: z.string().max(128).nullish(),
  user: z.string().max(128).nullish(), role: z.enum(roles).nullish(), category: z.string().min(1).max(128),
  action: z.enum(['read', 'export']).nullish(), resource: z.string().max(128).nullish(), classification: z.enum(classifications).nullish(),
  destination: z.enum(['INTERNAL', 'EXTERNAL']).nullish(), decision: z.enum(decisions), policy: z.string().min(1).max(128),
  reason: z.string().min(1).max(1024), latency_ms: z.number().finite().nonnegative(),
  actor: z.string().max(128).nullish(), approval_id: z.string().max(128).nullish(),
});
const evaluationSchema = z.object({
  decision: z.enum(decisions), policy: z.string().min(1).max(128), reason: z.string().min(1).max(1024),
  event_id: z.string().min(1).max(128), latency_ms: z.number().finite().nonnegative(),
});

export class ContractError extends Error {
  constructor() { super('Backend contract error: response does not match docs/API_CONTRACT.md.'); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ContractError();
  return parsed.data;
}
const sensitiveFields = new Set([
  'prompt', 'output', 'source', 'tool', 'toolarguments', 'authorization',
  'token', 'accesstoken', 'refreshtoken', 'credential', 'credentials',
  'password', 'secret', 'apikey', 'stack', 'traceback', 'sanitizedoutput',
]);
function rejectSensitiveFields(value: unknown, permittedOutput = false) {
  const queue: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (queue.length) {
    const [item, depth] = queue.pop()!;
    if (++nodes > 10000 || depth > 16) throw new ContractError();
    if (!item || typeof item !== 'object') continue;
    for (const [key, child] of Object.entries(item)) {
      if (sensitiveFields.has(key.toLowerCase().replace(/[_-]/g, ''))) {
        // Only the canonical permitted evaluation field belongs to this API.
        // The dashboard still omits it from the public view model.
        if (!(depth === 0 && key === 'sanitized_output' && permittedOutput && typeof child === 'string')) throw new ContractError();
      }
      queue.push([child, depth + 1]);
    }
  }
}
export function normalizeEvent(value: unknown): SecurityEvent {
  // Omit unavailable nullable context consistently. Never substitute identity or action.
  rejectSensitiveFields(value);
  return Object.fromEntries(Object.entries(parse(eventSchema, value)).filter(([, value]) => value !== null && value !== undefined)) as unknown as SecurityEvent;
}
export function normalizeEvents(value: unknown): SecurityEvent[] {
  // Explicit compatibility boundary; no guessed fields or fabricated defaults.
  rejectSensitiveFields(value);
  const parsed = parse(z.union([z.array(eventSchema).max(100), z.object({ events: z.array(eventSchema).max(100) })]), value);
  return (Array.isArray(parsed) ? parsed : parsed.events).map(normalizeEvent);
}
export function normalizeEvaluation(value: unknown): EvaluateResponse {
  const decision = value && typeof value === 'object' && 'decision' in value ? value.decision : undefined;
  rejectSensitiveFields(value, decision === 'ALLOW' || decision === 'REDACT');
  return parse(evaluationSchema, value);
}
export function normalizeJson(value: unknown): JsonValue {
  const queue: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (queue.length) {
    const [item, depth] = queue.pop()!;
    if (++nodes > 10000 || depth > 16 || (typeof item === 'string' && item.length > 16000)) throw new ContractError();
    if (item && typeof item === 'object') for (const child of Object.values(item)) queue.push([child, depth + 1]);
  }
  return parse(z.json(), value);
}
