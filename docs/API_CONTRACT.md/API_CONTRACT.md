# AEGIS API contract — v1

This is the shared boundary between the backend and dashboard. The backend owner changes this document and implementation together. The frontend consumes it or adds a thin normalization adapter; coordinate before breaking changes.

## Canonical values

- Decision: ALLOW | BLOCK | REDACT | REQUIRE_APPROVAL | THROTTLE
- Classification: PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
- Role: INTERN | ANALYST | SENIOR_ANALYST | PORTFOLIO_MANAGER | SECURITY_ADMIN

SECURITY_ADMIN is not implicitly allowed to read business-restricted resources. Missing identity, classification, policy, or malformed tool input must fail closed for sensitive actions.

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
| POST | /v1/chat/completions | Minimal OpenAI-compatible path; only after core slice is stable |

## Evaluate request

    {
      "user": "analyst_42",
      "role": "ANALYST",
      "action": "read",
      "resource": "portfolio/current_positions",
      "classification": "RESTRICTED",
      "destination": "INTERNAL"
    }

Optional fields may include request_id, prompt, output, tool, tool_arguments, estimated_tokens, model and source. Enforce payload and string size limits.

## Evaluate response

    {
      "decision": "BLOCK",
      "policy": "portfolio_restricted",
      "reason": "ANALYST cannot access RESTRICTED portfolio data",
      "event_id": "uuid",
      "latency_ms": 2.8
    }

Latency is measured, never hard-coded. Event listings expose id, timestamp, request_id, user, role, category, resource, classification, destination, decision, policy and reason when known. Do not return prompts, credentials or full restricted content in audit views.

## First integration acceptance case

POST /api/security/evaluate with ANALYST, portfolio/current_positions, RESTRICTED and INTERNAL returns BLOCK and a portfolio_restricted audit event. The same request as PORTFOLIO_MANAGER returns ALLOW. Restricted data to an external destination returns BLOCK independently of prompt wording or semantic detector output.

## Reliability rules

- Security decisions come from the backend; the UI never infers authorization.
- Use only the canonical decision and classification values above.
- unexpected_allows counts red-team cases expected to BLOCK but actually ALLOW.
- A failed policy load must not silently replace a known policy with allow-all.
- Coordinate response-field changes before implementation.
