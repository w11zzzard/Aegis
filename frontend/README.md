# AEGIS dashboard

Frontend owner branch: `dev-b/dashboard`. React, TypeScript and Vite. All application data comes from the backend. There is no runtime mock mode, generated event stream, inferred decision, placeholder metric or latency estimate.

## Run

From `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`. Override the proxy with `AEGIS_BACKEND_URL`. For a separately hosted API, set `VITE_API_BASE_URL` to its origin before building; the backend must allow that frontend origin with CORS. Production hosting must proxy `/api` to the backend when the base URL is empty. Environment values are build-time configuration, never credentials.

```sh
npm test
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:live
```

The live check uses `AEGIS_API_URL` (default `http://127.0.0.1:8000`) and creates real audit events. Unit/browser tests use isolated test transport fixtures; those fixtures are never imported by application modules.

If Chrome or Edge is already installed, set `PLAYWRIGHT_CHANNEL=chrome` or `PLAYWRIGHT_CHANNEL=msedge` to run E2E without downloading Chromium. In PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:e2e`.

## Integration and Developer A handoff

Source of truth: `../docs/API_CONTRACT.md` at `97734e2`. No shared contract or backend files are changed.

- Evaluate uses the contract's exact fields and canonical decision/classification/role values. All response payloads cross runtime validation before rendering. Extra event fields (including prompts and output) are discarded.
- Events currently accept either a direct event array or `{ events: [...] }`, isolated in `src/adapter.ts`. Confirm the intended envelope. No other envelope is silently converted to an empty list.
- Event `action` and `latency_ms` are optional because the documented event listing omits them. Please include them in event detail responses to satisfy the complete detail view. Missing values render `Not reported`; latency is never computed from client round-trip time.
- Stats, policy status and red-team response schemas are unspecified. Their typed client methods return validated JSON values pending agreed field definitions. Dedicated summary UI is deferred until the actual schemas are available.
- Approval body keys are unspecified. `resolveApproval` currently proposes `{ decision: 'approve' | 'deny' }`; confirm with Developer A before exposing an approval interface.
- The low-risk resource `research/public_summary`, external destination value `EXTERNAL`, and dangerous proposal (`tool: 'shell'`, `tool_arguments: { command: 'rm -rf /' }`) are demo request inputs requiring backend confirmation. The frontend only submits proposals to the evaluation endpoint; it has no tool execution path. Portfolio inputs match the shared acceptance case.
- Event detail must return an ID matching the selected event, and evaluation must return `event_id`, policy, reason and measured nonnegative latency.
- Transport failures display `Backend unreachable`; non-2xx responses show the endpoint and HTTP status. Response bodies are not printed as errors. Invalid schemas display a contract error. Failed refreshes clear rows; selection requests are guarded against stale responses.

The first slice is implemented and transport-testable independently of backend availability. A real backend event is verified only when the live acceptance check passes against a running backend. See `TDD_EVIDENCE.md` for actual validation results.
