# Main integration verification

Merged `d14d5b4a1b3c42edd3965d86f927465387ab7eb0` with previous main
`c49f1cf07b9e6faf053a5cbdc08c830be0a24da9` through merge `122ce3f`.
The accompanying repair commit reconciles the overlapping frontend contracts
and legacy demo rehearsal with the hardened API.

- Default authenticated mode, bearer authorization, admission limits, protected
  audit retention and credential masking remain authoritative.
- Restored typed summaries and dashboard summary panels; corrected the merged
  transport return shape while retaining bounded streaming and error-body disposal.
- Kept the hardened dashboard's omission of model output and rejection of sensitive
  response fields. Older tests now assert this stricter behavior.
- Legacy HTTP rehearsals explicitly select local-demo. Administrative requests
  require a bearer credential. Public telemetry may be omitted by sampling; the
  rehearsal verifies dropped-sample accounting. Authenticated retention is covered
  by the hardening suite.
- `backend.live_check` requires `AEGIS_CHECK_ADMIN_TOKEN` for administrative calls
  against a separately configured local-demo server. Never use real data for this profile.

Verification on the repaired merged source, 4 October 2026:

- `python -m pytest -q backend/tests`: **442 passed** (one dependency deprecation warning).
- `npm test -- --reporter=dot`: **140 passed**.
- `npm run build`: **passed**, including TypeScript checking.
- `git diff --check`: **passed**.

No new browser E2E run or production deployment certification is claimed.
Historical reports describe their recorded revisions, not this integration.
For startup and authentication use `backend/README.md`; older demo identity
headers in historical documentation do not grant access.
