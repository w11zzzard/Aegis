# CP1 security review and bounded demo scope

Reviewed baseline: `141490f4df1cf4ee296b808626501f0dc9f2743b` on
`codex/a-contract-audit`. The follow-up adds security proof and serial live-test
configuration; production backend/frontend behavior, policies and corpus are unchanged.
The exact tested follow-up HEAD and commands are recorded in workspace
`output/security-review/verification.json`. Historical `output/final-integration/`
evidence still applies only to its recorded baseline commit.

## Boundary and assessment

This sign-off is limited to a single loopback worker, synthetic data, selectable
registered demo identities and proposed actions. No critical/high exploitable
authorization or output-leak finding was reproduced within that scope. This is
an engineering review result, not production certification or both humans' sign-off.
CP1's A+B review checkbox remains open until the team reviews the evidence.

The path inspected is: bounded body -> strict Pydantic request -> registered
identity/role -> trusted resource classification -> external destination ->
business role/action -> exact tool proposal -> locked quota -> approval/output
screen -> allowlisted audit metadata -> Zod adapter -> React text rendering.
Neither a detector nor the UI can authorize a request. Proposals never execute.

## Required proof and its source

| Area | Evidence |
| --- | --- |
| Role spoof, unknown actor/resource, missing context, downgrade and demo-admin business denial | Real HTTP `test_live_adversarial_context_tools_and_secret_evidence`; each BLOCK asserts policy, no output and matching audit detail. Manager/public positive controls ALLOW. |
| External exfiltration despite indirect malicious source | Same live test: authorized manager plus EXTERNAL and downgraded classification still reaches external_exfiltration. |
| Banned tool and resource/destination argument mismatch | Same live test reaches tool_guard on valid read payloads. Existing test_guards mocks execution entry points; reviewed guards contain no execution/network/filesystem call. |
| Malformed, unexpected, deeply nested, nonfinite and oversized input | Same live test asserts 422/413 canonical BLOCK and null sanitized context; secret strings are absent from failure responses. |
| Output and audit/export secrecy | Same live test asserts REDACT output, suppression on BLOCK/THROTTLE/REQUIRE_APPROVAL, and equality of every detail to the JSON event collection used for export. Prompt/source/output/tool arguments are absent. Existing tests cover nine secret patterns. |
| Browser text safety | security-rendering.test.tsx exercises hostile HTML/script in permitted output through the typed API client and React. It remains text; no img/script DOM node or execution. This is a fixture rendering regression, not live model output. |
| Concurrent quota and lower limits | test_live_concurrent_quota_and_lower_limit_preserve_usage: 20 actual HTTP requests yield 3 ALLOW, 17 THROTTLE; lowering cap to 2 retains usage 3 and denies next request. Existing tests cover character-unit boundary and exact expiry. |
| Valid/invalid/unknown/missing policy controls and recovery | test_live_reload_approvals_and_honest_attack_failures asserts changed roles, strict rejection of unknown root control/missing budgets, prior version with loaded:false, fail_closed and recovery. Existing tests cover duplicate YAML keys, aliases, missing/oversized files. |
| Approvals cannot escalate or execute | Real HTTP checks reject non-admin, unknown identity, replay and changed policy; approved resolution has executed:false and subsequent export remains REQUIRE_APPROVAL. Existing test_approval_expiry_policy_change_and_unknown patches only the clock to test five-minute expiry without waiting. |
| Honest attack/reporting failures | Real HTTP and security.spec.ts run actual corpus with default policy 16/16 and weakened temporary role policy 15/16, failed=1, unexpected_allows=1. Browser displays expected BLOCK/actual ALLOW, failure message, invalid readiness and recovery back to 16/16. |
| CORS and service exposure | Untrusted browser origin receives no allow-origin header. API GET/audit/admin are not authenticated; CORS is not authentication. Commands bind 127.0.0.1, one worker, no access logs. |
| Credentials and dependencies | Pattern scan of tracked candidate files and locally available relevant source history identifies only reviewed synthetic test/scenario patterns; no values printed. Current npm audit and OSV batch query of 26 locked Python packages report no known advisories at query time. pip check is consistency only. |

The UI has fixed canonical proposals and no complete approval administration or
dedicated export button. Its audit collection can be exported as sanitized JSON
through GET /api/events; a JSON collection check does not prove a UI export control.
Red-team runs use a fresh enforcement engine and do not consume the demo user's
quota. They are positive/negative control evidence, not complete attack coverage.

## Confirmed finding

**CP1-001 / P1 / resolved — shared-state browser tests raced.**
Location: `frontend/playwright.config.ts:6`, with the new policy-mutation test in
`frontend/e2e-live/security.spec.ts:5`. Trigger: both live files run in parallel
against one backend while one deliberately authorizes ANALYST in a disposable
policy. Expected: canonical analyst request BLOCKs under the default policy.
Actual: baseline file saw the intentional weakened-policy ALLOW; 1/3 tests failed.
Impact: unreliable verification; this was test interference, not a policy bypass.
Smallest fix: one live worker; fixture test parallelism stays unchanged.
Owner: Dev B/integration. Acceptance: all three real browser tests pass serially,
including the weakened-policy failure, and the original policy is restored in finally.

