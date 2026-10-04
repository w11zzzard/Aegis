# AEGIS API contract — v1.1

Source of truth: the FastAPI implementation and trusted YAML catalog. All decisions come from the backend. Developer B should normalize nullable metadata for display and validate canonical values; never infer authorization or substitute mocked results. This checkpoint documents existing wire behavior, including the additive `action` event field; clients may accept its absence from older servers.

## Local integration and canonical values

Base URL: `http://127.0.0.1:8000`. CORS allows `http://localhost:5173` and `http://127.0.0.1:5173`, GET/POST, Content-Type and X-Aegis-User. The existing Vite configuration proxies `/api` to that backend; set `AEGIS_BACKEND_URL` when using an isolated backend port. `/health` and `/v1` currently require direct backend calls or a separately configured proxy.

| Type | Accepted values |
| --- | --- |
| Decision | ALLOW, BLOCK, REDACT, REQUIRE_APPROVAL, THROTTLE |
| Classification | PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED |
| Role | INTERN, ANALYST, SENIOR_ANALYST, PORTFOLIO_MANAGER, SECURITY_ADMIN |
| Action | read, export |
| Destination | INTERNAL, EXTERNAL |

## Authentication and profiles

The default `authenticated` profile requires `Authorization: Bearer <credential>` for every route except minimal `/health` and CORS preflight. Independently generated credentials map to the trusted identity registry; `X-Aegis-User` never authorizes requests. User/role may be omitted in authenticated evaluations: the server derives them from the credential. Conflicting claims return a canonical BLOCK; invalid credentials return 401. Missing `AEGIS_STATE_PATH` or unavailable security state returns sanitized 503 without output.

Users can read only their own event collections/details. SECURITY_ADMIN can inspect all sanitized events, global stats, policy status and red-team results, run red-team cases and resolve approvals. Inaccessible event IDs return 404; docs/OpenAPI are disabled.

Explicit `local-demo` is a loopback-only synthetic evaluation profile with public simulator reads and selectable demo identities. Administrative writes still require a SECURITY_ADMIN bearer credential. Actual browser requests require an exact configured origin, including bodyless POSTs; defaults are localhost/127.0.0.1:5173. This profile must not be publicly proxied or connected to real data. `production` is unsupported and rejected at startup until its identity/TLS/runtime requirements are implemented and verified.

## Endpoints

| User | Registered role |
| --- | --- |
| intern_1 | INTERN |
| analyst_42 | ANALYST |
| senior_1 | SENIOR_ANALYST |
| manager_1 | PORTFOLIO_MANAGER |
| security_admin_1 | SECURITY_ADMIN |

| Resource | Authoritative classification | Roles allowed by default | Actions |
| --- | --- | --- | --- |
| public/market_summary | PUBLIC | All five demo roles | read |
| research/internal_notes | INTERNAL | ANALYST, SENIOR_ANALYST, PORTFOLIO_MANAGER | read |
| research/confidential | CONFIDENTIAL | SENIOR_ANALYST, PORTFOLIO_MANAGER | read |
| portfolio/current_positions | RESTRICTED | PORTFOLIO_MANAGER | read, export (approval required for export) |

Do not use aliases such as manager_7, research/public_summary, tools/shell, or action execute. They intentionally fail validation/policy lookup. For a dangerous tool example use an otherwise authorized manager/read/portfolio request with `tool: shell` to reach `tool_guard`.

## Endpoint overview

| Method | Path | Success response |
| --- | --- | --- |
| GET | /health | `{ "status": "ok" }` (liveness only) |
| GET | /api/events | `{ "events": [Event] }`, newest first |
| GET | /api/events/{id} | Event directly |
| GET | /api/stats | Stats directly |
| GET | /api/policies/status | PolicyStatus directly |
| POST | /api/security/evaluate | Evaluation directly; HTTP 200 for all five valid decisions |
| POST | /api/redteam/run | CompletedRun directly; no body, null, or `{}` accepted |
| GET | /api/redteam/results | NotRun, CompletedRun, or FailedRun directly |
| POST | /api/approvals/{id} | ApprovalResolution directly |
| POST | /v1/chat/completions | Minimal offline completion with aegis metadata |

All request objects reject unknown fields. Bodies are limited to 65,536 bytes before JSON parsing, including chunked requests. Examples below describe shapes; identifiers/timestamps/latencies are generated at runtime and examples are not performance claims.

## Evaluation request and response

