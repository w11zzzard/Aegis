# Dashboard TDD evidence

Journeys derive from the user's AEGIS mission and `docs/API_CONTRACT.md` (no external plan file).

| Journey | Test target | Guarantee |
| --- | --- | --- |
| Inspect backend audit evidence | `src/App.test.tsx`, `e2e/dashboard.spec.ts` | Events are fetched; selecting a row fetches that event's details. Missing fields remain absent and display `Not reported`. |
| Know when the backend cannot supply evidence | `src/api.test.ts`, `src/App.test.tsx`, `e2e/dashboard.spec.ts` | Network, timeout, HTTP and schema errors are visible; no fallback events, results or metrics appear. |
| Compare real decisions for five proposals | `src/App.test.tsx`, `e2e/dashboard.spec.ts` | Only `/api/security/evaluate` receives proposals; actual decisions override expected demo outcomes. No tool is executed. |
| Trust the current selection | `src/App.test.tsx` | Late detail responses cannot replace a newer event; failed refreshes clear stale rows. |
| Integrate the contract through one adapter | `src/api.test.ts` | Canonical values, all eight routes, encoded IDs, payloads and sanitized fields are verified. |
| Verify the first backend slice live | `scripts/live-check.mjs` | Analyst BLOCK is auditable and listed, manager ALLOW and external BLOCK come from the actual engine. |

## Verified RED/GREEN sequence

All checkpoints are local commits on `dev-b/dashboard`, reachable from current HEAD. Preserve this report if squashing.

| Checkpoint | Actual validation | Result |
| --- | --- | --- |
| `56211e1` initial RED | `npm test` | 2 failed suites: imports `./api` and `./App` unresolved. This is compile-time RED for missing implementations; no assertions executed yet. Dependencies/config had loaded successfully. |
| `0e83f5e` API GREEN | `npm test -- src/api.test.ts` | 15 tests passed. All eight routes, sanitized adapter, canonical values, encoded IDs, error paths and timeout covered. |
| `5af2b81` audit-navigation RED | `npm test -- src/App.test.tsx` | Missing `./App` still fails compilation, now including evaluation-to-audit navigation journey. |
| `90c6d99` dashboard GREEN | `npm test`; `npm run build` | 25 tests passed; TypeScript and Vite production build passed. |
| `9daeae0` proxy-message RED | `npm test -- src/api.test.ts` | 1 failed, 15 passed: expected API-server/proxy recovery guidance for HTTP 500 was absent. Runtime RED. |
| `152155e` proxy-message GREEN | `npm test -- src/api.test.ts` | 16 tests passed after adding recovery guidance. |

## Final validation

- `npm run test:coverage`: 26 tests passed. Statements **100%**, lines **100%**, branches **98.92%**, functions **96.96%**. Thresholds are enforced at 80% for each metric. Coverage includes API, adapter, App, components and scenario inputs; excludes bootstrap, type-only declarations and styling.
- `npm run build`: passed TypeScript checking and Vite production bundling.
- `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:e2e`: **2 passed**. Browser event/detail/evaluate journey plus 390px offline/no-horizontal-overflow journey. Default Chromium was not installed; installed Chrome was used headlessly. The browser tests deliberately intercept test requests; they do not prove live backend integration.
- `npm run test:live`: **failed**, `LIVE NOT VERIFIED: fetch failed` at the default `http://127.0.0.1:8000`. Retried outside the sandbox with the same outcome. No real backend decision/event was verified.
- Actual desktop and mobile UI screenshots captured without interception. Backend-unavailable state shows `/api/events` HTTP 500 from the Vite proxy, with recovery guidance; no fixture rows or metrics appear.

The initial dependency install hit a registry timeout and the sandbox blocked Vite parent-directory resolution. Both setup issues were resolved before accepting RED evidence. jsdom lacks `scrollIntoView`, so test setup stubs that DOM API; browser navigation is verified separately.

Test fixtures are confined to test imports and browser-test routes; they are not application fallback data. Stats/policy/red-team/approval UI remains deferred pending backend field schemas and live first-slice verification. No tests are skipped.
