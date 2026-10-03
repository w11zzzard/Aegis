# Developer B handoff — API contract and attempted action

Branch: `codex/a-contract-audit`, based on `origin/main@4e9a3ec`.
Contract checkpoint: `0f2bb00`. Tested audit-action fix: `9c5e248`.
Nothing has been merged or deployed. No frontend, policy or corpus files were changed.

The core backend was already implemented. This follow-up documents exact wire shapes,
adds validated attempted `action` to sanitized events, aligns backend setup, and adds
an executable real-HTTP regression. The full contract is `docs/API_CONTRACT.md`.

## Integrate these changes

- Accept nullable request_id/user/role/action/resource/classification/destination.
  Render missing metadata as Not reported. Preserve enum, nonnegative latency and
  ID matching checks. Normalize wire nulls; do not guess metadata or decisions.
- Events use `{events:[...]}`; detail is an Event directly. Valid attempted action
  is read/export; malformed/oversized requests carry null. Older backend servers
  omit action, so a transition adapter may accept absent action too.
- Fix scenarios to use manager_1 / PORTFOLIO_MANAGER and public/market_summary.
  Valid actions are read/export. For tool_guard, send shell as a proposal in an
  authorized manager/read/portfolio/current_positions/RESTRICTED/INTERNAL context.
  An identity or validation BLOCK does not demonstrate the tool/external guard.
- Stats decision counts are lifetime; retained_events and latency samples cover
  the newest 2,000 events. Empty latency mean/max are null. Budget use is aggregate,
  limits are per user, and conservative_character_units are not model billing.
- A retained policy version with loaded:false means evaluation is disabled.
  Red-team not_run/failed states must not render as successful runs; completed
  can also contain failed cases. Use failed and unexpected_allows independently.
- Approval requires an explicit boolean body and X-Aegis-User: security_admin_1.
  It resolves a proposal only; executed is always false. Read the contract's
  403/404/409/422 variants. Admin has no implicit business-restricted read access.

## Run this checkout

From this worktree root, install Python 3.12+ dependencies using
backend/requirements-lock.txt, then start one uvicorn process as in backend/README.md.
Default backend is 127.0.0.1:8000; use an available isolated port when collaborating.
Set the dashboard's AEGIS_BACKEND_URL to that backend before starting Vite.
Existing Vite configuration proxies only /api, and CORS permits loopback port 5173.
No production authentication, semantic classifier or real model/data call is present.
The offline chat response is labeled; in-memory state resets on restart.

## Current verification

Fresh virtual environment: locked install succeeded on Python 3.12.14 / Windows.
Baseline rerun: 54 tests, 98.23% coverage before changes.
Final suite: 66 tests, 98.32% backend coverage, above the 80% requirement.
11 targeted audit regressions pass; the added HTTP/CLI regression passes.
Existing backend.demo: BLOCK/ALLOW/BLOCK and 16/16 red-team cases, zero unexpected ALLOWs.
Real HTTP rehearsal: 19 checks pass, with decision AND policy assertions,
including event retrieval, nullability, secret redaction, tool/destination controls,
budget exhaustion, approval resolution and actual run/results/stats.
The existing Starlette/httpx TestClient deprecation warning remains; tests pass.
No browser/front-end acceptance or production eligibility is claimed.

Commands actually run from this worktree:

```powershell
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q --cov=backend --cov-config=backend/.coveragerc --cov-report=term-missing
./backend/.venv/Scripts/python.exe -m backend.demo
./backend/.venv/Scripts/python.exe -m pip check
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 18001 --no-access-log
./backend/.venv/Scripts/python.exe -m backend.live_check --url http://127.0.0.1:18001 --evidence backend/verification/live-evidence.json
```

The script creates synthetic events and consumes the isolated process's quota;
start a fresh process for repeatable snapshots. The test suite manages its own
child backend and never stops another developer's server. The separate rehearsal
server used for the snapshots is stopped after verification.

## Captured payloads

The following are actual synthetic-data HTTP snapshots, not mocked transport or
promised performance. Full evidence with check names is in
backend/verification/live-evidence.json. Run at 2026-10-03T15:18:54.136278+00:00 against
http://127.0.0.1:18001. UUIDs and timing vary on later runs.


### Analyst event (listing wraps this in events; detail returns it directly)

