"""Explicit demo profile and bearer-authenticated API boundary."""

import hashlib
import json
import re
import sqlite3
from time import perf_counter
from urllib.parse import urlsplit

from fastapi.responses import JSONResponse

from .models import Decision, EvaluateRequest

TRUSTED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}


def validate_origins(origins):
    for origin in origins:
        url = urlsplit(origin)
        if url.scheme not in {"http", "https"} or not url.hostname or "*" in origin or url.username or url.password or url.path or url.query or url.fragment:
            raise ValueError("Origins must be exact HTTP(S) origins without paths or wildcards")
    return set(origins)


def credential_hashes(tokens):
    if not isinstance(tokens, dict) or len(tokens) > 1000:
        raise ValueError("Credentials must be an identity-to-token mapping")
    hashes = {}
    for user, token in tokens.items():
        if not isinstance(user, str) or not re.fullmatch(r"[A-Za-z0-9_./:-]{1,128}", user):
            raise ValueError("Invalid credential identity")
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
            raise ValueError("Use an independently generated URL-safe token of at least 32 characters per identity")
        digest = hashlib.sha256(token.encode()).digest()
        if digest in hashes:
            raise ValueError("Credential tokens must be unique")
        hashes[digest] = user
    return hashes


def parse_credentials(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate credential identity")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


class SecurityMiddleware:
    def __init__(self, app, gateway, profile, hashes, state_ready, origins):
        self.app, self.gateway, self.profile, self.hashes = app, gateway, profile, hashes
        self.state_ready = state_ready
        self.origins = origins

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        response_started = False
        async def secure_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"), (b"x-frame-options", b"DENY"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
                ]
                response_started = True
            await send(message)

        try:
            return await self.handle(scope, receive, secure_send)
        except sqlite3.Error:
            if response_started:
                # Let the server terminate a started response, never emit a second.
                raise
            await JSONResponse({"detail": "Security state unavailable; request refused"}, status_code=503)(scope, receive, secure_send)

    async def handle(self, scope, receive, secure_send):

        async def deny(status, detail, actor=None):
            correlation = scope["path"].rsplit("/", 1)[-1] if scope["path"].startswith("/api/approvals/") else None
            self.gateway.record(EvaluateRequest(), Decision.BLOCK, "api_access_denied", detail, perf_counter(), actor=actor, correlation=correlation)
            response = JSONResponse({"detail": detail}, status_code=status,
                                    headers={"WWW-Authenticate": "Bearer"} if status == 401 else None)
            await response(scope, receive, secure_send)

        headers = scope.get("headers", [])
        # A digest lookup verifies configured credentials before any policy/body
        # processing. Admission keys never come from body claims, IPs or proxies.
        authorization = [value for key, value in headers if key == b"authorization"]
        user = None
        if len(authorization) == 1 and authorization[0].startswith(b"Bearer ") and len(authorization[0]) <= 263:
            user = self.hashes.get(hashlib.sha256(authorization[0][7:]).digest())
        if not self.gateway.controls.admit(user):
            await JSONResponse({"detail": "Request admission limit exceeded"}, status_code=429,
                               headers={"Retry-After": "10"})(scope, receive, secure_send)
            return
        if sum(key == b"content-type" for key, value in headers) > 1:
            return await deny(400, "Ambiguous content type")
        origin = [value.decode("latin-1") for key, value in headers if key == b"origin"]
        if origin and (len(origin) != 1 or origin[0] not in self.origins):
            return await deny(403, "Untrusted request origin")
        if self.profile == "local-demo" and scope.get("client", (None,))[0] not in {"127.0.0.1", "::1"}:
            return await deny(403, "Local demo requires a loopback client")
        path = scope["path"]
        if path == "/health" or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, secure_send)
        admin = path == "/api/redteam/run" or path.startswith("/api/approvals/")
        # A demo's optional session credential must be verified, not silently
        # reported as anonymous. Public simulation evaluations still use demo
        # claims; this display endpoint grants no business/tool authorization.
        protected = self.profile == "authenticated" or admin or (path == "/api/session" and bool(authorization))
        if protected:
            if self.profile == "authenticated" and not self.state_ready:
                return await deny(503, "Authenticated mode requires AEGIS_STATE_PATH")
            snapshot = self.gateway.snapshot()
            role = snapshot.config.identities.get(user) if snapshot.config else None
            if user is None or role is None:
                return await deny(401, "A valid bearer credential is required")
            if admin and role != "SECURITY_ADMIN":
                return await deny(403, "SECURITY_ADMIN access is required", user)
            scope.setdefault("state", {})["principal"] = (user, role)
        return await self.app(scope, receive, secure_send)
