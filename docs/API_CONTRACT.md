# AEGIS API contract — v1.1

Shared interface between the backend and dashboard. Backend owner changes this contract with implementation. Frontend consumes it or adds a typed normalization adapter. Coordinate before breaking changes.

## Canonical values

- Decision: ALLOW | BLOCK | REDACT | REQUIRE_APPROVAL | THROTTLE
- Classification: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
- Role: INTERN | ANALYST | SENIOR_ANALYST | PORTFOLIO_MANAGER | SECURITY_ADMIN

SECURITY_ADMIN is not implicitly allowed to read business-restricted resources. Missing identity, classification, policy, or malformed tool input must fail closed for sensitive actions.

## Authentication and profiles

The default `authenticated` profile requires `Authorization: Bearer <credential>` for every route except minimal `/health` and CORS preflight. Independently generated credentials map to the trusted identity registry; `X-Aegis-User` never authorizes requests. User/role may be omitted in authenticated evaluations: the server derives them from the credential. Conflicting claims return a canonical BLOCK; invalid credentials return 401. Missing `AEGIS_STATE_PATH` or unavailable security state returns sanitized 503 without output.

Users can read only their own event collections/details. SECURITY_ADMIN can inspect all sanitized events, global stats, policy status and red-team results, run red-team cases and resolve approvals. Inaccessible event IDs return 404; docs/OpenAPI are disabled.

Explicit `local-demo` is a loopback-only synthetic evaluation profile with public simulator reads and selectable demo identities. Administrative writes still require a SECURITY_ADMIN bearer credential. Actual browser requests require an exact configured origin, including bodyless POSTs; defaults are localhost/127.0.0.1:5173. This profile must not be publicly proxied or connected to real data. `production` is unsupported and rejected at startup until its identity/TLS/runtime requirements are implemented and verified.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Liveness; no secrets |
| GET | /api/events | Recent sanitized audit events; newest first |
| GET | /api/events/{id} | One sanitized event |
| GET | /api/stats | Actual event/red-team counts, unexpected allows and budget use |
| GET | /api/policies/status | Loaded state, version, rule count and last reload |
| POST | /api/security/evaluate | Evaluate proposed access/action and write audit event |
| POST | /api/redteam/run | Run committed attack corpus against actual engine |
| GET | /api/redteam/results | Last actual run and per-case results |
| POST | /api/approvals/{id} | Resolve pending approval with explicit approve/deny body |
| POST | /v1/chat/completions | Minimal OpenAI-compatible path, only after core slice is stable |

## Evaluate request

    {
      "user": "analyst_42",
      "role": "ANALYST",
      "action": "read",
      "resource": "portfolio/current_positions",
      "classification": "RESTRICTED",
      "destination": "INTERNAL"
    }

Optional fields may include request_id, prompt, output, tool, tool_arguments, estimated_tokens, model and source. Requests are capped at 64 KiB with a ten-second body-receive deadline, 32 nesting levels and 10,000 JSON nodes; actual received chunks enforce the byte limit regardless of Content-Length. Oversized bodies return 413 BLOCK and receive timeouts 408 BLOCK. Ambiguous, malformed or excessive JSON returns a sanitized 422 BLOCK. Every media type parsed as JSON by the locked FastAPI is checked with the same MIME parser: application/json and application subtypes ending in +json, including case and parameter variants. Duplicate keys at every level are refused before schema validation or evaluation. Duplicate Content-Type headers return 400. The installed FastAPI uses strict content types: a nonempty body without a usable JSON Content-Type returns sanitized 422; bodyless administrative requests remain supported. No alternate JSON body route bypasses these safeguards.

## Evaluate response

    {
      "decision": "BLOCK",
      "policy": "portfolio_restricted",
      "reason": "ANALYST cannot access RESTRICTED portfolio data",
      "event_id": "uuid",
      "latency_ms": 2.8
    }

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

## First integration acceptance case

POST /api/security/evaluate with ANALYST, portfolio/current_positions, RESTRICTED and INTERNAL returns BLOCK and a portfolio_restricted audit event. The same request as PORTFOLIO_MANAGER returns ALLOW. Restricted data to an external destination returns BLOCK regardless of prompt wording or semantic detector output.

## Reliability rules

- Security decisions come from the backend; the UI never infers authorization.
- Use only canonical decision and classification values above.
- unexpected_allows counts red-team cases expected to BLOCK but actually ALLOW.
- A failed policy load must not silently replace a known policy with allow-all.
- Coordinate response-field changes before implementation.