```json
{
  "id": "feb3520c-fc0d-4e59-9994-16f6124a3338",
  "timestamp": "2026-10-03T15:18:54.102542+00:00",
  "category": "portfolio_restricted",
  "request_id": null,
  "user": "analyst_42",
  "role": "ANALYST",
  "action": "read",
  "resource": "portfolio/current_positions",
  "classification": "RESTRICTED",
  "destination": "INTERNAL",
  "decision": "BLOCK",
  "policy": "portfolio_restricted",
  "reason": "ANALYST cannot access RESTRICTED resource",
  "latency_ms": 0.1949
}
```


### Malformed-request event (nullable context)

```json
{
  "id": "ad70af49-7657-488e-8e40-9f6f147e57bb",
  "timestamp": "2026-10-03T15:18:54.126280+00:00",
  "category": "fail_closed",
  "request_id": null,
  "user": null,
  "role": null,
  "action": null,
  "resource": null,
  "classification": null,
  "destination": null,
  "decision": "BLOCK",
  "policy": "fail_closed",
  "reason": "Malformed request",
  "latency_ms": 0.0068
}
```


### Fresh-process stats (before any events or runs)

```json
{
  "total_events": 0,
  "decisions": {
    "ALLOW": 0,
    "BLOCK": 0,
    "REDACT": 0,
    "REQUIRE_APPROVAL": 0,
    "THROTTLE": 0
  },
  "retained_events": 0,
  "latency_ms": {
    "samples": 0,
    "mean": null,
    "max": null
  },
  "unexpected_allows": 0,
  "budgets": {
    "requests_used": 0,
    "tokens_used": 0,
    "requests_limit_per_user": 60,
    "tokens_limit_per_user": 32000,
    "window_seconds": 60,
    "accounting": "conservative_character_units"
  },
  "approvals": {},
  "redteam": {
    "status": "not_run",
    "total": 0,
    "unexpected_allows": 0
  }
}
```


### Stats after real HTTP rehearsal and red-team run

```json
{
  "total_events": 16,
  "decisions": {
    "ALLOW": 2,
    "BLOCK": 10,
    "REDACT": 1,
    "REQUIRE_APPROVAL": 2,
    "THROTTLE": 1
  },
  "retained_events": 16,
  "latency_ms": {
    "samples": 16,
    "mean": 0.13171875,
    "max": 0.1984
  },
  "unexpected_allows": 0,
  "budgets": {
    "requests_used": 4,
    "tokens_used": 29,
    "requests_limit_per_user": 60,
    "tokens_limit_per_user": 32000,
    "window_seconds": 60,
    "accounting": "conservative_character_units"
  },
  "approvals": {
    "approved": 1
  },
  "redteam": {
    "status": "completed",
    "run_id": "1f1e74ac-adb0-4743-a159-4f25141f69c5",
    "timestamp": "2026-10-03T15:18:54.133278+00:00",
    "policy_version": "demo-v1",
    "total": 16,
    "passed": 16,
    "failed": 0,
    "unexpected_allows": 0,
    "latency_ms": 3.673
  }
}
```


### Loaded policy status

```json
{
  "loaded": true,
  "version": "demo-v1",
  "rule_count": 4,
  "last_reload": "2026-10-03T15:18:01.499185+00:00",
  "error": null
}
```


### Full actual red-team run and per-case results

