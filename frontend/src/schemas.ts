// Observed schemas: backend/core.py, policy.py, redteam.py and main.py.
// Keep this boundary aligned with Developer A's docs/API_CONTRACT.md updates.
import { z } from 'zod';
import { decisions } from './types';
const count = z.number().int().nonnegative();
const latency = z.number().finite().nonnegative();
const text = z.string().min(1);
const idle = z.object({ status: z.literal('not_run'), total: z.literal(0), unexpected_allows: z.literal(0) });
const failed = z.object({ status: z.literal('failed'), total: z.literal(0), unexpected_allows: z.literal(0), error: text });
const done = z.object({ status: z.literal('completed'), run_id: text, timestamp: text, policy_version: text.nullable(), total: count, passed: count, failed: count, unexpected_allows: count, latency_ms: latency });
const caseSchema = z.object({ id: text, expected: z.enum(decisions), actual: z.enum(decisions), passed: z.boolean(), policy: text, reason: text, latency_ms: latency }).refine(value => value.passed === (value.expected === value.actual));
export const redteamSchema = z.discriminatedUnion('status', [
  idle.extend({ results: z.array(caseSchema).length(0) }),
  failed.extend({ results: z.array(caseSchema).length(0) }),
  done.extend({ results: z.array(caseSchema) }),
]).refine(value => value.status !== 'completed' || (
  value.results.length === value.total && value.passed + value.failed === value.total &&
  value.results.filter(item => item.passed).length === value.passed &&
  value.results.filter(item => item.expected === 'BLOCK' && item.actual === 'ALLOW').length === value.unexpected_allows
));
const redteamSummary = z.discriminatedUnion('status', [idle, failed, done]);
export const policySchema = z.object({ loaded: z.boolean(), version: text.nullable(), rule_count: count, last_reload: text.nullable(), error: text.nullable() });
export const statsSchema = z.object({
  total_events: count, retained_events: count,
  decisions: z.object({ ALLOW: count, BLOCK: count, REDACT: count, REQUIRE_APPROVAL: count, THROTTLE: count }),
  latency_ms: z.object({ samples: count, mean: latency.nullable(), max: latency.nullable() }).refine(value => value.samples === 0 ? value.mean === null && value.max === null : value.mean !== null && value.max !== null && value.mean <= value.max),
  unexpected_allows: count,
  budgets: z.object({ requests_used: count, tokens_used: count, requests_limit_per_user: count.optional(), tokens_limit_per_user: count.optional(), window_seconds: count.optional(), accounting: z.literal('conservative_character_units') }),
  approvals: z.partialRecord(z.enum(['pending', 'approved', 'denied', 'expired', 'invalidated']), count),
  redteam: redteamSummary,
});
export const approvalSchema = z.object({ id: text, status: z.enum(['approved', 'denied']), resolved_by: z.literal('security_admin_1'), executed: z.literal(false) });
