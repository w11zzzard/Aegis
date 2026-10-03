import { z } from 'zod';
import { classifications, decisions, roles } from './types';
import type { SecurityEvent, EvaluateResponse, JsonValue } from './types';

const eventSchema = z.object({
  id: z.string().min(1), timestamp: z.string().optional(), request_id: z.string().optional(),
  user: z.string().optional(), role: z.enum(roles).optional(), category: z.string().optional(),
  action: z.string().optional(), resource: z.string().optional(), classification: z.enum(classifications).optional(),
  destination: z.string().optional(), decision: z.enum(decisions).optional(), policy: z.string().optional(),
  reason: z.string().optional(), latency_ms: z.number().nonnegative().optional(),
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
export function normalizeEvent(value: unknown): SecurityEvent { return parse(eventSchema, value); }
export function normalizeEvents(value: unknown): SecurityEvent[] {
  // Explicit compatibility boundary; no guessed fields or fabricated defaults.
  const parsed = parse(z.union([z.array(eventSchema), z.object({ events: z.array(eventSchema) })]), value);
  return Array.isArray(parsed) ? parsed : parsed.events;
}
export function normalizeEvaluation(value: unknown): EvaluateResponse { return parse(evaluationSchema, value); }
export function normalizeJson(value: unknown): JsonValue { return parse(z.json(), value); }