Optional fields may include request_id, prompt, output, tool, tool_arguments, estimated_tokens, model and source. Requests are capped at 64 KiB with a ten-second body-receive deadline, 32 nesting levels and 10,000 JSON nodes; actual received chunks enforce the byte limit regardless of Content-Length. Oversized bodies return 413 BLOCK and receive timeouts 408 BLOCK. Ambiguous, malformed or excessive JSON returns a sanitized 422 BLOCK. Every media type parsed as JSON by the locked FastAPI is checked with the same MIME parser: application/json and application subtypes ending in +json, including case and parameter variants. Duplicate keys at every level are refused before schema validation or evaluation. Duplicate Content-Type headers return 400. The installed FastAPI uses strict content types: a nonempty body without a usable JSON Content-Type returns sanitized 422; bodyless administrative requests remain supported. No alternate JSON body route bypasses these safeguards.

The six fields above are required **security context**. The schema accepts absent/null context to let the engine return HTTP 200 BLOCK/fail_closed and a sanitized event. Noncanonical enums, wrong types, invalid identifiers, extra fields, invalid JSON, or invalid field bounds return HTTP 422 BLOCK/fail_closed. Unknown registered users or role mismatch return BLOCK/identity. Unknown resources block; caller classification must match the trusted catalog.

Identifiers (`user`, `resource`, `request_id`, `tool`, `model`) are 1–128 characters matching `[A-Za-z0-9_./:-]`. Optional request fields:

Latency is measured. Events expose id, timestamp, request_id, user, role, action, category, resource, classification, destination, decision, policy, reason and latency_ms when known. Collections return `{events: [...]}`, newest first, with `limit` 1–100 (default 100). Detail returns one event. Approval resolution preserves requester/action and adds resolving `actor` and correlated `approval_id`. Denials and replay/expiry failures are sanitized audit events. Raw prompt/output/source and credentials are omitted.

Configured opaque bearer credentials are masked in permitted output and retained metadata, including inside surrounding text decoded from one base64/base64url layer. Encoded candidates cover the full 16,000-character API text limit; credential substring searches stop after 32,768 comparisons and conservatively mask the candidate on exhaustion. Benign encodings remain intact when scanning finishes within that bound. Unknown secrets, other encodings and recursive encoding are outside this pattern masker; catalog/destination authorization remains authoritative.

## Administrative operations and response budgets

`POST /api/approvals/{id}` accepts exactly `{approve: true}` or `{approve: false}` with a verified SECURITY_ADMIN credential. Success returns `{id, status, resolved_by, executed: false}`. Expired/replayed/changed-policy proposals return 409; unknown proposals return 404. Resolution never executes tools or creates a reusable grant. Pending operations bind the policy configuration/digest captured together at evaluation.

`POST /api/redteam/run` accepts no body or `{}`, requires SECURITY_ADMIN, and admits one run per ten seconds. Admission and latest results are shared/persisted with configured SQLite state. Runs use isolated quotas and one pinned policy snapshot, reported by version/digest, and do not hold the live gateway lock. A concurrent run within a runner is refused; invalid corpora return 503.

The frontend caps complete successful response bodies at 512 KiB, collections at 100 events, reasons at 1,024 characters, identifiers at 128, and miscellaneous JSON at 16 nesting levels/10,000 nodes, with a ten-second transport/read deadline. Non-2xx responses abort the transport and initiate unread-body cancellation before throwing the sanitized endpoint/status error; arbitrary error bodies are never rendered. Cleanup handles size failures, interruptions, timeouts and parsing failures, releases reader locks/listeners/timers, and never waits for a cancellation promise that could stall or reject. Contract validation occurs after the stream has been fully consumed. API/error responses include server `Cache-Control: no-store`.

Dashboard event/feed/evaluation normalization rejects unexpected raw `prompt`, `output`, `source`, `tool`, `tool_arguments`, credential, authorization, token, password, secret, API-key, stack and traceback fields, including case and underscore/hyphen aliases. Sensitive fields cannot silently become a successful dashboard result; rejection uses the sanitized contract error and clears stale success. Event responses also reject `sanitized_output`. Evaluation responses may contain `sanitized_output` only for ALLOW/REDACT; the dashboard omits that legitimate permitted content from its view. BLOCK/REQUIRE_APPROVAL/THROTTLE content is refused. Unexpected non-sensitive metadata remains omitted for compatibility. Administrative JSON endpoints not displayed in this dashboard retain bounded generic JSON validation and are not certified as typed reporting/export interfaces.

Trusted attack-corpus files are capped at 256 KiB and 100 cases. Duplicate JSON keys at any nesting level (including escaped-equivalent names) and nonfinite constants or overflowed numbers are invalid. They produce sanitized 503 with persisted `failed` runner status and no completed/green results; they never rewrite expectations through last-value-wins parsing.

