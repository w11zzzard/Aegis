# Nullable audits and scenario inputs — 3 October 2026

Branch: `codex/fix-audit-scenarios`, based on cached `origin/main` at
`4e9a3ecbac6d685d49a6685635a9f58debefd787`. Reuses the focused repairs and
regressions from the existing `codex/b-dashboard-integration` branch.
Remote freshness could not be checked because this host's Git installation
cannot locate its HTTPS remote helper. No push, PR, merge or deployment occurred.

Nullable request/context metadata is omitted at the adapter boundary and rendered
as `Not reported`. Required audit evidence, valid enums, finite nonnegative latency,
recognized envelopes and matching detail IDs remain enforced. Backend, policies
and authorization controls are unchanged.

The five presets now reach these verified decision/policy pairs:

| Preset | Decision | Policy |
| --- | --- | --- |
| Public market summary | ALLOW | market_public |
| Analyst restricted portfolio | BLOCK | portfolio_restricted |
| Manager restricted portfolio | ALLOW | portfolio_restricted |
| Manager external destination | BLOCK | external_exfiltration |
| Synthetic shell proposal on authorized read | BLOCK | tool_guard |

Verification used the unchanged main backend with locked Python dependencies in
a disposable workspace directory, one process on port 18014. Browser tests used
installed Chrome and a dedicated Vite proxy on port 18174. Existing servers and
worktrees were preserved. All listed checks passed:

- `npm run test:coverage`: 38 tests; 100% statements/lines, 97.87% branches,
  96.96% functions; configured coverage thresholds passed.
- `npm run build`: TypeScript and production Vite build. Only upstream Zod
  annotation warnings were emitted.
- `AEGIS_API_URL=http://127.0.0.1:18014 npm run test:live`: five HTTP 200
  decision/policy pairs, matching event IDs and exact reasons, nullable ordinary
  and unknown-identity events, HTTP 422 malformed event, mixed feed membership.
- Same API URL, `npm run test:integration`: application adapter validates the
  mixed real feed and each exact detail, then evaluates all five actual presets.
- `PLAYWRIGHT_CHANNEL=chrome AEGIS_FRONTEND_PORT=18174 npm run test:e2e`:
  two fixture browser tests passed.
- Same channel/port, with `AEGIS_REAL_BROWSER=1` and
  `AEGIS_BACKEND_URL=http://127.0.0.1:18014`: one separate real browser journey
  passed, with no API interception. It checked every preset's decision/policy,
  exact returned audit ID/reason, and nullable malformed details. Malformed audit
  event inspected: `5d58500f-2e94-4f14-9dd5-cfbaca8a5ea0`.
- `git diff --check origin/main`: passed.

Fixture results are separate from real integration evidence. Live checks create
synthetic audit records and consume the disposable process's in-memory quotas.
