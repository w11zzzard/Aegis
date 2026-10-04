# AEGIS security hardening — 4 October 2026

All four requested findings have implemented fixes and passing active regressions. Independent review also demonstrated and repaired corrupt-state sanitation, a SQLite/mutex lock inversion, configured opaque credential leakage, and nonfinite JSON acceptance. The offline evaluate-only model, trusted identity/role binding, ownership restrictions, production gate and in-memory frontend credentials remain intact. Existing working-tree changes were preserved; no push, deployment, publication or real credential changes occurred.

## Findings and acceptance evidence

| Finding | Implemented behavior | Active regression and evidence | Result |
| --- | --- | --- | --- |
| P1: rejection floods erase legitimate audit evidence | Separate 2,000-event protected buffer and 256-sample rejection pool; 16 samples per ten seconds; fixed sanitized counters; shared global/principal admission; at most 1,002 keys. Server context chooses retention, including protected BLOCK/THROTTLE/approval evidence. Legacy evidence is preserved. | [Retention tests](../../../backend/tests/test_admission_retention.py), [original red evidence](retention-red.log), [focused green](retention-green.log), [real two-worker load](retention-load.json), [four-process quotas/approvals](review-processes.json), [race regression](../../../backend/tests/test_review_concurrency.py) | RESOLVED locally |
| P2: accepted vendor JSON bypasses validation | The installed FastAPI MIME parser applies duplicate-key, complexity and byte/deadline checks to every accepted application JSON subtype. Missing/empty Content-Type follows installed strict parsing. Nonfinite numbers are refused before business handling. | [JSON tests](../../../backend/tests/test_json_boundary.py), [red/green commands and explanation](backend-json-verification.md), [additional nonfinite red](json-nonfinite-red.log), [green](json-nonfinite-green.log) | RESOLVED locally |
| P2: frontend HTTP errors leave streams running | Every failed request aborts transport, starts unread-body cancellation without awaiting it, handles cleanup rejection and releases reader/listener/timer resources. Success retains ten seconds / 512 KiB. | [Unit tests](../../../frontend/src/api-streams.test.ts), [actual HTTP fixture](../../../frontend/integration/http-streams.test.ts), [red/green evidence](frontend-FIX_REPORT.md), [independent native-stream tests](../../../frontend/src/api-streams-independent.test.ts), [independent review](frontend-independent-review.md) | RESOLVED locally |
| P2: middleware SQLite failures bypass safe errors | Outer sqlite3.Error boundary covers admission, rejection/body auditing and downstream state before headers. It emits the existing sanitized 503 through security headers without another audit write; started responses cannot emit a second response. | [Storage tests](../../../backend/tests/test_storage_boundary.py), [55-case green](backend-json-storage-green.log), [missing-guard reconstruction and exact commands](backend-json-verification.md), [corrupt-state tests](../../../backend/tests/test_state_validation.py) | RESOLVED locally |

The storage red harness is explicitly reconstructed by removing only the new outer guard: parallel implementation had landed before those tests existed. It is not presented as an original-checkout baseline. The audit, JSON and frontend red logs were captured before their corresponding fixes. Reviewer findings retain their own before/after evidence; the lock-order repair preceded its independent acceptance test.

## Final verification

| Check | Actual result | Evidence |
| --- | --- | --- |
| Complete active backend suite with configured coverage gate | 400 passed; 96.04% statements; gate passes | [backend-active-final.log](backend-active-final.log) |
| Complete active frontend suite with configured coverage gates | 65 passed; 97.59% statements, 93.87% branches, 99.27% lines | [frontend-active-final.log](frontend-active-final.log) |
| TypeScript and Vite production build | Both exit 0; existing nonfatal Zod annotation warnings | [typecheck](frontend-typecheck-final.log), [build](frontend-build-final.log) |
| Default Chrome journeys | 2 passed, including detail/evaluation and offline narrow screen | [frontend-browser.log](frontend-browser.log) |
| Fresh authenticated Chrome verification | PASS: manager ALLOW/own detail/action, disconnect 401, empty local/session storage, hostile-origin run remains not_run, admin corpus 16/16 and repeat 429 | [frontend-authenticated-final.log](frontend-authenticated-final.log), [browser-verification.json](browser-verification.json) |
| Actual backend adapter and actual HTTP error-stream fixture | 7 passed: one adapter check plus six streaming peer-disconnection cases | [frontend-integration.log](frontend-integration.log) |
| Bounded real HTTP rejection flood | 2,050 requests, two workers; protected owner/admin retrieval and cross-user 404; restart retrieval passes; telemetry and key/disk measurements bounded | [retention-load.json](retention-load.json), [reproduction](reproduce_retention.py) |
| Four-process quota/approval challenge | 120/200 principal admissions; one approval resolution / fifteen replays refused; restart retains both limits and evidence | [review-processes.json](review-processes.json) |
| Independent state/credential/race regressions | 47 passed; independent JSON nonfinite checks also pass | [INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md), [review-focused-tests.log](review-focused-tests.log) |
| Exact installed/locked dependency advisory checks | Current official npm/PyPI scans report zero known advisories; all 26 installed Python lock entries match | [audit commands/results/primary advisories](review-dependency-audit.json), [installed inventory](review-python-inventory.json) |
| Offline demonstration | Canonical ALLOW/BLOCK scenarios; corpus 16/16, zero unexpected ALLOW | [backend-demo.log](backend-demo.log) |

