# Security-first release verification — 4 October 2026

Repository: `w11zzzard/goldman-sachs`, target GitHub `main`.
Starting revision: `ec7b2d479e132f189677107d6b8d0fa1d3ed7020`.
Requested commit `d14d5b4a1b3c42edd3965d86f927465387ab7eb0` and the remote security-hardening work are already ancestors of this main. The unrelated, dirty primary checkout was preserved; release work used the clean `main-cp1-merge` integration checkout.

## Changes and reproduced issues

- ECC security-review and test-first remediation: unsafe remote plain-HTTP API bases, double credential reads, late responses after credential changes, and unbounded persisted budget-principal cardinality were reproduced before fixes.
- Credentials stay in memory. API bases reject non-local plain HTTP, URL credentials, queries/fragments, backslashes and protocol-relative URLs; redirects and cookies remain disabled. Requests capture one credential, and session changes abort pending requests and refuse late responses.
- Caller-scoped `/api/session` metadata enables role-aware summaries. Regular authenticated users do not query global administrative data; verified administrators can observe/run the corpus. Every protected backend route still authorizes independently. Explicit public demos are labeled synthetic.
- New POSIX credential/state directories and files use private modes. Unsafe existing database files, symlinks and other-account-writable state directories are refused without resetting or altering state. Persisted quota principals are capped at 1,000. Windows NTFS ACLs remain an operator requirement.
- Restored real build-preview API proxy. The live verifier checks the actual built preview, authenticated manager/admin workflows, disconnect privacy, positive/negative decisions, secret redaction, hostile origins, quotas and policy failure/recovery. Test evidence defaults to ignored `output/`, preserving historical reports.
- Python live verification now uses unconditional checks with sanitized failures and refuses non-loopback targets before sending admin credentials. Static scanning no longer fails on verifier assertions that could be optimized away.
- CI additionally runs fixture-browser and offline-runtime checks. Offline proof uses a refusing loopback browser proxy and per-backend Python DNS/connect guard, without API interception. Diagnostic tracing identified spurious successful-response cancellation signals from the previous browser-routing blocker; the new boundary avoids that interference. No successful-response cancellation is exempted from the verifier.

## Verified locally

Python 3.12.14, Node 22.22.0, Chrome 154, Windows; exact backend lockfile installed in a separate disposable environment.

| Check | Result |
| --- | --- |
| Backend regressions + coverage | 456 passed; 96.85% coverage; 4 POSIX-only checks skipped on Windows |
| Frontend regressions + coverage | 159 passed; 98.28% statements, 93.10% branches, 99.58% lines |
| Typecheck and production build | Passed |
| Fixture browser regressions | 6 passed |
| HTTP/adapter integration | 7 passed |
| Serial live browser journeys | 2 passed; default corpus 16/16, deliberately weakened policy 15/16 with one unexpected ALLOW, invalid-policy refusal, restored policy 16/16 |
| Authenticated browser release verifier | Passed; own-event access, admin-only summaries, disconnect clearing, hostile-origin denial, output redaction and quota enforcement |
| Actual Vite build preview | Served build with security headers; protected API proxy passed |
| Offline-runtime release verifier | Passed; external self-probes blocked; owned loopback journeys succeeded without API interception |
| Bandit | No issues identified; existing reviewed narrow exclusion remains |
| npm audit / pip-audit lockfile | No known vulnerabilities at check time |
| pip check / git diff check | Passed |

Run from the repository root: backend pytest with its coverage config, then frontend `npm run test:coverage`, `npm run build`, `npm run test:e2e`, and `node frontend/scripts/verify-security.mjs` with `AEGIS_TEST_PYTHON` pointing to the locked interpreter. Set `AEGIS_OFFLINE_GUARD=1` for the separate offline-runtime check. JSON results, source hashes, screenshots and lifecycle/integration logs are under `output/release-verification/`. All spawned test processes and servers are stopped by the verifier.

## Remaining deployment gates

This verifies a loopback, synthetic-data gateway, not production certification or complete attack coverage. Real model/tool/data integration, TLS ingress, enterprise identity/MFA/revocation, least-privilege Windows ACLs/runtime, protected audit archival/recovery and hosted branch/secret-protection controls still need deployment-specific verification. Production profile remains rejected. The four POSIX-only tests require Linux CI; a local Windows run does not prove Linux execution. Remote GitHub Actions completion is a separate check, not implied by these local results. Pattern scanning is not exhaustive secret discovery and no audit claims that unknown secret formats or arbitrary encodings are covered.
