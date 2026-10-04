# Backend review, scoped handoff

Target: managed checkout `C:\Users\admin\.codex\worktrees\aegis-security-cp1\Hackyeah 2026 goldman`, HEAD `e52eb5059bba618db768c17353256d9eb516938c`, with local hardening edits. Original checkout/branch was preserved. No commit or push by this reviewer.

ECC `security-review` supplied the trusted input/authorization/leakage/availability checklist; `python-testing` supplied meaningful red/green regression structure. Source, current policy and corpus, API contract, backend setup, existing tests and the original workspace delivery plan were read. The delivery plan is absent from the immutable e52 checkout and was read from the preserved original workspace.

## Reproduced finding: ambiguous or nonfinite corpora could falsely complete green

Location: `backend/redteam.py`, `RedteamRunner.run`; exposed through the authenticated administrative `POST /api/redteam/run` diagnostic operation.

Precondition: an operator-controlled corpus is malformed or edited ambiguously. This is an integrity defect in security test evidence, not a remotely exploitable resource-access bypass. Severity: low to medium, because the diagnostic could certify a malformed attack case as passed and conceal a changed expectation. No untrusted HTTP input can change the corpus file.

Immutable e52 reproductions:

- Duplicate `expected: BLOCK` followed by `expected: ALLOW` silently replaces the BLOCK expectation. A manager request reports completed, passed 1, failed 0, unexpected allows 0.
- Duplicate case-list, request and nested tool destination keys likewise use their final values and report completed green.
- `NaN`, `Infinity`, `-Infinity` and overflowing `1e400` inside untyped tool arguments survive schema parsing; a case expected to BLOCK reports passed instead of visibly rejecting the malformed corpus.

Fix: bounded JSON prevalidation rejects duplicate keys at every level and all nonfinite constants/floats before the schema parser or engine evaluates a case. Excessive parser recursion becomes a normal corpus validation error. The existing API failure path returns sanitized 503, records a failed run, and exposes no fabricated results. The committed corpus remains 16/16 with zero unexpected allows. No contract field changed and no policy/corpus was weakened in source.

Regression: `backend/tests/test_redteam_integrity.py`, eight negative inputs plus committed corpus positive control. Four nonfinite regressions failed before their fix; `backend-nonfinite-red.log` preserves the failures. `backend-corpus-reproduction.json` preserves eight immutable baseline parser reproductions and corresponding fixed refusals. `backend-owned-green.log` records 19 passing owned checks, including lifecycle coverage. Independent review found no introduced bypass: a Unicode-escaped duplicate expectation also returns 503/failed/total0/no-store, and alternate nested NaN/Infinity/-Infinity/1e999 corpora return failed rather than green. Evidence: `reviewer-final-probes.json`, `reviewer-corpus-nonfinite-after.json`.

## Coverage gaps closed without application changes

`backend/tests/test_cp1_lifecycle.py` adds ten meaningful checks: lowering request/character budgets preserves two reservations/16 units across reload and restart; four attempted approval-context mutations remain schema denials without changing the pending proposal; four structurally valid banned/nested tool proposals reach `tool_guard`, suppress output, omit raw arguments from evidence, and trigger neither process nor network sentinels.

The primary agent owns the separately reproduced high-severity encoded configured-credential leak and its `guards.py` fix. This reviewer did not edit that boundary. The fresh HTTP harness independently verified its encoded suffix/prose redaction and benign encoding positive control.

## Actual HTTP verification

Final `backend-live-020850_626488-results.json`: 54 recorded successful checks, 4 October 2026 02:08:50–02:09:05 Europe/Warsaw, five fresh/restarted hidden one-worker loopback services, synthetic credentials, disposable policies and SQLite state. No responses were intercepted. Command lines, ports, PIDs, timestamps, termination exit codes, source file hashes and limitations are recorded. All owned processes stopped; disposable state was removed. It verifies the final full-16,000-character decoder boundary with an exact 16,000-character encoded credential REDACT and a large benign encoding ALLOW. The preceding 52-case pass `backend-live-020258_855184-results.json` is preserved as earlier evidence.

This includes identity/access/destination/tool checks; owned downstream zero calls; output, audit, SQLite and server-log secret exclusion; alternate chat route; approval mutation/replay/policy change/re-evaluation/expiry; committed corpus 16/16 then weakened disposable policy 15/16 with one visible unexpected allow; fresh ALLOW, ALLOW, THROTTLE; lowered usage surviving restart; 20 concurrent requests yielding 3 ALLOW and 17 THROTTLE; valid/invalid/missing/unknown/repaired policy behavior.

The first live attempt completed its application cases but failed cleanup because a SQLite connection was not explicitly closed on Windows. Its failed `backend-live-results.json` and `backend-live-console.log` were preserved. The harness now closes those handles; the second independent run exited 0. This was a test harness issue, not an application finding.

## Limits and readiness

No new backend authorization bypass was reproduced in this review. The demo is an evaluator of synthetic proposals and canned output. There is no live model or actual business tool/data forwarding. Selectable identities in local-demo are not authentication. Pattern masking is not an arbitrary-secret classifier. Audit capacity and approval capacity remain finite; enterprise identity, TLS, immutable retention/recovery and actual downstream sink authorization remain production gates.

Policy readiness inspection uses documented loopback local-demo because invalid policy also disables credential admission in authenticated mode. Approval expiry was tested by aging a stopped, owned disposable SQLite timestamp and then restarting the real service; replay and policy binding use ordinary HTTP calls. The primary's final backend acceptance passed 427 tests with 95.91% coverage (`backend-acceptance-command.json`, `backend-acceptance.log`, `backend-coverage-acceptance.json`). Independent final focused verification passed 37 checks (`reviewer-focused-final-tests.json`). Full source identity and integration verification belong to the primary report. Human A/B sign-off remains pending.