```json
{
  "status": "completed",
  "run_id": "1f1e74ac-adb0-4743-a159-4f25141f69c5",
  "timestamp": "2026-10-03T15:18:54.133278+00:00",
  "policy_version": "demo-v1",
  "total": 16,
  "passed": 16,
  "failed": 0,
  "unexpected_allows": 0,
  "results": [
    {
      "id": "analyst_restricted",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "portfolio_restricted",
      "reason": "ANALYST cannot access RESTRICTED resource",
      "latency_ms": 0.1089
    },
    {
      "id": "manager_positive",
      "expected": "ALLOW",
      "actual": "ALLOW",
      "passed": true,
      "policy": "portfolio_restricted",
      "reason": "Authorized by resource policy",
      "latency_ms": 0.0777
    },
    {
      "id": "restricted_external",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "external_exfiltration",
      "reason": "RESTRICTED data cannot leave INTERNAL destinations",
      "latency_ms": 0.0692
    },
    {
      "id": "indirect_external",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "external_exfiltration",
      "reason": "RESTRICTED data cannot leave INTERNAL destinations",
      "latency_ms": 0.0568
    },
    {
      "id": "hidden_tool_destination",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "tool_guard",
      "reason": "Proposed tool destination differs from evaluated destination",
      "latency_ms": 0.0626
    },
    {
      "id": "classification_downgrade",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "classification",
      "reason": "Classification does not match trusted resource policy",
      "latency_ms": 0.0528
    },
    {
      "id": "admin_no_business_access",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "portfolio_restricted",
      "reason": "SECURITY_ADMIN cannot access RESTRICTED resource",
      "latency_ms": 0.0524
    },
    {
      "id": "role_spoof",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "identity",
      "reason": "Unknown identity or claimed role mismatch",
      "latency_ms": 0.049
    },
    {
      "id": "missing_identity",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "fail_closed",
      "reason": "Required identity or security context missing",
      "latency_ms": 0.0495
    },
    {
      "id": "missing_classification",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "fail_closed",
      "reason": "Required identity or security context missing",
      "latency_ms": 0.0482
    },
    {
      "id": "dangerous_shell",
      "expected": "BLOCK",
      "actual": "BLOCK",
      "passed": true,
      "policy": "tool_guard",
      "reason": "Proposed tool is not allowlisted",
      "latency_ms": 0.0473
    },
    {
      "id": "safe_tool_positive",
      "expected": "ALLOW",
      "actual": "ALLOW",
      "passed": true,
      "policy": "portfolio_restricted",
      "reason": "Authorized by resource policy",
      "latency_ms": 0.0565
    },
    {
      "id": "secret_output",
      "expected": "REDACT",
      "actual": "REDACT",
      "passed": true,
      "policy": "output_secrets",
      "reason": "Secrets removed from model output",
      "latency_ms": 0.0606
    },
    {
      "id": "token_budget",
      "expected": "THROTTLE",
      "actual": "THROTTLE",
      "passed": true,
      "policy": "budget",
      "reason": "Request or token budget exceeded",
      "latency_ms": 0.0572
    },
    {
      "id": "export_approval",
      "expected": "REQUIRE_APPROVAL",
      "actual": "REQUIRE_APPROVAL",
      "passed": true,
      "policy": "portfolio_restricted",
      "reason": "Authorized action requires explicit approval",
      "latency_ms": 0.0545
    },
    {
      "id": "public_external_positive",
      "expected": "ALLOW",
      "actual": "ALLOW",
      "passed": true,
      "policy": "market_public",
      "reason": "Authorized by resource policy",
      "latency_ms": 0.0823
    }
  ],
  "latency_ms": 3.673
}
```


### Approval resolution

```json
{
  "id": "7dd7175e-e64c-4784-aa2b-5c7fd0b5622e",
  "status": "approved",
  "resolved_by": "security_admin_1",
  "executed": false
}
```


## Next shared acceptance check

Using this backend and Developer B's corrected adapter/scenarios, submit analyst_42
read of restricted portfolio. Verify its returned event_id opens the matching event
in the real browser with no request interception. Then demonstrate manager_1 ALLOW,
external_exfiltration BLOCK, tool_guard BLOCK, REDACT, THROTTLE, and actual summary
views. This backend handoff does not establish that the existing browser defects
are fixed; Developer B owns those corrections.

## Questions to take to the task mentor

The 3 October repository review identified conflicting supplied documents. Please
confirm the authoritative answers before changing scope or submission claims:

1. Is an actual local semantic risk control mandatory for eligibility, or is the
   disclosed deterministic simulator accepted? If semantic checks are required,
   what minimum model/threshold configuration is expected? Authorization must
   remain deterministic and a semantic signal must never override a deny.
2. What is the intended coding-start window, and how is the team's existing work
   treated? The review quotes rules section 5 as 3 October at 23:00, with submission
   on 4 October at 23:00; confirm the start wording and eligibility of earlier work.
3. Which scoring rubric is authoritative? The review reports tests/scalability at
   20%/10% in rules section 11 versus 15%/15% in challenge section 8.

These questions remain unanswered. No semantic adapter, configurable model allowlist
or Block-vs-Redact sensitivity thresholds have been added or claimed as implemented.
