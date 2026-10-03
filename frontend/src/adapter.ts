import { z } from 'zod';
import { classifications, decisions, roles } from './types';
import type { SecurityEvent, EvaluateResponse, JsonValue } from './types';

const eventSchema = z.object({
  id: z.string().min(1), timestamp: z.string().min(1), request_id: z.string().nullish(),
  user: z.string().nullish(), role: z.enum(roles).nullish(), category: z.string().min(1),
  action: z.enum(['read', 'export']).nullish(), resource: z.string().nullish(), classification: z.enum(classifications).nullish(),
  destination: z.enum(['INTERNAL', 'EXTERNAL']).nullish(), decision: z.enum(decisions), policy: z.string().min(1),
  reason: z.string().min(1), latency_ms: z.number().finite().nonnegative(),
});
const evaluationSchema = z.object({
  decision: z.enum(decisions), policy: z.string().min(1), reason: z.string().min(1),
  event_id: z.string().min(1), latency_ms: z.number().nonnegative(),
});

export class ContractError extends Error {
  constructor() { super('Backend contract error: response does not match docs/API_CONTRACT.md.'); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ContractError();
  return parsed.data;
}
export function normalizeEvent(value: unknown): SecurityEvent {
  // Omit unavailable nullable context consistently. Never substitute identity or action.
  return Object.fromEntries(Object.entries(parse(eventSchema, value)).filter(([, value]) => value !== null && value !== undefined)) as unknown as SecurityEvent;
}
export function normalizeEvents(value: unknown): SecurityEvent[] {
  // Explicit compatibility boundary; no guessed fields or fabricated defaults.
  const parsed = parse(z.union([z.array(eventSchema), z.object({ events: z.array(eventSchema) })]), value);
  return (Array.isArray(parsed) ? parsed : parsed.events).map(normalizeEvent);
}
export function normalizeEvaluation(value: unknown): EvaluateResponse { return parse(evaluationSchema, value); }
export function normalizeJson(value: unknown): JsonValue { return parse(z.json(), value); }
