# AEGIS backend demo

One Python process, deterministic policy decisions, no external model or paid API.
The shared boundary is `docs/API_CONTRACT.md`; this implementation does not edit it.

## Start from repository root

Python 3.12+ is required. Install dependencies once (internet needed for installation);
all evaluation, red-team cases and offline chat then run without network access.

```powershell
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Linux/macOS: use `python3 -m venv backend/.venv`, then
`backend/.venv/bin/python` in place of the Windows interpreter path.
Run a single worker. Events, approval records and budget counters are in memory,
reset at process restart, and are not shared across workers. The event buffer retains
the newest 2,000 events; lifetime decision counts may exceed retained events.
Access logs are disabled to avoid recording credentials accidentally placed in URLs.

## Automated verification

```powershell
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q --cov=backend --cov-config=backend/.coveragerc --cov-report=term-missing
./backend/.venv/Scripts/python.exe -m backend.demo
```

The second command exercises the API in process and prints real decisions, measured
latencies and the actual red-team summary. It does not seed a separately running server.
The tested dependency set emits a Starlette deprecation warning for httpx TestClient;
tests remain executable with the committed lock file.

## First dashboard integration

Base URL: `http://127.0.0.1:8000`. CORS allows localhost/127.0.0.1 on port 5173.
Send the shared contract example unchanged:

```powershell
$body = @{
  user = 'analyst_42'; role = 'ANALYST'; action = 'read'
  resource = 'portfolio/current_positions'; classification = 'RESTRICTED'
  destination = 'INTERNAL'
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/security/evaluate -Method Post -ContentType application/json -Body $body
Invoke-RestMethod http://127.0.0.1:8000/api/events
```

For the ALLOW control use `user: manager_1`, `role: PORTFOLIO_MANAGER`.
For the unconditional exfiltration block use that same manager with `destination: EXTERNAL`.

Developer B integration details (the contract leaves collection envelopes unspecified):

| Endpoint | Response shape / behavior |
| --- | --- |
| `GET /health` | `{status: "ok"}`; liveness, not policy readiness |
| `POST /api/security/evaluate` | Contract fields: decision, policy, reason, event_id, latency_ms |
| `GET /api/events?limit=100` | `{events: [...]}`, newest first; limit 1–2,000 |
| `GET /api/events/{id}` | Event object directly; 404 if unavailable |
| `GET /api/stats` | total_events, retained_events, decisions, latency_ms, budgets, approvals, redteam, unexpected_allows |
| `GET /api/policies/status` | loaded, version, rule_count, last_reload, error |
| `POST /api/redteam/run` | No body or `{}`; full actual run summary with results |
| `GET /api/redteam/results` | Latest run; status `not_run`, `completed`, or `failed` |
| `POST /api/approvals/{id}` | Body `{approve: true}` or `{approve: false}`; header `X-Aegis-User: security_admin_1` |
| `POST /v1/chat/completions` | Non-streaming demo; messages plus required security context; choices and aegis decision metadata |

These envelopes are documented here for the dashboard adapter; no shared-contract
fields were removed or renamed. Decisions are HTTP 200 on evaluation, including
BLOCK/THROTTLE. Malformed input returns HTTP 422 with a sanitized BLOCK event;
an oversized body returns 413 with a sanitized BLOCK event. Display the backend decision directly.
For authorized `output` evaluation, `sanitized_output` is returned as an additional
response field; output contents never appear in event views. Blocked, throttled or
pending requests never return output. Chat returns 403 on BLOCK/REQUIRE_APPROVAL,
429 on THROTTLE, and a minimal completion on ALLOW/REDACT. The offline completion
is explicitly labeled and contains no live portfolio data or model-generated answer.

## Identity and policy configuration

This is a loopback demo and policy-evaluation simulator. Its identity selector is
not a login mechanism: local callers can choose a registered demo user. The engine
checks that the requested role exactly matches the trusted YAML identity registry;
it never takes authorization from a prompt or LLM. Before serving real data or
exposing the service beyond localhost, bind identity to an authenticated principal
and protect audit/admin routes. No actual confidential document store is connected.

| Demo user | Server-registered role |
| --- | --- |
| intern_1 | INTERN |
| analyst_42 | ANALYST |
| senior_1 | SENIOR_ANALYST |
| manager_1 | PORTFOLIO_MANAGER |
| security_admin_1 | SECURITY_ADMIN |

`policies/default.yaml` is the trusted local policy catalog; set `AEGIS_POLICY_PATH`
to select another file. Resource classification is authoritative: caller downgrades
are blocked. Unknown identities/resources and missing or malformed context fail
closed. SECURITY_ADMIN has no default business-restricted access. Non-public data
cannot leave INTERNAL destinations; the RESTRICTED-to-EXTERNAL guard is hard-coded
and independent of RBAC, prompt wording, semantic detection, or proposed tools.

Edit YAML while running: each evaluation and status read checks file contents,
validates the whole file, and replaces the snapshot only on success. Invalid,
missing, duplicate-key, aliased or oversized files disable evaluation; status retains
the last successfully loaded version with `loaded: false`. Repairing the file
restores evaluation. Use atomic file replacement to avoid temporary partial saves.
Policy changes do not reset consumed budgets. No semantic detector is enabled.

## Tool, output and budget controls

Only `read_resource` and `export_resource` proposals are recognized. Both require
exactly `{resource, destination}` arguments matching the outer security context
and the corresponding read/export action. Other tools or unknown arguments block.
No proposal is executed, including approved proposals.

Secret inspection redacts recognizable API keys, AWS keys, GitHub/Slack tokens,
JWTs, credential assignments, bearer tokens, private keys and database URLs.
Fixtures are synthetic. Pattern matching cannot identify every arbitrary secret;
authorization and classification controls still run before any output is returned.
Prompts, sources, model output, tool arguments and confidential contents are never
retained in audits; validation errors omit their raw inputs.

Quotas use a sliding per-user window with an atomic lock. Authorized requests reserve
one request and at least one token-budget unit; units are the larger of declared
estimated_tokens and prompt/source/output character count. Stats label this as
`conservative_character_units`, not actual tokenizer usage or model billing. Denied
requests are audited but do not consume model budget. Exceeding a budget returns
THROTTLE without returning output. Lower `budgets.requests` to 2 for a quick demo.

Authorized portfolio export to INTERNAL requires approval. The returned event_id
is also the approval id. Approvals expire after five minutes, reject replay,
and invalidate when policy changes. Admin approval records a sanitized audit event
and resolves the proposal only; it does not grant business access or execute tools.
Requests to export continue to require approval because there is no execution lane.

## Real red-team evidence

`redteam/corpus.json` includes positive and negative cases and is executed by
the same Gateway implementation in an isolated instance with fresh counters.
Runs do not drain live users' budgets or insert test cases into the live audit feed.
Stats expose the latest actual run separately. `unexpected_allows` counts exactly
expected BLOCK / actual ALLOW; all other mismatches count as failed cases.
Missing/invalid corpora return 503 and a failed run status, never simulated success.
Tests intentionally weaken a portfolio policy and check that the runner reports
one unexpected ALLOW. Latencies use perf_counter; mean/max reflect retained live
event samples, not a promised throughput benchmark or network round-trip time.
