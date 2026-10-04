# AEGIS dashboard

React, TypeScript, Vite, and Zod runtime validation. The integrated dashboard is on GitHub `main`. Historical checkpoint reports remain in `../docs/`; current setup and wire behavior are documented here and in `../docs/API_CONTRACT.md`.

Every decision, event, count, latency, policy status, and corpus result comes from the backend. Test fixtures are confined to tests. The application has no mock mode.

## Start

Use Node 22 and the locked installation, from `frontend/`:

```powershell
npm ci
$env:AEGIS_BACKEND_URL='http://127.0.0.1:8000'
npm run dev -- --port 5173 --strictPort
```

Start the backend separately following `../backend/README.md` and its locked requirements. Do not stop another developer's server. Choose unused ports and use `--strictPort` so Vite cannot silently move.

Configure the backend using [backend/README.md](../backend/README.md). Its default authenticated mode requires private credentials and shared state. Enter your operator-provided credential under **API credential**. It stays in memory, travels in Authorization, and clears on disconnect/reload. Cookies are omitted and API redirects refused. Each preset must match the credential's identity. Use explicit loopback `local-demo` for the multi-identity simulation checks.

The dashboard verifies `/api/session` before loading global summaries. Ordinary users keep their own audit/evaluation workflow; SECURITY_ADMIN gets global summaries and the red-team action. Public local demos show synthetic observations but no administrative action until an admin credential is connected. Connecting/disconnecting aborts old requests, rejects late responses, and clears previous details/results/summaries. `VITE_API_BASE_URL` must be empty, a root-relative path, HTTPS, or explicit loopback HTTP; URL credentials, queries/fragments and non-local HTTP are refused. `npm run preview` proxies `/api` like the development server; both bind loopback by default.

```sh
npm test
npm run test
npm run test:coverage
npm run build
npm audit
```

The original multi-identity live check uses `AEGIS_API_URL` against an explicit `local-demo` backend and creates real synthetic events. `npm run test:integration` checks those events and presets through the adapter. For authenticated verification, build and run `npm run test:security` with `AEGIS_TEST_PYTHON` set to the backend interpreter; it starts fresh services and tests credential use, event ownership, role-aware summaries, disconnect and the rejected hostile-origin trigger. Results go to ignored `../output/release-verification/` unless `AEGIS_EVIDENCE_DIR` is explicitly configured. Set `AEGIS_OFFLINE_GUARD=1` for the separate runtime test that blocks external networking within its owned browser/Python test processes. Unit/default browser fixtures never enter application modules.

Response cleanup regressions run with `npx vitest run src/api-streams.test.ts`. A bounded real loopback HTTP peer independently observes socket disconnection for finite, oversized, endless and stalled 503 bodies, including missing or misleading Content-Length: `npx vitest run --config vitest.streams.config.ts`. The HTTP tests also run with the existing integration suite and need no backend or credentials. If the sandbox prevents the default Vite config bundler from reading parent directories, add `--configLoader=runner` to the Vitest/Vite command.

For the original simulation journey, set `AEGIS_REAL_BROWSER=1`, use an explicit `local-demo` backend and set `AEGIS_BACKEND_URL`, then run `npm run test:e2e`. Its Vite server uses 5174; add that exact origin to `AEGIS_ALLOWED_ORIGINS`, or select an already configured origin using `AEGIS_FRONTEND_PORT`/`AEGIS_FRONTEND_URL`.

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
Remove-Item Env:AEGIS_REAL_BROWSER -ErrorAction SilentlyContinue
npm run test:e2e
```

If no supported browser is installed: `npx playwright install chromium`, then remove PLAYWRIGHT_CHANNEL.

Source of truth: [API contract v1.1](../docs/API_CONTRACT.md), including the security-remediation extensions.

- Evaluate uses the contract's exact fields and canonical decision/classification/role values. All successful response payloads cross runtime validation before rendering. Sensitive extra fields (including prompts, output and credentials) reject the response; benign unknown fields are omitted.
- Events currently accept either a direct event array or `{ events: [...] }`, isolated in `src/adapter.ts`. Confirm the intended envelope. No other envelope is silently converted to an empty list.
- Nullable context (`request_id`, user, role, action, resource, classification and destination) is normalized to absent values and renders `Not reported`. Action is optional for backend versions that omit it. ID, timestamp, category, decision, policy, reason and finite nonnegative measured latency remain required. Invalid enums and envelopes still produce contract errors.
- Stats, policy status, session and red-team responses have typed, validated schemas and real summary UI. Consistency checks reject malformed corpus totals and privilege flags.
- Approval body is `{ approve: boolean }`, sent with the bearer credential. The backend requires SECURITY_ADMIN; the resolver contract is tested. An approval UI remains deferred.
- Collections are capped at 100 and have bounded strings. Resolution actor/approval ID are rendered separately from requester. Response bodies are capped at 512 KiB; other JSON has depth/node limits. Audit strings are rendered as text.
- Presets use the registered public resource `public/market_summary` and manager `manager_1`. External and synthetic shell proposals begin with an authorized manager read so they reach `external_exfiltration` and `tool_guard`. Each preset records its expected decision and policy separately from the actual backend response. The frontend only submits proposals to the evaluation endpoint; it has no tool execution path.
- Event detail must return an ID matching the selected event, and evaluation must return `event_id`, policy, reason and measured nonnegative latency.
- Transport failures display `Backend unreachable`; non-2xx responses show the endpoint and HTTP status. Every failed response aborts its transport and initiates cancellation of unread body data before returning the safe error. Cancellation is best effort and never awaited, so a stalled or rejected cancel cannot hold the request open; cleanup rejections are handled, reader locks and abort listeners are released, and the ten-second timer is cleared. Successful responses retain the ten-second deadline and 512 KiB byte limit. Error bodies are never decoded or printed. Invalid schemas display a contract error. Failed refreshes clear rows; selection requests are guarded against stale responses.

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

Tool requests are proposals only; no tool executes. Canonical sanitized output is accepted only from an ALLOW/REDACT evaluation response, then omitted from the dashboard view model. It is never admitted into audit events.

Refresh events to inspect mixed normal, unknown-actor, and malformed-request records. Nullable audit context consistently renders **Not reported**. Missing action is supported for older servers; valid read/export is preserved. Required event structure, canonical decisions/roles, finite nonnegative latency, and detail ID matching remain strict. Unexpected payload fields are removed.

Summary panels show backend decision counts, retained-sample latency, aggregate budget usage, per-user limits, policy version/load/hot-reload status, and latest real corpus cases. Zero latency samples display unavailable. Budget units are labeled conservative_character_units. An unloaded policy remains unavailable even with a prior version. Not-run, failed, completed-with-case-failures, loading, errors and empty results are distinct. Failed refreshes clear previous successful snapshots. Use Refresh summaries to recheck status; audit/evaluation refreshes also reload summaries.

All non-2xx responses, including evaluation 422/413, produce a sanitized endpoint/status error. Error bodies are not read, rendered or logged; no result or navigation ID is invented from an error response.

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