## Admission, audit retention and storage errors

All HTTP admissions, including health/preflight, use fixed ten-second windows before policy loading, body buffering or evaluation. Without a verified configured bearer credential, the shared global limit is 120 requests/window. Configured credentials use a separate global limit of 1,200/window and 120/window per principal; current policy membership and endpoint role authorization must still pass. Source addresses, forwarding headers, body identities, claimed roles and decisions cannot choose limiter keys or grant authorization. Admission refusal returns 429 `{detail: "Request admission limit exceeded"}` with `Retry-After: 10`. Limits are fixed server constants and workers must run identical code/configuration. At most 1,002 live keys exist; expiration removes keys and clock rollback grants no fresh allowance. Cross-origin browser preflights have no credential and share the untrusted allowance; the same-origin dashboard proxy avoids this availability dependency.

The gateway retains the latest 2,000 protected events independently from rejection telemetry. Admitted authenticated evaluation outcomes retain evidence for ALLOW, BLOCK, REDACT, REQUIRE_APPROVAL and THROTTLE; authenticated identity mismatch and administrative execution/resolution outcomes are also protected. Pre-evaluation access/body/schema rejections and public local-demo evaluations use the telemetry pool. Server call sites assign `evidence_class`; submitted claims cannot select protected capacity. Existing legacy retained records are preserved in protected capacity on the next successful state transaction, with `legacy_preserved` metadata; no old evidence is classified using its body-derived strings.

Rejection telemetry keeps at most 256 sanitized samples, admitting at most 16 samples per ten-second window. Fixed reason/decision counters aggregate recorded rejections; `admission_denied` counts requests refused before audit sampling. `dropped_samples` counts omitted/overwritten telemetry samples and admission refusals without samples. Counters saturate at signed 63-bit maximum. `/api/events` merges protected events and retained samples with the existing ownership filters; unretained telemetry response IDs are correlation identifiers and can return 404. Administrator stats expose `retention` and `abuse`; no submitted body/token/address is stored in admission counters. Stats represent aggregated counts and sampled latency, not an immutable archive or exact event inventory.

SQLite serializes shared quotas, telemetry, protected evidence, budget reservations and approvals across workers on one local filesystem. Limiter/telemetry transactions touch a separate small row and cannot rewrite or evict protected events. Required protected state and audit writes commit before success. Restart preserves active wall-clock windows, counters, samples and protected evidence; memory-only local-demo resets on restart and supports one worker. Corrupt persisted data is preserved and refused instead of reset. Before response headers are sent, any sqlite3.Error in admission, body/rejection handling or downstream persistence returns 503 `{detail: "Security state unavailable; request refused"}` through the security-header path, including no-store. The outage path never writes another audit event; after headers start, the error terminates the response without a second response.

Only read_resource/export_resource tool proposals are allowlisted. Arguments must contain exactly resource and destination, each equal to the outer request, and action must match read/export. Arguments without a tool, unknown tools, mismatches and extra arguments block under tool_guard. No tool is executed.

Evaluation fields:

| Field | Type |
| --- | --- |
| decision | canonical Decision |
| policy | string identifying deciding guard/rule |
| reason | sanitized explanation string |
| event_id | generated UUID string |
| latency_ms | measured, nonnegative number |
| sanitized_output | optional string, only when supplied output is authorized and decision is ALLOW/REDACT |

```json
{
  "decision": "BLOCK",
  "policy": "portfolio_restricted",
  "reason": "ANALYST cannot access RESTRICTED resource",
  "event_id": "00000000-0000-4000-8000-000000000001",
  "latency_ms": 0.2
}
```

The same request as manager_1/PORTFOLIO_MANAGER yields ALLOW/portfolio_restricted. That manager with destination EXTERNAL yields BLOCK/external_exfiltration regardless of prompts, source/injection signals or tool proposals. Other non-public data also cannot leave INTERNAL destinations. Authorized recognizable secret output yields REDACT/output_secrets and sanitized_output; rejected/pending/throttled requests return no output. Budget exhaustion yields THROTTLE/budget; authorized internal portfolio export yields REQUIRE_APPROVAL/portfolio_restricted.

HTTP 422 and HTTP 413 use the **same Evaluation envelope**, with BLOCK/fail_closed, generated event_id and measured latency_ms. Reasons are respectively `Malformed request` and `Request body too large`. Their events contain null context; raw error inputs are never copied into responses or audit. The validation handler also applies to invalid query parameters and other endpoint bodies. HTTP 404 and other explicit endpoint errors instead use `{ "detail": "sanitized message" }`.

