# Developer B integration evidence — 3 October 2026

This records actual local runs, separate from fixture results. No merge or deployment was performed.

## Repository and ownership

- Base: latest origin/main when fetched, `4e9a3ecbac6d685d49a6685635a9f58debefd787`.
- Branch: `codex/b-dashboard-integration`, isolated worktree under the accessible admin workspace.
- Supplied uczen workspace/skill paths do not exist on this host. Equivalent installed ECC conventions skill was read at `C:/Users/admin/.codex/plugins/cache/ecc/ecc/2.2.3/.agents/skills/ecc-conventions/SKILL.md`.
- No applicable repository/ancestor AGENTS.md was found.
- Original checkout and untracked `docs/PROJECT_FORM.md` preserved.
- Branch diff contains only `frontend/`. Backend, policies, redteam, backend tests and shared contract are unchanged.
- Developer A's published checkpoint `071e57e` on `codex/a-contract-audit` was inspected in a separate detached checkout, without modifying or merging it.

## Test-first evidence

Nullable/scenario regression suite initially had 6 failures among 12 tests. Backend-shaped null context rejected the feed/details; demo identities/resources targeted incorrect guards. Tests were committed before production repairs.

The original live-check script failed against the real backend because it returned policy `identity`, rather than expected `portfolio_restricted`. The repaired check uses registered identities and asserts decision, policy, ID, request ID, retrieval, finite latency, listing membership and nullable metadata.

Summary/client tests initially had 14 failures among 18 tests (schemas absent, approval header absent, sanitized output missing); summary panel tests initially failed because the component did not exist. Additional demo tests initially had 4 failures among 7 tests. Production changes followed those observed failures.

## Exact checks and results

Windows Node 22.22.0, npm 10.9.4, installed Chrome, Vitest 4.1.11, Vite 7.3.6. All commands run from frontend unless stated otherwise.

| Check | Current result |
| --- | --- |
| npm ci --no-audit --no-fund | PASS; clean locked installation, 171 packages |
| npm test | PASS; 69 fixture/unit/component tests, 6 files |
| npm run test | PASS; 69 fixture/unit/component tests, 6 files |
| npm run test:coverage | PASS; statements 99.49%, branches 88.19%, functions 98.48%, lines 99.28%; all required thresholds 80% |
| npm run build | PASS; strict TypeScript and Vite production build |
| npm run test:e2e, AEGIS_REAL_BROWSER unset | PASS; 2 fixture browser tests, including offline narrow-screen layout |
| npm run test:live, AEGIS_API_URL=http://127.0.0.1:8011 | PASS; five guard-policy pairs, real ID/retrieval/listing and malformed nullable event |
| npm run test -- --config vitest.live.config.ts --reporter=verbose, AEGIS_API_URL=http://127.0.0.1:8011 | PASS; 11 real-backend tests against A checkpoint 071e57e |
| Same typed live command, AEGIS_API_URL=http://127.0.0.1:8010 | PASS; 11 real-backend tests against unchanged main 4e9a3ec |
| AEGIS_REAL_BROWSER=1 npm run test:e2e, AEGIS_BACKEND_URL=http://127.0.0.1:8011 | PASS; 1 separate real Chrome journey, seven scenarios, audit refresh, nullable inspection, summaries and actual 16-case corpus; no API interception |
| npm audit --json | PASS; zero vulnerabilities after isolated test-runner upgrade |
| git diff --check origin/main | PASS |

Build emits two upstream Zod comment-annotation warnings; no type/build failures. Browser runner emits harmless NO_COLOR/FORCE_COLOR notices.

The unit/component and fixture browser runs do **not** establish backend correctness. The 11 HTTP integration tests and separate real browser journey above used actual FastAPI servers and the Vite proxy. Quotas and records were not mocked or reset through an invented endpoint.

## Actual backend evidence

Typed live run against A's checkpoint at 17:37 Europe/Warsaw:

