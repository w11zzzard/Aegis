# Integrated AEGIS checkpoint

Branch: `codex/a-contract-audit`, based on remote main `4e9a3ec`.
Reused A commits: `0f2bb00`, `9c5e248`, `dc6ad3e`, `071e57e`.
Reused B integration: `f576258`, incorporated by merge `0369002`.
Additional functional repair: `be12bcb0c354a5a79c1da148ae331e1e6069705b`.

The contract remains `docs/API_CONTRACT.md`. Validated attempted actions are
sanitized audit metadata. Nullable events render as Not reported. Canonical demos
assert both decision and deciding policy. Reporting uses actual backend counts,
measured latency, conservative_character_units, readiness and corpus results.
Evaluation 422/413 preserves status and the audited event; failed summary refreshes
clear stale success. Redacted output appears only in authorized evaluation results.

## Reproduce

Use the locked Python installation and one loopback backend worker as documented
in `backend/README.md`. From `frontend/`, run `npm ci`, set AEGIS_BACKEND_URL to
that backend and run `npm run dev -- --port 5173 --strictPort`.

From the repository root:

```powershell
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q --cov=backend --cov-config=backend/.coveragerc --cov-report=term-missing
./backend/.venv/Scripts/python.exe -m backend.demo
./backend/.venv/Scripts/python.exe -m pip check
./backend/.venv/Scripts/python.exe -m backend.live_check --url http://127.0.0.1:18021 --evidence live-evidence.json
```

Start a fresh dedicated backend on 18021 before live checks. From `frontend/`:

```powershell
npm test
npm run test:coverage
npm run build
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:AEGIS_FRONTEND_PORT='5181'
Remove-Item Env:AEGIS_REAL_BROWSER -ErrorAction SilentlyContinue
npm run test:e2e
$env:AEGIS_API_URL='http://127.0.0.1:18021'
$env:AEGIS_BACKEND_URL=$env:AEGIS_API_URL
npm run test:live
npm test -- --config vitest.live.config.ts --reporter=verbose
$env:AEGIS_REAL_BROWSER='1'
npm run test:e2e
```

For quota acceptance, copy the default YAML to an ignored temporary policy,
change only `budgets.requests` to 2, start a fresh backend with AEGIS_POLICY_PATH
pointing to that file, and start a second frontend proxying it. Set
AEGIS_QUOTA_FRONTEND_URL to that frontend before the real browser suite. Its
three manager requests must yield ALLOW, ALLOW, THROTTLE / budget. Never edit the
committed policy or reuse a consumed process for this check.

## Fresh evidence

Final verification is stored outside the checkout under the workspace's
`output/final-integration/`. `verification.json` records the exact final HEAD,
commands and exit codes; accompanying logs, HTTP evidence and browser screenshots
are from that checkout. Earlier handoff captures and frontend verification files
remain historical. Installed Chrome is used for both browser suites; fixture
E2E intercepts responses, while the separate live journey does not.

The browser checks the analyst BLOCK, matching response/feed/detail event IDs,
backend reason, nullable validation events, manager/public ALLOW, external/tool
guards, redacted output, real reporting and the committed 16-case corpus.

## Handoff and remaining checkpoint

Dev A: review the integrated contract/audit diff and reproduce backend/live checks.
Dev B: review the adapter, reporting and canonical scenarios; reproduce the browser
journey from this same branch. Shared next checkpoint: rehearse the demo together
from one fresh process and resolve competition-rule/semantic-control questions
before adding scope. Those questions do not block this integration.

No merge to main or deployment is authorized. This remains an offline demo with
selectable registered identities, in-memory state, one worker, no production
authentication, no semantic model and no execution of tool proposals.
