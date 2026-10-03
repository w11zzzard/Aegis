# AEGIS dashboard

React, TypeScript, Vite, and Zod runtime validation. B's integration through `f576258` is now combined with the contract/audit work on `codex/a-contract-audit`. See `../docs/INTEGRATED_VERIFICATION.md` for the shared checkpoint and current evidence.

Every decision, event, count, latency, policy status, and corpus result comes from the backend. Test fixtures are confined to tests. The application has no mock mode.

## Start

Use Node 22 and the locked installation, from `frontend/`:

```powershell
npm ci
$env:AEGIS_BACKEND_URL='http://127.0.0.1:8000'
npm run dev -- --port 5173 --strictPort
```

Start the backend separately following `../backend/README.md` and its locked requirements. Do not stop another developer's server. Choose unused ports and use `--strictPort` so Vite cannot silently move.

For an isolated local backend, from the repository root:

```powershell
python -m venv frontend/.integration-venv
frontend/.integration-venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
$env:PYTHONDONTWRITEBYTECODE='1'
frontend/.integration-venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8010
```

In a second terminal, from `frontend/`, set `AEGIS_BACKEND_URL=http://127.0.0.1:8010` and start Vite on an unused port. The backend proxy handles `/api`; it avoids changing backend CORS for isolated frontend ports.

Configuration:

| Setting | Purpose |
| --- | --- |
| AEGIS_BACKEND_URL | Vite development proxy target; default http://127.0.0.1:8000 |
| VITE_API_BASE_URL | Optional browser API origin, set before build; empty uses same-origin /api |
| AEGIS_API_URL | Live HTTP acceptance target; default http://127.0.0.1:8000 |
| AEGIS_FRONTEND_PORT | Browser-suite Vite port; default 5174, strict and never reused automatically |
| AEGIS_FRONTEND_URL | Explicit existing frontend URL; browser suite then starts no server |
| PLAYWRIGHT_CHANNEL | chrome or msedge for an installed browser; otherwise install Playwright Chromium |
| AEGIS_REAL_BROWSER | Set 1 for the separate real browser journey; remove for fixture browser tests |
| AEGIS_QUOTA_FRONTEND_URL | Optional second frontend against a fresh isolated two-request policy; enables the real quota browser check |

Production hosting must proxy `/api` when VITE_API_BASE_URL is empty. A direct API origin requires backend CORS permission. Environment settings are not credentials.

## Checks

Fixture unit/component tests and production build:

```powershell
npm test
npm run test
npm run test:coverage
npm run build
npm audit
```