| Scenario | Actual decision | Actual policy | Retrieved audit ID |
| --- | --- | --- | --- |
| Public | ALLOW | market_public | 7e14f143-f886-4336-a0ff-825e2f7d62bc |
| Analyst restricted | BLOCK | portfolio_restricted | 9f845c7e-2df9-4eb3-872e-7029bbc91ae7 |
| Manager restricted | ALLOW | portfolio_restricted | 1ec2aecf-a0cc-4d42-bd1a-b981409ba390 |
| Restricted external | BLOCK | external_exfiltration | cc03f2f2-b24e-4888-9e7c-cdcdd7fc5bff |
| Unsafe shell proposal | BLOCK | tool_guard | 10446d11-34df-4e76-98c1-95315b907304 |
| Synthetic output | REDACT | output_secrets | aee63bfe-2bd7-43b5-9c3f-547b25beff9e |
| Budget limit | THROTTLE | budget | 480bebd4-2a6c-4cc5-9945-1691ca6d254d |

Real malformed event inspected through typed adapter: `b2c8ce0b-9992-4c89-8744-4915092de2b9`.
Unknown actor was sanitized to unavailable metadata and retained alongside ALLOW/malformed events.
Real corpus run `8be9d508-ca7a-4750-87cd-f23deb8406e9`: 16/16 passed, 0 failed, 0 unexpected allows.
An authorized export returned REQUIRE_APPROVAL/portfolio_restricted; resolution returned approved, security_admin_1, executed:false. Replay returned HTTP 409; missing ID returned HTTP 404.

Separate real browser nullable inspection ID: `4971e1e7-92a2-45ac-81df-0ec9a094a221`. Chrome verified seven decision/policy pairs and rendered the real corpus with 16 passed. These IDs are historical evidence for these processes; in-memory audit data disappears when servers restart.

Backward-compatibility run on main at 17:39 also passed all 11 tests and corpus 16/16. Main omits attempted action; frontend displays Not reported. A's additive event action is accepted and preserved, including export.

## Advisory recheck

Initial npm audit reported the moderate Vitest redirect-mock advisory GHSA-82fw-gwwq-j7x9 through Vitest 3.2.7, mocker and coverage. The maintainer advisory identifies 4.1.11 as patched: [GitHub advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

Only Vitest and matching coverage were upgraded and pinned to 4.1.11 in a separate commit. React/Vite/application dependencies were not broadly upgraded. npm 10's optional-peer resolver failed during upgrade; npm 11.6.2 was used transiently for resolution. The resulting lockfile was verified with the normal npm 10 npm ci, tests, coverage, build and audit. No extra CLI dependency was added to the project.

## Commit checkpoints

| SHA | Change |
| --- | --- |
| 4aee78c | test(frontend): reproduce nullable audit and demo guard failures |
| 2c85e66 | fix(frontend): accept nullable audit metadata |
| 43233bb | fix(demo): align scenarios with backend policies |
| 836282e | fix(integration): verify registered identities and real browser journey |
| 6a443d3 | fix(frontend): validate summaries and scope demo approval credentials |
| d99cbce | feat(dashboard): display validated security summaries |
| 43765cb | feat(demo): verify redaction and budget guard scenarios |
| 90684ac | fix(deps): patch Vitest redirect mock advisory |
| 849729b | test(integration): verify summaries output guards and approval replay |

The final documentation commit is visible in git log.

## Remaining limits and handoff

Full approval UI is absent; typed client plus fixture/live resolution tests are delivered. Expiry/authorization/validation error guidance is covered by fixtures; actual replay/missing-ID resolution is verified. Policy invalid-load and corpus-failure UI states are covered by fixtures; the real servers used the valid default policy and corpus. No backend policy files were changed to force failure.

No production identity authentication, live model, real portfolio store, persistent audit, or tool execution is claimed. Refresh summaries checks policy hot-reload state on demand. There is no status stream.

Developer A owns delivery of the new shared contract and additive action field. Main compatibility remains functional while that branch awaits its normal review flow. Copyable integration handoff and exact reproduction commands are in README.md.
