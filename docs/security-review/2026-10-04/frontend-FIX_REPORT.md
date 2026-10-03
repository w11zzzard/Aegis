# Frontend HTTP response cleanup — 4 October 2026

Finding 3 is implemented and verified locally. Non-2xx responses now abort the transport and initiate cancellation of the unread body before their sanitized HTTP error reaches the caller. The same request-finally path cleans up advertised/streamed oversize failures, interrupted reads, timeouts and invalid JSON/UTF-8. Fully consumed schema failures leave no unread body. Success retains the ten-second deadline and 524,288-byte cap, including a false smaller Content-Length.

Cancellation is initiated once and never awaited. Synchronous cancellation exceptions and rejected promises are handled without replacing the safe request error; a stalled cancellation cannot delay settlement. Reader locks and timers are released. A separately demonstrated stale abort-listener issue is also fixed: removal happens when the abort race settles even if both read and cancellation remain pending.

## Before/after evidence

Tests were written before changing `src/api.ts`. The initial unit suite failed 10 of 14 tests: no transport abort on HTTP/oversize errors and no abort-listener removal when a synthetic read never settled. The other four tests preserve parsing and byte-budget behavior. Two additional post-fix checks exercise real reader-lock release when timeout cancellation rejects or stalls. The final unit suite passes 16/16. See [frontend-unit-red.log](frontend-unit-red.log) and [frontend-unit-green.log](frontend-unit-green.log).

The actual loopback HTTP fixture uses Node fetch against a fresh server per case, watches the peer's socket-close event, has a 1.5-second server watchdog and a 750 ms client observation limit, and destroys sockets/timers during teardown. All six acceptance cases failed before the fix. Finite/endless/stalled and false-large Content-Length peers remained active; the oversized peer sent 3,145,728 bytes while the client had already thrown its 503 error. The false-small response caused Node's protocol handling to close the connection but the application still failed to abort explicitly. See [frontend-http-red.log](frontend-http-red.log).

After the fix all six HTTP cases pass: explicit transport abort, socket disconnection, no complete body, at most 65,536 bytes sent and each case completed within 34 ms in the recorded run. Modes cover finite, oversized, endless, stalled, missing Content-Length, falsely small Content-Length and falsely large Content-Length. See [frontend-http-green.log](frontend-http-green.log). Tests use synthetic bodies and no credentials.

| Acceptance | Active tests/evidence | Final result |
| --- | --- | --- |
| Unread HTTP error abort/cancel, safe status errors | `src/api-streams.test.ts`; unit red/green logs | 16/16 pass |
| Cancel rejects, stalls or throws; no unhandled rejection | Same suite; Vitest reports no unhandled errors | Pass |
| Never-settling read/cancel releases listener, lock and timer | Same suite with ten-second fake deadline | Pass |
| Success bytes, split UTF-8, malformed JSON/UTF-8/schema, advertised/streamed oversize | New suite and existing `src/security-fixes.test.tsx` | Pass |
| Actual HTTP peer observes disconnect | `integration/http-streams.test.ts`; HTTP red/green logs | 6/6 pass |
| All active unit suites and configured coverage gates | [frontend-active-coverage.log](frontend-active-coverage.log) | 63/63; gates pass |
| TypeScript/build | `frontend-typecheck.log`, [frontend-build.log](frontend-build.log) | Exit 0/0 |
| Default browser detail/evaluation/offline/narrow-screen journeys | [frontend-browser.log](frontend-browser.log) | 2/2 pass |
| Authenticated browser and actual backend adapter | [frontend-authenticated-browser.log](frontend-authenticated-browser.log), [frontend-integration.log](frontend-integration.log), [browser-verification.json](browser-verification.json) | Browser pass; integration 7/7 |

Coverage reports 97.59% statements, 93.87% branches, 98.30% functions and 99.27% lines across the files reported by the repository's existing coverage configuration. Typecheck output is empty on success. Build emits the existing nonfatal Zod/Rollup annotation warnings. Browser checks use installed Chrome 154.0.8037.97 and the bundled Node 24.19.0 runtime.

The authenticated verifier starts fresh loopback services and synthetic credentials, tests hostile-origin denial, admin redteam 16/16 and repeated-run 429, a manager's ALLOW/own event detail/action, disconnect 401 and empty browser storage. Its current evidence directory defaults to this date and supports `AEGIS_EVIDENCE_DIR`, preserving historical logs. Its integration command includes the new six real HTTP cases. A first browser attempt encountered the concurrently repaired backend `evidence_class` persisted-schema mismatch; the final rerun passes.

## Exact commands

Commands below use PowerShell and run from `frontend/` unless stated otherwise. The first config-bundler attempt hit sandbox parent-directory access denial; the recorded red/green commands use Vite's supported runner config loader, with no permission escalation.

Unit red (before fix) and green (after fix), respectively:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run src/api-streams.test.ts --reporter=verbose --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-unit-red.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run src/api-streams.test.ts --reporter=verbose --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-unit-green.log'; exit $LASTEXITCODE
```

Actual HTTP red/green:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run --config vitest.streams.config.ts --configLoader=runner --reporter=verbose 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-http-red.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run --config vitest.streams.config.ts --configLoader=runner --reporter=verbose 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-http-green.log'; exit $LASTEXITCODE
```

Active suites, typecheck and build:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run --coverage --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-active-coverage.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\typescript\bin\tsc' --noEmit 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-typecheck.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vite\bin\vite.js' build --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-build.log'; exit $LASTEXITCODE
```

Default browser check (preview was terminated afterward):

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vite\bin\vite.js' preview --configLoader=runner --host 127.0.0.1 --port 19324 --strictPort
$env:AEGIS_FRONTEND_URL='http://127.0.0.1:19324'; $env:PLAYWRIGHT_CHANNEL='chrome'; & 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\@playwright\test\cli.js' test 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-browser.log'; exit $LASTEXITCODE
```

Authenticated browser/integration, run from repository root:

```powershell
$env:AEGIS_TEST_PYTHON=(Resolve-Path '.worktrees\b-dashboard-integration\frontend\.integration-venv\Scripts\python.exe').Path; $env:PLAYWRIGHT_CHANNEL='chrome'; & 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'frontend\scripts\verify-security.mjs' 2>&1 | Tee-Object -FilePath 'docs\security-review\2026-10-04\frontend-authenticated-browser.log'; exit $LASTEXITCODE
```

No existing user changes were reset. No dependencies changed, credentials provisioned for the user, or push/deployment/publication performed. The actual streaming peer verifies Node fetch transport disconnection; synthetic stream lifecycle tests verify cleanup edge cases and Chrome journeys verify current application behavior. Deployed ingress, TLS and alternate browser engine behavior remain outside this local verification.
