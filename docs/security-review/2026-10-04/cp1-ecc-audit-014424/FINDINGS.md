# Security findings — working-tree audit

## F1 — High: recoverable configured credential survives encoded context

Location: `backend/guards.py:CredentialRedactor.matches`, used by `Gateway.redact` for permitted output and retained metadata. Preconditions: an admitted request/model fixture contains a configured opaque bearer inside one bounded base64/base64url-encoded string. At baseline, encoding the token followed by punctuation, surrounding prose or an opaque prefix/suffix produces ALLOW and the unchanged recoverable value. Exact encoded tokens were masked, so earlier coverage missed contextual embedding. Disclosure can expose an administrator bearer; severity applies to the claimed configured-credential masking boundary in this synthetic gateway.

Evidence: `reviewer-http-challenges.json`; six genuine failing-before cases in `primary-encoding-before.log`. The first execution had a pytest temporary-directory permission error; the retained failing-before log is the successful rerun using a unique owned temp directory, not an infrastructure failure.

Fix: decoded text now uses the same bounded substring recognizer as plain text, retaining conservative masking on comparison exhaustion. Final review reproduced larger containers and extended the candidate scan from1,024 to the full16,000-character API text limit. No plaintext credential registry or recursive decoding was added. `backend/tests/test_encoded_credential_context.py` proves standard/URL-safe variants, response/feed/detail/pending/BLOCK/THROTTLE/state sanitation and benign controls. Six new plus ten neighboring cases initially pass in `primary-encoding-after.log`; the two genuine large-container failures in `primary-large-before.log` then pass with27 neighboring tests in `primary-large-after.log`. Independent exact16,000-character hostile and benign controls pass in `reviewer-large-encoded-after.json`; socket HTTP checks independently repeat the full-limit case. Final suite results are recorded in VERIFICATION.json.

Remaining limit: recursive/alternative encodings and unknown secrets remain outside this pattern masker. The intermediate larger-container ALLOW is historical and fixed, not waived by narrower documentation. Catalog/destination authorization remains mandatory. Each substring search caps32,768 comparisons; the quota is per search, not a globally shared response counter. Finite API input/candidate bounds constrain aggregate work. Reviewer full-limit benign probes measured about28,000 hashes/20ms with one length, and32,768/conservative masking/~21ms with225 lengths.

## F2 — Medium: ambiguous trusted attack corpus can report false green

Location: `backend/redteam.py` corpus JSON loading. Preconditions: operator-controlled corpus contains duplicate root/case/request/nested argument keys. Pydantic's direct parser silently retained the later value; duplicate expected BLOCK then ALLOW completed total1/passed1/failed0/unexpected_allows0. This compromises test evidence and can hide an unauthorized allow; it does not let an HTTP caller alter the trusted corpus or bypass production authorization.

Additional reproduction: nonfinite NaN/Infinity/-Infinity and overflowed1e400 numbers in nested arguments also completed green. Four genuine failing-before cases are in `backend-nonfinite-red.log`. Fix: parse through strict duplicate-key and finite-number rejection before schema validation, including nested objects and escaped-equivalent keys. Invalid files fail visibly with sanitized503 and persisted failed runner state. Four duplicate-key regressions, four finite-number regressions, positive16-case control and independent escaped-key/1e999 challenges are retained in backend/reviewer evidence. No baseline corpus expectation or policy was weakened.

## F3 — Low: built fonts violate the configured dashboard CSP

Location: `frontend/vite.config.ts` asset emission. The build inlined small Geist font files as data URLs while preview CSP allowed fonts only from self; browser console showed five violations/resource failures. This is a reproduced configuration mismatch, not an XSS exploit.

Fix: emit assets as same-origin files with `assetsInlineLimit: 0`, preserving strict CSP. Browser regression requires no unexpected console errors. Initial junction-based dev font resolution failure was an audit-environment issue; built preview is the verified path. The original CSP failure was observed in the tool transcript; its raw before-log was not retained. `frontend-before-observations.json` honestly preserves that observation, while final logs/screenshots and build/browser commands supply fixed-state proof. It is not claimed as a retained original raw log.

## F4 — Requirement hardening: sensitive response extras must fail visibly

Location: `frontend/src/adapter.ts`. Baseline schema normalization safely omitted unknown sensitive event/evaluation fields rather than rejecting them. No displayed leak was reproduced, but this fell short of the explicit audit requirement and could hide a backend contract regression. The contract was published before adaptation: raw content/credential/error extras are rejected, event content is refused, and refused evaluations cannot include sanitized output. Legitimate permitted sanitized_output remains compatible and is omitted by this dashboard. Unexpected benign metadata still stays omitted. Failing-before and final regressions document this change; it is not presented as a proven authorization exploit.

## Remaining scope and integration gaps

No unresolved critical/high exploit was identified within the agreed deterministic synthetic application scope after these fixes. This is bounded verification, not a guarantee of arbitrary secret detection or production readiness. CP1 human A/B sign-off remains pending. CP2/CP3 semantic-model requirements are unresolved; no semantic system exists and none was added. CP4 reporting/export components from current PR #3 are absent on the audited hardened target; they require security-preserving integration and verification. Generic administrative JSON consumers remain bounded, not typed reporting validation. Human cold-start/rehearsal and final release/merge certification are pending.

Current official exact-lock dependency scans, installed inventory and relevant tracked/history secret review are mapped in VERIFICATION.json. Zero scanner advisories or findings are not independent proof of security. Historical tests/reports are labeled historical and do not substitute for this run.
