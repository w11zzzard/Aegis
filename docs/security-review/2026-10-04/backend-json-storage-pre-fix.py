"""Reconstruct the missing outer SQLite guard without editing application files.

Parallel work had installed the guard before storage regressions were written.
This reproduction uses current inner handling and removes only the new guard,
while retaining the pre-existing security header wrapper. It is not presented
as a checkout of the entire prior revision.
"""

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest

from backend.security import SecurityMiddleware


async def unguarded_boundary(self, scope, receive, send):
    if scope["type"] != "http":
        return await self.app(scope, receive, send)

    async def secure_send(message):
        if message["type"] == "http.response.start":
            message["headers"] = list(message.get("headers", [])) + [
                (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"),
                (b"referrer-policy", b"no-referrer"), (b"x-frame-options", b"DENY"),
                (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
            ]
        await send(message)

    return await self.handle(scope, receive, secure_send)


if __name__ == "__main__":
    print("Reconstructed pre-fix boundary: current inner handling, outer sqlite3.Error guard removed.")
    with patch.object(SecurityMiddleware, "__call__", unguarded_boundary):
        raise SystemExit(pytest.main([
            "backend/tests/test_storage_boundary.py", "-q", "--tb=short", "-k",
            "(audit and (malformed or duplicate-vendor or oversized)) or timed_out_body or schema_rejection_audit",
        ]))
