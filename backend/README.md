# AEGIS backend

The gateway evaluates synthetic proposals deterministically. It never executes tools, loads confidential documents or calls a live model. The interface is [API contract v1.1](../docs/API_CONTRACT.md).

## Authenticated local setup

From the repository root, using Python 3.12+:

```powershell
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
./backend/.venv/Scripts/python.exe -m backend.credentials
$env:AEGIS_PROFILE = 'authenticated'
$env:AEGIS_AUTH_FILE = (Resolve-Path '.aegis/credentials.json').Path
$env:AEGIS_STATE_PATH = Join-Path (Get-Location) '.aegis/state.sqlite3'
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

The provisioner creates independent cryptographically random credentials in an exclusive file; it never prints their values or overwrites operator work. Keep `.aegis/` private to the operator account using filesystem permissions (on Windows, inspect its NTFS ACL). Git ignores it. Share only each user's own credential and protect policy files with the same operator boundary. Rotate by replacing the file privately and restarting every worker; removing identities from the policy denies subsequent admissions. These are service tokens, with no password login, session/MFA or identity-provider integration.

In `frontend/`, run `npm ci` and `npm run dev`. Enter your token in **API credential** and choose **Connect**. It stays in memory until disconnect/reload. A preset must match its credential: a manager token cannot impersonate an analyst. An analyst requesting the restricted portfolio receives BLOCK; an authorized manager requesting INTERNAL receives ALLOW; RESTRICTED to EXTERNAL blocks regardless of role.

CLI example (keep credentials out of URLs and Git):

```powershell
$credentialMap = Get-Content '.aegis/credentials.json' -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $credentialMap.manager_1 }
$body = @{ action='read'; resource='portfolio/current_positions'; classification='RESTRICTED'; destination='INTERNAL' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/security/evaluate -Method Post -Headers $headers -ContentType application/json -Body $body
Invoke-RestMethod http://127.0.0.1:8000/api/events -Headers $headers
```

User/role come from the verified credential and current policy registry. Conflicting claims block. `X-Aegis-User` grants nothing. Users read only their own events; SECURITY_ADMIN may inspect all sanitized events, global stats, policies and red-team results, run red-team cases and resolve approvals. Admin status grants no business-resource access. Health is public liveness only; docs/OpenAPI are disabled.

## Explicit synthetic demo

Set `$env:AEGIS_PROFILE='local-demo'` to exercise selectable demo identities from a loopback client. Public simulator evaluations and metadata reads are available; they do not authenticate an originating user. Admin writes still require a configured admin token. Without a state path, this profile uses bounded memory and one worker. Never publicly proxy it or connect real data.

## Configuration and state

`AEGIS_POLICY_PATH` selects YAML. `AEGIS_AUTH_FILE` selects the private identity-to-token JSON map; `AEGIS_AUTH_TOKENS` can instead supply that map as an environment value. Tokens must be unique URL-safe strings of 32–256 characters; use the generator rather than human-chosen values. Invalid/duplicate credentials fail startup. The default profile is authenticated; protected requests refuse missing state configuration (503) or missing/invalid credentials (401).

`AEGIS_STATE_PATH` enables atomic SQLite state shared by workers on one host and across restarts. All workers must use the same absolute local-filesystem path, policy, credentials and code. Quota reservations, approval changes and protected audit updates commit before success; state failure returns sanitized 503 without output or an empty-quota fallback. Separate databases per worker, network filesystems and distributed deployment are unsupported. State retains the latest 2,000 protected events, separate bounded rejection telemetry, saturating lifetime counts, sliding usage windows, bounded approvals and latest red-team results. It is a bounded durable buffer, not an immutable forensic archive. Production needs retention/export/backup and recovery verification. Persisted windows use wall time; maintain a trustworthy host clock. Clock rollback expires pending approvals conservatively and grants no fresh admission allowance.

Before policy/body work, admission allows 120 requests per ten seconds without a configured bearer credential, and separately 1,200 requests globally / 120 per credential principal per ten seconds. It covers health, preflight and administrative reads too. Refused requests return sanitized 429 plus Retry-After: 10. The fixed limits are defined in backend/admission.py; changing them requires consistent worker code and verification. IPs and forwarding headers are ignored for quotas; at most 1,002 keys exist. Cross-origin browser preflights share the untrusted quota; the recommended same-origin frontend proxy keeps authenticated calls independent of that bucket. A stolen credential can consume that principal's allowance. These bounds control accepted work and shared-state cardinality, not all incoming sockets or SQLite contention. Host/ingress connection limits remain a deployment requirement.

Unauthenticated/access/body/schema rejection floods and public demo evaluations cannot evict protected evaluations or approvals. Rejection telemetry uses a separate SQLite security_controls row, up to 256 sanitized samples and at most 16 new samples per ten seconds, with fixed-category counts and dropped/overwritten-sample counts exposed to admins under stats.abuse. Early admission refusals count without event sampling. Protected decisions include authenticated BLOCK and THROTTLE as well as successful evaluations and approval evidence. Public demo event IDs and rejection IDs may no longer be retrievable when their sample is omitted or rotated. Legacy retained events are grandfathered into protected capacity without trusting old classification strings; metadata reports how many were preserved.

SQLite uses immediate transactions and a five-second lock wait with full synchronous commits. Telemetry only rewrites its small bounded row; protected writes use the existing bounded gateway row. Database page allocation may keep a prior high-water mark rather than shrink automatically; growth from these event/limiter pools is bounded. Budget keys are capped at 1,000 live reservations and expire without clearing active quotas. Do not delete or recreate state to clear limits. Locked, unavailable or corrupt state produces refusal with no-store and all API security headers, including middleware body errors; the outage fallback never audits into the failed store. Invalid persisted schemas are refused while preserving stored bytes. Failures after response headers start close the response and cannot emit a second status. Stop all workers before operator-controlled backup/recovery/maintenance; protect database/credentials with filesystem ACLs. Recovery remains a production gate.

Hosts default to localhost and IPv4/IPv6 loopback; `AEGIS_ALLOWED_HOSTS` is the operator-controlled comma-separated list. `AEGIS_ALLOWED_ORIGINS` lists exact frontend HTTP(S) origins without paths, wildcards or null origin; defaults are localhost/127.0.0.1:5173. For the optional live browser suite on 5174, explicitly include its origin. Actual browser requests are checked in addition to CORS, including bodyless POSTs. Any future proxy needs deliberate forwarding trust. API/error headers include no-store, nosniff, frame denial, no-referrer and a restrictive API CSP; configure effective frontend/ingress headers separately.

## Enforcement and audit

Invalid/missing/duplicate-key/aliased/oversized policy fails closed. Evaluation captures config/digest together; pending approval cannot adopt a concurrently reloaded digest. Each red-team run pins one policy and reports its version/digest. Trusted classification, registered roles, destination restrictions, exact allowlisted tool proposals and conservative character quotas remain authoritative. Only matching read/export resource proposals are admitted; tools never execute.

Masking recognizes temporary ASIA AWS keys and one bounded base64 decoding layer containing recognizable credential patterns or an exact configured service token. Configured opaque service tokens are recognized by digest/length, including tokens embedded in longer URL-safe audit metadata or output. Only digest/length pairs remain in memory for this check; its comparison budget is bounded and conservatively masks the whole value when exhausted. Unknown formats and arbitrary encodings remain outside this masker; authoritative data boundaries are still required. Raw prompt/output/source are excluded from audit and pending state. Resolution records preserve requester/action and add actor/approval correlation. Denied privileged attempts and replay/expiry failures are audited. Resolution expires after five minutes and is evidence only, without execution or a reusable grant.

Body safeguards use the installed FastAPI MIME parser for application/json and accepted application/*+json variants, with duplicate-key rejection at every level. Case/parameters and valid UTF encodings preserve framework behavior. Nonempty missing/empty Content-Type is sanitized 422 with strict FastAPI parsing; bodyless red-team requests remain supported. Actual chunks enforce 64 KiB even with false/missing Content-Length; nesting32, nodes10,000 and the full ten-second deadline apply before endpoint parsing. Duplicate Content-Type headers are refused. See the API contract for canonical 422/413/408 BLOCK responses and storage-outage precedence.

Red-team runs require SECURITY_ADMIN, admit one run per ten seconds and do not hold the live gateway lock. Cases use isolated quotas; invalid corpus returns 503. `unexpected_allows` counts expected BLOCK / actual ALLOW.

## Verification

```powershell
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q --cov=backend --cov-config=backend/.coveragerc --cov-report=term-missing
./backend/.venv/Scripts/python.exe -m backend.demo
$env:AEGIS_TEST_PYTHON = (Resolve-Path 'backend/.venv/Scripts/python.exe').Path
node frontend/scripts/verify-security.mjs
```

Build the frontend first. The browser verifier uses fresh ephemeral loopback services, synthetic credentials and headless Chrome. Set `PLAYWRIGHT_CHANNEL=chromium` after installing Playwright Chromium when Chrome is unavailable. Historical characterization tests in `frontend/audit/` describe the old revision and stay outside the active regression suite.

Production remains gated: `AEGIS_PROFILE=production` is rejected. Verified TLS ingress, enterprise identity/MFA/revocation, least-privilege runtime/ACLs, protected audit retention/recovery, hosted repository controls and authorization at real data/tool sinks are still required before production/confidential integrations.