## Audit listing and detail

`GET /api/events?limit=100`: integer limit 1–2,000, default 100. Response is `{ "events": [...] }`, newest first; empty is `{ "events": [] }`. `GET /api/events/{id}` returns the matching Event directly; 404 is `{ "detail": "Event not found" }`, including an evicted event.

Event fields are always present, except `action` may be absent on older servers:

| Field | Type/meaning |
| --- | --- |
| id | UUID string; matches evaluation.event_id |
| timestamp | UTC ISO 8601 string |
| decision, policy, reason, latency_ms | Same values as evaluation |
| category | string, currently equal to policy |
| request_id | string or null; secret-like values redacted |
| user | known registered user string or null |
| role | canonical Role or null |
| action | read, export, or null; additive attempted-action field |
| resource | known policy resource string or null |
| classification | canonical Classification or null |
| destination | INTERNAL, EXTERNAL, or null |

```json
{
  "events": [{
    "id": "00000000-0000-4000-8000-000000000001",
    "timestamp": "2026-10-03T14:00:00+00:00",
    "request_id": null,
    "user": "analyst_42",
    "role": "ANALYST",
    "action": "read",
    "category": "portfolio_restricted",
    "resource": "portfolio/current_positions",
    "classification": "RESTRICTED",
    "destination": "INTERNAL",
    "decision": "BLOCK",
    "policy": "portfolio_restricted",
    "reason": "ANALYST cannot access RESTRICTED resource",
    "latency_ms": 0.2
  }]
}
```

Null means unavailable, not an empty string or a fabricated identity/classification. Malformed requests record all nullable metadata as null, even if part of the raw input resembles valid context. A mixed list of ordinary and validation events is valid. Audits never include prompt, source, output, sanitized_output, tool_arguments, or credentials. Keep canonical validation and ID matching when normalizing for display.

## Stats

`GET /api/stats` always returns total_events, retained_events, decisions, latency_ms, budgets, approvals, redteam, unexpected_allows. Fresh valid-policy process example:

```json
{
  "total_events": 0,
  "retained_events": 0,
  "decisions": {"ALLOW": 0, "BLOCK": 0, "REDACT": 0, "REQUIRE_APPROVAL": 0, "THROTTLE": 0},
  "latency_ms": {"samples": 0, "mean": null, "max": null},
  "budgets": {
    "requests_used": 0, "tokens_used": 0,
    "requests_limit_per_user": 60, "tokens_limit_per_user": 32000,
    "window_seconds": 60, "accounting": "conservative_character_units"
  },
  "approvals": {},
  "redteam": {"status": "not_run", "total": 0, "unexpected_allows": 0},
  "unexpected_allows": 0
}
```

- total_events and all five decision counts are lifetime counts for this process, including sanitized validation failures and approval-resolution events. The event buffer retains at most 2,000; retained_events may be lower than total_events.
- latency_ms.samples counts retained events; mean/max are numbers when samples exist, otherwise null. These measured engine intervals are not network round-trip latency or throughput benchmarks.
- budgets.requests_used/tokens_used are aggregate usage across users in the current sliding window; *_limit_per_user are limits for each user, not an aggregate denominator. Units are max(estimated_tokens, prompt/source/output character count, 1), explicitly conservative_character_units: not actual tokenizer usage or billing. Denied requests do not consume model budget. Policy reload does not clear counters.
- If no policy has ever loaded, budgets contains only requests_used:0, tokens_used:0 and accounting; limit/window keys are absent. A previously loaded policy may still supply these limits after a failed reload.
- approvals is a sparse integer map with pending/approved/denied/expired/invalidated keys when present; omitted counts mean zero. The records are bounded to 2,000 and expire after five minutes; counters are not lifetime totals.
- redteam is the latest Run object **without results**. Other fields depend on its status, as below. Top-level unexpected_allows mirrors the latest actual run and equals zero before a run/after a corpus failure; neither state establishes successful testing.

## Policy status

```json
{
  "loaded": true,
  "version": "demo-v1",
  "rule_count": 4,
  "last_reload": "2026-10-03T14:00:00+00:00",
  "error": null
}
```

Fields: loaded boolean; version string|null; rule_count integer (resource-policy count); last_reload UTC ISO string|null; error null or `Policy unavailable or invalid`.

