# Frontend/API security evidence — 4 October 2026

Working tree: `C:/Users/admin/.codex/worktrees/aegis-security-cp1/Hackyeah 2026 goldman`, HEAD `e52eb5059bba618db768c17353256d9eb516938c`. The original checkout and existing contributor work were preserved. No commit, push, merge or deployment was performed by this lane. Exact hashes, commands, Warsaw timestamps and exit codes are in `frontend-VERIFICATION.json`. Both final real-browser modes used identical application/harness hashes, including final `backend/guards.py` SHA-256 `3d5691377b6c021a380160391df56ab1e64b19fffb09e4e902d1e7cfc8496fa8`.

The selected ECC skills contributed behavior-focused React tests, separate fixture and real E2E lanes, checks for secrets/XSS/errors, scoped browser smoke evidence, and contract coordination before changing the response boundary. The skills were `react-testing`, `e2e-testing`, `security-review`, `browser-qa`, and `contract-first`. Reading them is not counted as verification.

Two focused repairs were completed:

| Finding | Preconditions and impact | Repair and proof |
| --- | --- | --- |
| Sensitive response fields silently accepted | A defective or malicious API response could contain raw `output`, prompts, credentials or tool arguments while still producing an apparently valid dashboard decision. Existing stripping prevented those extra values from being displayed, so this is a required contract/defense-in-depth gap, not a reproduced displayed-secret exploit. | The bounded runtime scanner rejects the agreed fields and aliases, including nested/envelope content. Audit output and refusal `sanitized_output` fail visibly; legitimate ALLOW/REDACT output remains omitted. The primary published the contract first. `frontend-sensitive-fields-before.log` records 15 failing regressions before repair. New tests verify nested content, stale-state clearing, schema limits and permitted positive controls. |
| Strict CSP blocked build-generated font resources | An ordinary built-preview visit emitted five CSP console violations because Vite embedded small fonts as `data:` URLs while `font-src 'self'` was configured. Low severity: configuration consistency/resource failures, without a demonstrated authorization or leakage exploit. | `assetsInlineLimit: 0` emits same-origin files. Strict CSP remains unchanged. The final browser smoke requires zero unexpected console errors across three widths. Before observations are accurately retained in `frontend-before-observations.json`; the original CSP failure was observed in the tool transcript and was not saved as a raw log file. |

Final results:

| Evidence | Result |
| --- | --- |
| Unit tests and coverage | 100 tests, eight files; statements 97.78%, branches 94.26%, functions 98.33%, lines 99.34%; all configured 80% thresholds preserved and passed |
| TypeScript and Vite production build | Passed; only upstream Zod annotation warnings |
| Fixture browser checks | Six passed; inert HTML-like strings, sensitive field refusal, malformed/error stale-state clearing, keyboard activation, memory-only credentials and disconnect, narrow-screen integrity |
| Normal real backend | No browser request/response routing or fulfillment. Authenticated manager evaluation and owned detail; disconnect removes result/detail/credential; hostile-origin admin mutation refused; actual isolated corpus 16/16; permitted secret REDACT and external BLOCK without output/audit leakage; seven typed/live/real-HTTP checks |
| Fresh actual demo browser | Five intended decision/policy cases; exact returned event ID, decision and reason match feed/detail; keyboard evaluates actual APIs |
| Fresh actual quota browser | ALLOW, ALLOW, THROTTLE, each correlated with real audited details |
| Separate guarded runtime | The same journeys and seven integration checks passed while a browser guard aborted an owned `.invalid` negative probe and external requests, and each of four child Python processes denied DNS/connect self-probes before importing Uvicorn. This simulates external-network unavailability after prerequisites; it is not a host-global disconnect or offline-installation claim. Local API responses were continued, never fulfilled or fabricated. |
| Console and network | No unexpected console/page/network failures or external application-page requests. Required 401/403 statuses and their deliberate unread-body transport cancellations are recorded explicitly. |
| Screenshots and cleanup | Credential fields were empty in every saved screenshot. Fixture and actual views cover 375, 768, 1440 pixels. All owned child processes and servers stopped; dedicated preview interruption followed by ECONNREFUSED. Thirteen exact synthetic quota/state files were removed after shutdown; `frontend-scratch-cleanup.json` records them. |

The selected target has no report/export/download/CSV UI and no summary panels. Therefore CSV formula injection and exported-result parity are inapplicable to its current UI; CP4 reporting/export product scope remains incomplete. `export` is a backend proposal action, not a dashboard CSV export. Generic admin API helpers retain bounded JSON validation and are never rendered; they are not certified typed reporting interfaces.

No dynamic links or unsafe HTML sinks were found. Known-field strings render through React as text. XSS, prototype-like extras, credentials/storage, stale responses, malformed decisions/latency, size/depth/node bounds, cancellation and safe errors have targeted regression coverage. Identifiers remain encoded in API paths and matched against returned detail IDs. This frontend does not infer authorization or execute proposed tools.

Visual baseline comparison is INCONCLUSIVE because no baseline exists. No axe run, screen-reader assessment or Core Web Vitals measurement was performed; keyboard/security checks do not establish a full accessibility certification. Production identity/TLS/runtime readiness and whole-repository CP1 sign-off remain outside this lane. Human sign-off remains pending.

During harness expansion, preceding integration requests exhausted the local-demo telemetry sampling allowance and caused a documented unretained correlation ID to return 404. A separate fresh demo process now isolates the browser lane. Observer assertions were also refined to classify deliberate 401/403 transport cancellations by their observed HTTP status, and the owned static test server serves an empty favicon instead of generating an irrelevant browser 404. These were harness repairs; failed-run logs remain alongside final evidence.

Primary evidence: `frontend-VERIFICATION.json`, `frontend-unit-coverage.log`, `frontend-build.log`, `frontend-fixture-browser.log`, `frontend-real-browser-verification.json`, `frontend-real-browser.log`, `frontend-integration.log`, `frontend-offline-browser-verification.json`, `frontend-offline-browser.log`, `frontend-offline-integration.log`, and `frontend-*-security-*.png`.
