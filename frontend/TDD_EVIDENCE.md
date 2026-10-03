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

Validation results and checkpoint hashes will be recorded after the RED/GREEN cycle. Test fixtures are confined to test imports and browser-test routes; they are not application fallback data.