Initial new HTTP tests also had a helper keyword-override mistake; it was corrected
before the real cases passed. Neither failure is presented as a product vulnerability.

## Limitations and unverified concerns

- Choosing another registered identity, including manager/admin, is allowed demo
  behavior. There are no authenticated principals. Sharing a port/data beyond the
  agreed local synthetic scope requires a new review and genuine authentication.
- Secret screening is pattern based. Encoded, split or unrecognized secrets and
  arbitrary confidential prose are not comprehensively detected. There is no live
  data retrieval or provenance classifier; caller-proposed output is synthetic.
- Body/text/corpus/policy sizes, event/approval counts and allowed-user quota are
  bounded. This is not transport/IP rate limiting, read-timeout hardening, full
  denial-of-service protection or authenticated quotas. Invalid requests/corpus
  runs do not use the per-user budget. No production availability claim is made.
- In-memory usage/audit resets on restart; events retain the newest 2,000 entries.
  Approvals are evidence only. No durable audit, real model, semantic detector or
  real tool is present. Model names in proposals do not select an executing model.
- Dependency databases and source patterns have incomplete coverage. A clean
  result is a dated known-advisory/credential scan, not absence of vulnerabilities.
- No committed CI or submission package was found. CP5 release verification,
  human sign-off, feature freeze and submission receipt remain separate gates.

## CP2/CP3 use-case decision and requirements map

The human reported the organizers' answer: "they say its depends on the usecase
and on our decision". For this access/exfiltration simulator we choose deterministic
controls and keep semantic/model claims absent. This is a user-reported clarification
and team scope decision, not a recorded formal waiver of every published requirement.
Do not interpret it as a coding-start exception or acceptance of the wrapper/catalog.

| Requirement | Current evidence / remaining action |
| --- | --- |
| Central access, classification, destinations and budgets | Implemented YAML catalog, hot reload and positive/negative/concurrent tests. |
| Block versus Redact/strictness configuration | Current decisions are fixed by deterministic guards; configurable thresholds/strictness absent. Dev A/lead must implement or obtain explicit applicability acceptance. |
| Allowed model identifiers | No live model exists; chat always returns aegis-offline-demo. Proposed model field is not centrally allowlisted. Catalog requirement remains open; do not claim it complete. |
| Hybrid semantic control | Absent by explicit use-case decision above; document this honestly in slides. Published details still contain stronger wording. Lead retains organizer acceptance evidence. |
| Developer integration / wrapper | Real evaluate HTTP API and minimal offline chat shown; no forwarding to an actual agent/model. Lead must confirm this demonstration is sufficient or authorize one bounded real integration. |
| Historical exploits | Shell/HTTP tool proposals, role spoofing, external injection, unsafe arguments, secret output and malformed input exercised. No unsafe deserialization or arbitrary code execution path exists; no model-download/supply-chain exploit detector is claimed. |
| Reporting/testing/performance | Actual audit/readiness/budgets/corpus, measured per-decision latency, locked suites. No throughput/model-token/financial cost invented. |
| Submission | English satisfies known language variants. PDF <=10 slides, team fields, exact release and receipt still needed. |

Published cached rules/details disagree on semantic wording and testing/scalability
weights (20/10 versus 15/15). Coding start no earlier than 3 October 23:00 has no
recorded exception. The current task page returned only "Loading tasks" in the
read-only lookup, so that lookup does not establish updated rules. Cached PDFs
and text remain under workspace output/review/. Eligibility is not certified.

## Reproduce the new proof

Backend from root: the existing full pytest/coverage command includes
`backend/tests/test_security_live.py`; it owns and terminates disposable child servers.
Frontend: npm test includes security-rendering.test.tsx.

For browser security.spec.ts, copy policies/default.yaml to the ignored
backend/.venv/cp1-browser-policy.yaml and start a dedicated backend with
AEGIS_POLICY_PATH pointing there. Point AEGIS_BACKEND_URL at that backend;
set PLAYWRIGHT_CHANNEL=chrome, AEGIS_REAL_BROWSER=1,
AEGIS_SECURITY_POLICY_PATH to that exact absolute temporary path, and an unused
AEGIS_FRONTEND_PORT before npm run test:e2e. The filename/path check prevents
changing the committed policy. Without that variable, the mutation case is skipped
explicitly. For the quota browser case also provide a separate fresh two-request
backend/frontend through AEGIS_QUOTA_FRONTEND_URL as documented previously.

Screenshots/logs/dated advisory and secret scans are saved under workspace
output/security-review/. Stop only these test-owned processes. Preserve earlier
output/review and output/final-integration records. CP6 was reported complete by
the supplied handoff; no associated user rehearsal evidence was supplied, and we
do not claim independent cold-start/offline/two-rehearsal certification.