Fixture browser suite (intercepts API responses only in test code):

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
Remove-Item Env:AEGIS_REAL_BROWSER -ErrorAction SilentlyContinue
npm run test:e2e
```

If no supported browser is installed: `npx playwright install chromium`, then remove PLAYWRIGHT_CHANNEL.

Separate real HTTP and browser checks, with a running backend and unused frontend port:

```powershell
$env:AEGIS_API_URL='http://127.0.0.1:8010'
$env:AEGIS_BACKEND_URL=$env:AEGIS_API_URL
$env:AEGIS_FRONTEND_PORT='5174'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:live
npm run test -- --config vitest.live.config.ts --reporter=verbose
$env:AEGIS_REAL_BROWSER='1'
npm run test:e2e
Remove-Item Env:AEGIS_REAL_BROWSER
```

Real checks send proposals, create audit/approval records, consume real sliding-window quotas, and run the committed corpus. Use a dedicated backend process with the default policies for reproducible runs. They never intercept responses. Repeated runs against a heavily used process can legitimately throttle; that is a failure to meet demo expectations, not a reason to substitute results.

## Demo journey

Choose a scenario, evaluate, then inspect the returned audit ID. The UI displays the actual backend decision and flags a mismatch with the expected decision **or policy**.

| Scenario | Identity and proposal | Expected decision / policy |
| --- | --- | --- |
| Public read | analyst_42 / ANALYST, public/market_summary, PUBLIC, read, INTERNAL | ALLOW / market_public |
| Analyst restricted read | analyst_42 / ANALYST, portfolio/current_positions, RESTRICTED, read, INTERNAL | BLOCK / portfolio_restricted |
| Manager restricted read | manager_1 / PORTFOLIO_MANAGER, same restricted read | ALLOW / portfolio_restricted |
| Restricted external | Authorized manager restricted read, EXTERNAL | BLOCK / external_exfiltration |
| Unsafe tool | Authorized manager restricted read, INTERNAL; shell with synthetic command arguments | BLOCK / tool_guard |
| Synthetic secret output | Authorized public read with synthetic sk- secret output | REDACT / output_secrets |
| Budget limit | Authorized public read, estimated_tokens 1000000 | THROTTLE / budget |

Tool requests are proposals only; no tool executes. Sanitized output is accepted only from the evaluation response and shown only for ALLOW/REDACT. It is never admitted into audit events.

Refresh events to inspect mixed normal, unknown-actor, and malformed-request records. Nullable audit context consistently renders **Not reported**. Missing action is supported for older servers; valid read/export is preserved. Required event structure, canonical decisions/roles, finite nonnegative latency, and detail ID matching remain strict. Unexpected payload fields are removed.

Summary panels show backend decision counts, retained-sample latency, aggregate budget usage, per-user limits, policy version/load/hot-reload status, and latest real corpus cases. Zero latency samples display unavailable. Budget units are labeled conservative_character_units. An unloaded policy remains unavailable even with a prior version. Not-run, failed, completed-with-case-failures, loading, errors and empty results are distinct. Failed refreshes clear previous successful snapshots. Use Refresh summaries to recheck status; audit/evaluation refreshes also reload summaries.

Evaluation HTTP 422/413 is accepted only for its validated, documented BLOCK/fail_closed envelope and exact reason. The result retains the HTTP status and event navigation. `http_status` is client metadata, never a backend contract field. Other error bodies produce sanitized errors.

## Approval scope and limitations

The typed client sends `{approve: boolean}` with `X-Aegis-User: security_admin_1` **only** on the approval operation. It validates matching ID, approved/denied status, demo admin resolver and executed:false; HTTP 403/404/409/422 have explicit safe guidance. Real tests resolve an authorized export and reject replay/missing approval.

A full approval UI is not included. Demo identities are not production authentication. No live model, data store or tool execution is claimed. Backend state is in-memory and resets on restart. Policy status is refreshed on demand rather than streamed.

## Historical B-only handoff

This section preserves the earlier B branch checkpoint. The current combined
checkout includes A's contract/audit commits; use `../docs/INTEGRATED_VERIFICATION.md`
and workspace `output/final-integration/` for the current handoff and evidence.

Read `../docs/API_CONTRACT.md` before changing schemas. At the base main commit that document lacked full summary/approval schemas and the action event field. Developer A's published `codex/a-contract-audit` checkpoint `071e57e` supplies them; its documented shapes match `src/schemas.ts` and `src/adapter.ts`. The frontend is compatible with older main responses and the new nullable action addition. The backend/contract checkpoint is not merged into this frontend branch.

Copyable handoff:

```text
Developer B: codex/b-dashboard-integration (frontend-only).
Contract compatibility checked against main 4e9a3ec and A's codex/a-contract-audit 071e57e.
Nullable context is normalized to absent/Not reported; read/export/null/older-absent action supported.
All seven demos assert decision + deciding policy. Registered identities are analyst_42 and manager_1.
Typed stats/policy/redteam schemas match the expanded API contract.
Approval uses {approve:boolean}; only that endpoint gets X-Aegis-User:security_admin_1.
No audit output is admitted. Sanitized output is restricted to ALLOW/REDACT evaluation display.
Please deliver A's additive audit-action and contract changes through your normal review flow.
No further backend behavior is needed for the verified dashboard journey.
Full approval UI is absent; client and actual resolve/replay/missing-ID checks are delivered.
Reproduce with AEGIS_API_URL and AEGIS_BACKEND_URL pointed at your isolated backend,
npm run test:live, npm run test -- --config vitest.live.config.ts --reporter=verbose,
then AEGIS_REAL_BROWSER=1 npm run test:e2e through the existing Vite proxy.
```

See `INTEGRATION_EVIDENCE.md` for checks, real audit IDs, coverage and commit checkpoints. Earlier `TDD_EVIDENCE.md` describes the original first slice, not this repair's current results.
