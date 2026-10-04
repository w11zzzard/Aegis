# Independent adversarial review — 4 October 2026

The reviewer read the API contract, README/runbooks, prior review/specification, active tests and all backend enforcement plus frontend transport/adapter code. The ECC security-review skill was applied. This review used synthetic credentials, fresh temporary SQLite databases, local process workers and current official advisory endpoints. No operator credentials, hosted settings, deployment or publication were touched. Existing user changes were preserved.

## Additional findings challenged and repaired

| Finding | Before/implication | Implemented repair | Evidence |
| --- | --- | --- | --- |
| Corrupt stored state with valid JSON bypassed sanitized storage refusal | `{}`, `[]` and malformed stored approval metadata each produced HTTP 500 without no-store. An invalid stored structure is a storage-integrity failure, not a fresh empty state. | Strict, bounded persisted event/approval/usage/red-team/control schemas; duplicate/nonfinite JSON rejection; specific decoding/schema failures become sqlite3.DatabaseError. Stored bytes remain unchanged, with no success/output or fallback reset. Unexpected application KeyError still propagates. | [Before](review-outage-before.json), [reproduction](review-reproduce.py), [after](review-outage-after.json); backend/tests/test_state_validation.py: 36 passing regressions. |
| Nested telemetry and admission had opposing mutex/SQLite lock order | A controls transaction could hold the controls mutex while waiting for the gateway's SQLite writer, while that writer attempted nested telemetry and waited for the mutex. This code path could amplify contention into the five-second SQLite failure timeout. | Nested controls use the already-owned SQLite transaction without acquiring the independent controls mutex. The database serializes the local state transition. | backend/tests/test_review_concurrency.py deterministically overlaps the operations and verifies both commit. This finding was identified through code review; the repair landed before its independent acceptance test ran. |
| Configured opaque service credentials leaked through metadata and output | A synthetic manager credential copied into request_id remained visible to SECURITY_ADMIN in event detail and SQLite; output retained it as ALLOW. The observer role does not imply manager resource authority. | Digest/length matching for configured credentials masks output and audit context, including tokens embedded in URLsafe prefixes/suffixes. Exact decoded credentials are recognized in the existing single bounded base64 layer. Only digests and lengths are retained. Comparison work is capped; exhausted search budgets conservatively mask the whole field. | [Before](review-credential-before.json); backend/tests/test_credential_redaction.py: 10 passing regressions covering 32–256-character credentials, plain/once-encoded output, owner/admin detail, SQLite, pending minimization, ordinary correlation IDs/base64 and exactly 32,768 comparisons at the bound. |

## Independent acceptance challenges

The reviewer separately ran the 47 focused state/credential/lock tests, all passing. The root agent owns final complete-suite/build/browser execution records; historical 3 October characterization results are not substituted for current acceptance.

Four distinct Python processes jointly admitted exactly 120 of 200 principal attempts with a deterministic clock. Sixteen concurrent approval resolutions produced exactly one 200 and fifteen 409 responses. Restart preserved the admission limit, refused replay, and retained correlated approval evidence. See [script](review-processes.py) and [actual results](review-processes.json). These engine-level process tests complement the authenticated HTTP/browser acceptance; they do not themselves test bearer verification.

Retention and admission inspection confirmed that credentials are verified from the server's bounded token digest registry before policy/body work. Request claims, decision names, roles, IP addresses, forwarding headers and Origin values cannot choose protected retention. Public local-demo evaluations remain rejection telemetry. Authenticated completed evaluations preserve ALLOW, BLOCK, THROTTLE and approval outcomes in protected capacity. Legacy records remain preserved because their old trust class cannot be reconstructed safely. Fixed-cardinality telemetry reasons, capped counters, 256 samples and separate admission windows prevent untrusted sources from filling protected-event capacity. Protected persistence completes before returning results.

The JSON MIME check follows the installed FastAPI email parser. Case, parameters and accepted application +json subtypes receive the same duplicate/nesting/node safeguards. The installed framework's strict Content-Type behavior rejects absent/empty Content-Type nonempty model bodies rather than decoding them as JSON. The root agent additionally demonstrated and repaired Python JSON acceptance of NaN/Infinity and exponent overflow to nonfinite floats; the reviewer confirmed recursive finite-number rejection in the common JSON boundary before downstream evaluation. The reviewer found no remaining parser mismatch in the inspected boundary.

The frontend aborts unsuccessful transports, starts cancellation of unread bodies without awaiting a potentially stalled cancel, handles cleanup rejection, releases reader locks and clears deadlines. Schema failures occur after bounded body completion and have no unread transport left. No additional cleanup blocker was identified by inspection; actual local HTTP disconnection evidence is owned by the frontend agent.

## Dependency evidence

Current approved read-only official npm registry and PyPI scans report zero known advisory records for the exact lockfile versions. The Python application interpreter's installed metadata matches every backend lock entry. Selected frontend installed package versions also match the lock (Vite 7.3.6, Vitest 4.1.11, React/ReactDOM 19.3.0, esbuild 0.28.2, Rollup 4.64.0, Playwright 1.63.0, Zod 4.6.5). See [audit output and commands](review-dependency-audit.json) and [Python inventory script](review-inventory.py).

Reviewer commands ran from the repository root, using its existing application interpreter without installing or modifying that environment:

```powershell
$env:PYTHONPATH=(Get-Location).Path
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests/test_credential_redaction.py backend/tests/test_state_validation.py backend/tests/test_review_concurrency.py -q
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' docs/security-review/2026-10-04/review-processes.py
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' docs/security-review/2026-10-04/review-reproduce.py
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' docs/security-review/2026-10-04/review-inventory.py
```

Current focused-test output: 47 passed, one existing Starlette/httpx TestClient deprecation warning, 1.63 seconds. Python inventory matches all 26 locked entries. Exact advisory commands and results are recorded in review-dependency-audit.json; initial restricted-network attempts failed and the approved read-only retries succeeded.

The [Vitest maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) identifies 4.1.11 as patched. The [Vite Windows path advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) identifies 7.3.5 as patched in the version 7 branch; installed 7.3.6 is later. The reviewer also inspected the [current Starlette maintainer advisory listing](https://github.com/Kludex/starlette/security/advisories). No targeted dependency upgrade was warranted by this evidence. Advisory scans do not establish provenance, unknown-vulnerability absence or full security certification. Python artifact hashes remain an existing deployment limitation.

## Remaining scope limits

- Production is still explicitly unsupported. TLS ingress, enterprise identities/revocation/MFA, protected filesystem permissions, immutable evidence retention/recovery, hosted repository controls and real-sink authorization remain deployment requirements.
- Fixed admission windows bound application work, not network bandwidth or immunity to authenticated abuse. Cross-origin browser preflights contain no bearer token and share untrusted admission capacity; the authenticated same-origin dashboard proxy avoids that preflight dependency.
- The bounded buffer retains 2,000 protected events, not an immutable archive. Credential/token recognition and known-pattern redaction are additional safeguards, not complete DLP or arbitrary encoding recognition.
- Policy, credential and SQLite files are trusted operator assets. Their integrity must be enforced with filesystem permissions. A structurally valid maliciously rewritten database is outside the demonstrated untrusted HTTP boundary.
- There is no actual model, tool execution, file upload, payment, database-query input, RAG or external data integration to certify. Cookie CSRF/session controls are inapplicable to this in-memory bearer client with omitted cookies and refused redirects.
