# JSON parsing and storage boundary verification — 2026-10-04

File ownership for this parallel task: `backend/body_limit.py`, new `backend/tests/test_json_boundary.py`, new `backend/tests/test_storage_boundary.py`, and these `backend-json-*` evidence artifacts. Existing working-tree changes were retained. The outer SQLite guard was implemented by the main agent in `backend/security.py`; this task added its regressions. No real credentials, published services, or Git remotes were changed.

Runtime: existing `.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe`, importing current repository-root source. Verified installed versions: Python 3.12.14, FastAPI 0.142.2, Pydantic 2.13.5, Starlette 1.7.0, pytest 9.1.1. No interpreter or package changes were needed. The ECC python-testing and security-review skills guided tests-first reproduction, input rejection, private-error suppression, and required-persistence checks.

## Finding 2

`BodyLimitMiddleware` now uses `email.message.Message`, matching the installed FastAPI `get_request_handler` implementation, and validates application subtypes equal to `json` or ending in `+json`. Both select the first Content-Type header and parse its Latin-1 value. The existing outer boundary rejects duplicate Content-Type headers. Case and parameters use the same MIME normalization as downstream parsing. The original body-byte cap, total receive deadline, duplicate-key hook, depth limit, node limit, byte encodings, and chunk replay are retained.

Installed FastAPI 0.142.2 has `strict_content_type=True` by default. Nonempty request bodies with absent or empty Content-Type remain byte input and receive the application's existing sanitized schema-validation 422; they are not decoded as JSON. Tests characterize this on all four body routes and assert no evaluation, approval mutation, or red-team execution. Bodyless red-team requests remain valid. If that framework setting is deliberately changed, the missing-media-type policy must be coordinated with the boundary and these regression expectations.

The test matrix covers six accepted media forms and evaluate, chat, approval, and red-team routes. Duplicate action/user/role keys and nested duplicates are rejected before identity binding or business handling. Malformed JSON/encoding and excessive depth/nodes receive canonical sanitized 422 BLOCK responses. Valid vendor JSON retains route behavior. Additional checks cover UTF-8 BOM/UTF-16/UTF-32, duplicate Content-Type, chunked input with false or absent Content-Length, exact byte/depth/node boundaries, and a deterministic ten-second total receive deadline.

Exact commands and results:

```powershell
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests/test_json_boundary.py -q --tb=short *> 'docs/security-review/2026-10-04/backend-json-red.log'
# Exit 1: 107 failed, 95 passed. Recorded before modifying MIME handling.
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests/test_json_boundary.py -q --tb=short *> 'docs/security-review/2026-10-04/backend-json-green.log'
# Exit 0: 202 passed. Exact-boundary checks were added afterward and are in combined evidence.
```

The initial local run generated oversized pytest parameter names on Windows; explicit short IDs corrected this test harness issue before the recorded red run above. Vendor duplicate payloads returning 200 and middleware-skipping malformed bodies are the demonstrated failures in the retained red log.

## Finding 4

Storage regressions inject `sqlite3.OperationalError` (including locked-database wording) and `sqlite3.DatabaseError` (corruption wording) into admission, rejection auditing, snapshot checks, and required business-state saves. Cases include valid, malformed, duplicate vendor JSON, oversized, timed-out, unauthenticated, and schema-invalid requests. All assert the exact existing sanitized 503 and API security headers. The fallback attempts no recursive audit write. Valid evaluate/chat/approval/red-team operations cannot report success after a required save fails; durable state remains unchanged. A post-response-start SQLite failure propagates to the server without a second HTTP response. Programming `TypeError` is not suppressed.

The main agent had installed the outer guard in parallel before this storage regression file existed. The storage red evidence therefore uses the saved, explicitly labelled `backend-json-storage-pre-fix.py` harness: it retains the security-header wrapper and current inner handling, removing only the outer `sqlite3.Error` guard. This is a reconstructed missing-guard reproduction, **not** an original-checkout baseline. It demonstrates 500 responses for middleware audit failures and uncaught timed-out-body audit exceptions.

```powershell
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' 'docs/security-review/2026-10-04/backend-json-storage-pre-fix.py' *> 'docs/security-review/2026-10-04/backend-json-storage-red.log'
# Exit 1: 12 failed, 3 passed, 40 deselected, with only the outer guard removed.
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests/test_storage_boundary.py -q --tb=short *> 'docs/security-review/2026-10-04/backend-json-storage-green.log'
# Exit 0: 55 passed against the current outer guard.
```

## Combined regression command

```powershell
& '.worktrees/b-dashboard-integration/frontend/.integration-venv/Scripts/python.exe' -m pytest backend/tests/test_json_boundary.py backend/tests/test_storage_boundary.py backend/tests/test_security_fixes.py -q --tb=short *> 'docs/security-review/2026-10-04/backend-json-combined-green.log'
git diff --check -- backend/body_limit.py backend/tests/test_json_boundary.py backend/tests/test_storage_boundary.py
```

The combined command exited 0 with **284 passed**: 205 JSON-boundary cases, 55 storage-boundary cases, and 24 existing security-fix cases. Whitespace validation passed (Git reports its normal LF-to-CRLF notice). The only routine pytest warning is the installed Starlette TestClient httpx deprecation. These tests verify the local offline service boundary; they do not establish deployed TLS/runtime controls, a distributed SQLite design, or production readiness.