Policy is policies/default.yaml unless AEGIS_POLICY_PATH is set. Evaluation/status requests check content changes and strictly validate the whole file. Missing, malformed, duplicated, aliased or oversized policy fails closed. Invalid reload preserves last successful version/count/timestamp for diagnostics but **loaded:false** means evaluation is disabled; retained version is not proof of an active policy. If never loaded: version/last_reload null, rule_count 0, loaded false, error string. Repairing the file restores readiness. Prefer atomic file replacement.

## Red-team run and results

POST /api/redteam/run accepts no body, JSON null or `{}`. GET /api/redteam/results returns the latest variant below. Stats.redteam omits only results. Cases use the real Gateway in a separate instance with fresh budgets, not mock outcomes or live audit/quota state. Default corpus has 16 cases.

NotRun:

```json
{"status":"not_run","results":[],"total":0,"unexpected_allows":0}
```

FailedRun (POST returns HTTP 503 with detail `Red-team corpus unavailable or invalid`; GET returns this object):

```json
{"status":"failed","results":[],"total":0,"unexpected_allows":0,"error":"Red-team corpus unavailable or invalid"}
```

CompletedRun fields:

| Field | Type |
| --- | --- |
| status | literal completed |
| run_id, timestamp | UUID string, UTC ISO string |
| policy_version | string or null |
| total, passed, failed, unexpected_allows | integers |
| latency_ms | nonnegative measured whole-run number |
| results | array of CaseResult |

CaseResult example:

```json
{"id":"analyst_restricted","expected":"BLOCK","actual":"BLOCK","passed":true,"policy":"portfolio_restricted","reason":"ANALYST cannot access RESTRICTED resource","latency_ms":0.2}
```

expected/actual are all five canonical decisions. passed is a boolean equality check, and failed counts every mismatch. unexpected_allows counts only expected BLOCK / actual ALLOW. A completed run can have failures; status completed only means execution finished. An invalid policy may produce a completed run with positive-case failures and null policy_version. A failed/unstarted run must never render as passed; zero unexpected_allows alone is insufficient evidence.

## Approval resolution

Use event_id from an authorized REQUIRE_APPROVAL evaluation as `{id}`. Demo request:

```http
POST /api/approvals/<event_id>
Content-Type: application/json
X-Aegis-User: security_admin_1

{"approve":true}
```

`approve` is a required strict boolean; false means deny. Success shape:

```json
{"id":"00000000-0000-4000-8000-000000000001","status":"approved","resolved_by":"security_admin_1","executed":false}
```

status is approved or denied; id matches the pending event, resolved_by is the registered admin user and executed is always false. Approval records an additional sanitized approval_resolution audit event (REQUIRE_APPROVAL when approved, BLOCK when denied). It never executes tools, grants reusable authorization, or lets SECURITY_ADMIN read restricted business data. Another export request still requires approval.

| HTTP | Outcome |
| --- | --- |
| 403 | Missing/non-admin identity or invalid policy: detail `A valid SECURITY_ADMIN identity is required` |
| 404 | With valid admin context, unknown id: detail `Approval not found` |
| 409 | Expired/resolved/replayed: detail `Approval is no longer pending` |
| 409 | Changed policy/authorization: detail `Policy or authorization changed; evaluate again`; record invalidated |
| 422 | Missing/wrong approve or unknown body fields: sanitized Evaluation BLOCK envelope |

Authorization is checked before id lookup, so missing identity returns 403 even for an unknown id.

## Minimal offline chat

POST /v1/chat/completions requires messages (1–16 objects, role system/user/assistant, content up to 4,000 characters each) and security (EvaluateRequest). Optional model defaults aegis-offline-demo; stream only false; max_tokens strict integer 1–4,096, default 128. The same body limit/unknown-field checks apply.

The backend combines message content, replaces security.prompt/output with its offline fixture text, reserves max(declared estimate, combined prompt length + max_tokens), and runs the same deterministic engine/output inspection. On ALLOW/REDACT, HTTP 200 contains id (`chatcmpl-...`), object chat.completion, created epoch integer, model aegis-offline-demo, choices with index 0/message role assistant/content/finish_reason stop, and aegis containing Evaluation fields without sanitized_output. BLOCK/REQUIRE_APPROVAL use HTTP 403; THROTTLE uses 429, both with Evaluation envelope and no completion. No live model or semantic classifier is implemented, no tool executes, and the accepted response explicitly says no live portfolio data is loaded.

## State and setup

Use backend/requirements-lock.txt for reproducible installation; see backend/README.md. One process/worker only: audit, approval and quota state are bounded in memory and reset on restart. Semantic checks, authentication and real model/data integrations are not established by this demo. Confirm competition scope with the mentor before making claims about them.