Coverage applies to each repository's configured files and measures exercised code, not security certification. Historical characterization tests under frontend/audit were preserved and do not define current acceptance. No dependency changes were needed for current advisories. Python artifact hashes remain a deployment limitation.

## Commands and environment

Backend commands ran from the repository root with the existing read-only application interpreter, Python 3.12.14, and exact locked FastAPI 0.142.2 / Starlette 1.7.0 / Pydantic 2.13.5 / pytest 9.1.1. The backend/.venv path does not exist in this workspace. Frontend commands used the discovered bundled Node runtime and installed project packages. Vite's runner config loader avoided sandbox parent-directory bundler denial. The final production build runs the same TypeScript/Vite operations as the package script with that supported loader.

```powershell
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests -q --cov=backend --cov-config=backend/.coveragerc --cov-report=term-missing
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m backend.demo
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' docs/security-review/2026-10-04/reproduce_retention.py
```

From frontend/:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run --coverage --configLoader=runner
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vite/bin/vite.js build --configLoader=runner
```

From the repository root:

```powershell
$env:AEGIS_TEST_PYTHON=(Resolve-Path '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe').Path
$env:PLAYWRIGHT_CHANNEL='chrome'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' frontend/scripts/verify-security.mjs
```

The exact focused red/green commands, default-browser server command, HTTP fixture commands and independent reviewer commands are in the linked subsystem reports. Full commands redirected output to the named dated logs and captured/returned LASTEXITCODE. Earlier intermediate failures are retained honestly; final acceptance refers to final passing logs.

## Operational changes and remaining limits

[API contract](../../API_CONTRACT.md) and [backend runbook](../../../backend/README.md) now document quotas, server-assigned retention, sample aggregation/drops, restart/migration behavior, persistence and outage errors. [Frontend runbook](../../../frontend/README.md) documents cleanup and actual HTTP verification.

- Every HTTP request is admitted before policy/body work. Untrusted traffic has 120 requests per ten seconds; verified configured credentials have a separate 1,200 global / 120 per-principal allowance. Valid credentials still need current policy membership and endpoint role checks. Fixed constants require identical worker code/configuration. Source IP/forwarding headers do not select quota keys.
- Rejection/abuse counters saturate at signed 63-bit maximum. Samples cap at 256 and 16 per ten seconds. The event collection merges protected evidence and retained samples; unretained telemetry IDs can return 404. Protected writes and security state commit before success. Corrupt state is preserved and refused, never silently reset.
- SQLite is supported only across workers sharing one absolute local-filesystem path. Full synchronous immediate transactions have a five-second lock wait. Separate telemetry transactions avoid protected-buffer rewriting. Database page allocation can retain its previous high-water mark. Restart preserves wall-clock limits; clock rollback is conservative. Memory-only demo is bounded, single-worker and resets on restart. Live quota keys expire and cannot accumulate beyond 1,000 reservations from identity churn.
- Authenticated misuse can fill the finite protected buffer or consume authorized capacity. Untrusted abuse cannot evict it. The buffer is not immutable archival evidence; secure export/backup/recovery and filesystem ACLs remain production requirements. Cross-origin preflight has no credential and can exhaust its untrusted allowance; the recommended same-origin dashboard proxy avoids this dependency. Admission bounds accepted work, not all connections/bandwidth or contention.
- Configured opaque token masking retains only digest/length pairs, scans at most 32,768 substrings per value and masks whole values on exhaustion. The existing single bounded base64 layer recognizes exact configured tokens. Unrelated formats, nested/alternative encodings and complete DLP remain outside this offline masker.
- Production stays gated. TLS ingress, enterprise identity/revocation/MFA, least-privilege runtime/ACLs, hosted repository controls, protected evidence recovery and authorization at real data/tool sinks are unverified deployment requirements. No real model/tool execution, upload, payment, RAG or confidential data integration was introduced. Cookie-session controls and ECC AgentShield are inapplicable to this bearer/evaluate-only project; no Claude configuration was added for a scanner.

All required local implementation and verification checks completed. The first load harness run hit a Windows temporary SQLite handle cleanup issue; the harness now explicitly closes its connection and subsequent runs clean their own ephemeral databases. Cleanup of that first leftover synthetic-test directory was later blocked by automatic approval review because its usage limit prevented review completion, not because the action was judged unsafe. That optional cleanup did not execute. No remaining finding in the reviewed four-fix boundary is marked open; the deployment limitations above remain explicit.
