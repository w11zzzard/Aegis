# AEGIS architecture and 20-hour sprint

## Product shape

AEGIS is one Python service with a thin web dashboard. The service is the enforcement point; the dashboard observes it and uses the same public API. YAML is the editable control catalog. Optional AI inspection may add risk signals after deterministic controls work, but it cannot authorize access or override a deny.

## Architecture

User / Agent / MCP client → FastAPI gateway → identity context → deterministic policy engine → input/injection signals → data classification and DLP → tool, destination and budget guards → decision.

Allowed or redacted requests may continue to an optional local model/tool. Inspect model output and destinations again before responding. Record sanitized evidence to the audit store. Events, statistics, policy status and red-team APIs feed the React dashboard. The hot-reloaded YAML policy catalog feeds the policy engine.

## Minimum coherent demo

1. Normal low-risk request returns ALLOW.
2. Analyst asks for restricted portfolio positions: BLOCK; a sanitized audit event appears in dashboard.
3. Portfolio manager requests the same resource: ALLOW.
4. Restricted data routed to an external destination: BLOCK even if injection detection misses.
5. Secret in model output: redact or block before it leaves the gateway.
6. Dangerous proposed tool call: block without executing it.
7. Change a YAML rule while the service runs; status version changes and the next request reflects it.
8. Run committed positive and negative attacks; show actual results and unexpected allows.
9. Show a small configured request/token budget; exceeding it returns THROTTLE and updates real usage telemetry.

## Work allocation and integration

### Developer A — backend/security

Own backend/, policies/, redteam/ and backend tests. Build shared request/response models and the API contract first. Keep one service and deterministic controls. Authorization never lives in the UI or semantic model.

### Developer B — dashboard/frontend

Own frontend/. First build canonical TypeScript types, API client, event table and event details against the contract. Then add stats, real evaluation scenarios, policy status and red-team results. Show backend-offline errors; never silently substitute fake decisions.

### Shared integration

- One GitHub repository; suggested branches dev-a/security-core and dev-b/dashboard.
- Commit small changes and integrate shared API work early.
- Keep docs/API_CONTRACT.md as the source of truth. Call out contract changes before implementation.
- First vertical slice: real denied request → real audit event → displayed event.
- Reserve the final three hours for integration, cold-start instructions, rehearsal and submission packaging.

## Time boxes

| Elapsed | Work | Exit condition |
| --- | --- | --- |
| 0–1 h | Repo skeleton, health endpoint, shared contract | Both developers start independently |
| 1–5 h | RBAC, YAML policy, evaluator, deny-by-default, audit events | Restricted analyst request blocks and is retrievable |
| 5–8 h | Destination/exfiltration, output secret DLP, safe tool proposal check | P0 leak/action examples block or redact |
| 8–11 h | Hot reload, request/token quota, rate limiting, tests | YAML edit and quota crossing have observable effect |
| 11–15 h | Event list/details, stats/policy status, real evaluation console | UI shows backend result and reason |
| 15–17 h | Red-team corpus/runner, positive and negative suite | One command runs suite; unexpected allows counted honestly |
| 17–19 h | Demo rehearsal, measured latency, diagram/runbook, slide outline | Fresh start works; claims match measurements |
| 19–20 h | Freeze scope, final verification, HackTribe handoff | Submission ready before 4 Oct 23:00 |

## Scope cuts, in order

1. Full OpenAI SDK compatibility: retain one demonstrable path.
2. Semantic classifier: keep optional and local; label absence clearly.
3. Persistence beyond audit and budget counters needed for the demo.
4. WebSockets, complex charts, multiple services and external deployments.

Do not cut deterministic RBAC, restricted-to-external protection, sanitized audit, real test results or positive control cases.

## Competition proof points

The brief scores guardrail robustness (30%), architecture/performance (20%), reporting (20%), tests (15%) and practical implementation (15%). Submission needs title, team name, member list, description and a presentation PDF of at most 10 slides. Each demo decision should explain who attempted what, the resource and classification, the control, why it decided that way, and measured latency.
