# AEGIS dashboard

Frontend owner branch: `dev-b/dashboard`. React, TypeScript and Vite. All application data comes from the backend. There is no runtime mock mode, generated event stream, inferred decision, placeholder metric or latency estimate.

## Run

From `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`. Override the proxy with `AEGIS_BACKEND_URL`. For a separately hosted API, set `VITE_API_BASE_URL` to its origin before building; the backend must allow that frontend origin with CORS. Production hosting must proxy `/api` to the backend when the base URL is empty. Environment values are build-time configuration, never credentials.

Configure the backend using [backend/README.md](../backend/README.md). Its default authenticated mode requires private credentials and shared state. Enter your operator-provided credential under **API credential**. It stays in memory, travels in Authorization, and clears on disconnect/reload. Cookies are omitted and API redirects refused. Each preset must match the credential's identity. Use explicit loopback `local-demo` for the multi-identity simulation checks.

```sh
npm test
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:live
```

The original multi-identity live check uses `AEGIS_API_URL` against an explicit `local-demo` backend and creates real synthetic events. `npm run test:integration` checks those events and presets through the adapter. For authenticated verification, build and run `node scripts/verify-security.mjs` with `AEGIS_TEST_PYTHON` set to the backend interpreter; it starts fresh services and tests credential use, event ownership, disconnect and the rejected hostile-origin trigger. Unit/default browser fixtures never enter application modules.

Response cleanup regressions run with `npx vitest run src/api-streams.test.ts`. A bounded real loopback HTTP peer independently observes socket disconnection for finite, oversized, endless and stalled 503 bodies, including missing or misleading Content-Length: `npx vitest run --config vitest.streams.config.ts`. The HTTP tests also run with the existing integration suite and need no backend or credentials. If the sandbox prevents the default Vite config bundler from reading parent directories, add `--configLoader=runner` to the Vitest/Vite command.

For the original simulation journey, set `AEGIS_REAL_BROWSER=1`, use an explicit `local-demo` backend and set `AEGIS_BACKEND_URL`, then run `npm run test:e2e`. Its Vite server uses 5174; add that exact origin to `AEGIS_ALLOWED_ORIGINS`, or select an already configured origin using `AEGIS_FRONTEND_PORT`/`AEGIS_FRONTEND_URL`.

If Chrome or Edge is already installed, set `PLAYWRIGHT_CHANNEL=chrome` or `PLAYWRIGHT_CHANNEL=msedge` to run E2E without downloading Chromium. In PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:e2e`.

## Integration and Developer A handoff

Source of truth: [API contract v1.1](../docs/API_CONTRACT.md), including the security-remediation extensions.

- Evaluate uses the contract's exact fields and canonical decision/classification/role values. All response payloads cross runtime validation before rendering. Extra event fields (including prompts and output) are discarded.
- Events currently accept either a direct event array or `{ events: [...] }`, isolated in `src/adapter.ts`. Confirm the intended envelope. No other envelope is silently converted to an empty list.
- Nullable context (`request_id`, user, role, action, resource, classification and destination) is normalized to absent values and renders `Not reported`. Action is optional for backend versions that omit it. ID, timestamp, category, decision, policy, reason and finite nonnegative measured latency remain required. Invalid enums and envelopes still produce contract errors.
- Stats, policy status and red-team response schemas are unspecified. Their typed client methods return validated JSON values pending agreed field definitions. Dedicated summary UI is deferred until the actual schemas are available.
- Approval body is `{ approve: boolean }`, sent with the bearer credential. The backend requires SECURITY_ADMIN; the resolver contract is tested. An approval UI remains deferred.
- Collections are capped at 100 and have bounded strings. Resolution actor/approval ID are rendered separately from requester. Response bodies are capped at 512 KiB; other JSON has depth/node limits. Audit strings are rendered as text.
- Presets use the registered public resource `public/market_summary` and manager `manager_1`. External and synthetic shell proposals begin with an authorized manager read so they reach `external_exfiltration` and `tool_guard`. Each preset records its expected decision and policy separately from the actual backend response. The frontend only submits proposals to the evaluation endpoint; it has no tool execution path.
- Event detail must return an ID matching the selected event, and evaluation must return `event_id`, policy, reason and measured nonnegative latency.
- Transport failures display `Backend unreachable`; non-2xx responses show the endpoint and HTTP status. Every failed response aborts its transport and initiates cancellation of unread body data before returning the safe error. Cancellation is best effort and never awaited, so a stalled or rejected cancel cannot hold the request open; cleanup rejections are handled, reader locks and abort listeners are released, and the ten-second timer is cleared. Successful responses retain the ten-second deadline and 512 KiB byte limit. Error bodies are never decoded or printed. Invalid schemas display a contract error. Failed refreshes clear rows; selection requests are guarded against stale responses.

The first slice is implemented and transport-testable independently of backend availability. A real backend event is verified only when the live acceptance check passes against a running backend. See `TDD_EVIDENCE.md` for actual validation results.
