"""The outer boundary must sanitize storage failures before a response starts."""

import asyncio
import json
import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.body_limit import BodyLimitMiddleware
from backend.security import SecurityMiddleware, credential_hashes, TRUSTED_ORIGINS
from backend.tests.test_core import proposal
from backend.tests.test_json_boundary import TOKENS, boundary_client, route_request


ERRORS = [
    pytest.param(sqlite3.OperationalError("SYNTHETIC_PRIVATE operational failure"), id="operational"),
    pytest.param(sqlite3.OperationalError("database is locked SYNTHETIC_PRIVATE"), id="locked"),
    pytest.param(sqlite3.DatabaseError("database disk image is malformed SYNTHETIC_PRIVATE"), id="corruption"),
]
SECURITY_HEADERS = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}
FALLBACK = {"detail": "Security state unavailable; request refused"}


@pytest.mark.parametrize("error", ERRORS)
@pytest.mark.parametrize("case", ["valid", "malformed", "duplicate-vendor", "oversized", "unauthenticated"])
@pytest.mark.parametrize("stage", ["admission", "audit"])
def test_store_outage_refuses_every_http_boundary_with_safe_headers(boundary_client, error, case, stage):
    payload = proposal(user=None, role=None, output="SYNTHETIC_SUBMITTED_SECRET")
    body = json.dumps(payload).encode()
    media = "application/json"
    headers = {"Authorization": "Bearer " + TOKENS["manager_1"]}
    if case == "malformed":
        body = b'{"output":"SYNTHETIC_SUBMITTED_SECRET",'
    elif case == "duplicate-vendor":
        media = "application/vnd.aegis+json"
        body = (json.dumps(payload)[:-1] + ',"action":"export"}').encode()
    elif case == "oversized":
        body = b'SYNTHETIC_SUBMITTED_SECRET' + b'x' * 65537
    elif case == "unauthenticated":
        headers = {}
    headers["Content-Type"] = media
    with TestClient(boundary_client.app, base_url="http://localhost", client=("127.0.0.1", 50000),
                    raise_server_exceptions=False) as client:
        failing = patch("backend.state.sqlite3.connect", side_effect=error) if stage == "admission" else \
                  patch.object(boundary_client.app.state.gateway, "record", side_effect=error)
        with failing as failure:
            result = client.post("/api/security/evaluate", content=body, headers=headers)
    assert result.status_code == 503
    assert result.json() == FALLBACK
    for name, value in SECURITY_HEADERS.items():
        assert result.headers[name] == value
    assert "SYNTHETIC_PRIVATE" not in result.text
    assert "SYNTHETIC_SUBMITTED_SECRET" not in result.text
    assert TOKENS["manager_1"] not in result.text
    # The fallback must not try to record a second event in the unavailable store.
    assert failure.call_count == 1


def run_outer_boundary(gateway, downstream, receive, *, path="/api/security/evaluate", authorization=True):
    messages = []

    async def run():
        async def send(message):
            messages.append(message)

        headers = [(b"content-type", b"application/vnd.aegis+json")]
        if authorization:
            headers.append((b"authorization", ("Bearer " + TOKENS["manager_1"]).encode()))
        scope = {"type": "http", "method": "POST", "path": path, "headers": headers,
                 "client": ("127.0.0.1", 50000), "state": {}}
        outer = SecurityMiddleware(downstream, gateway, "authenticated", credential_hashes(TOKENS), True,
                                   TRUSTED_ORIGINS)
        await outer(scope, receive, send)

    asyncio.run(run())
    return messages


@pytest.mark.parametrize("error", ERRORS)
def test_timed_out_body_during_store_outage_uses_outer_fallback(boundary_client, error):
    gateway = boundary_client.app.state.gateway
    received = []

    async def downstream(*args):
        raise AssertionError("Timed-out request reached downstream")

    async def receive():
        received.append(True)
        raise TimeoutError

    with patch.object(gateway, "record", side_effect=error) as record:
        messages = run_outer_boundary(gateway, BodyLimitMiddleware(downstream, gateway), receive)
    assert messages[0]["status"] == 503
    assert json.loads(messages[1]["body"]) == FALLBACK
    response_headers = {key.decode(): value.decode() for key, value in messages[0]["headers"]}
    for name, value in SECURITY_HEADERS.items():
        assert response_headers[name] == value
    assert record.call_count == 1
    assert received == [True]


@pytest.mark.parametrize("error", ERRORS)
def test_snapshot_storage_failure_is_caught_before_downstream(boundary_client, error):
    gateway = boundary_client.app.state.gateway

    async def downstream(*args):
        raise AssertionError("Failed storage admission reached downstream")

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    with patch.object(gateway, "snapshot", side_effect=error):
        messages = run_outer_boundary(gateway, downstream, receive)
    assert messages[0]["status"] == 503
    assert json.loads(messages[1]["body"]) == FALLBACK
    assert (b"cache-control", b"no-store") in messages[0]["headers"]


@pytest.mark.parametrize("error", ERRORS)
def test_storage_failure_after_response_start_never_sends_second_response(boundary_client, error):
    gateway = boundary_client.app.state.gateway
    messages = []

    async def downstream(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise error

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "method": "POST", "path": "/api/security/evaluate",
             "headers": [(b"authorization", ("Bearer " + TOKENS["manager_1"]).encode())],
             "client": ("127.0.0.1", 50000), "state": {}}
    outer = SecurityMiddleware(downstream, gateway, "authenticated", credential_hashes(TOKENS), True,
                               TRUSTED_ORIGINS)
    with pytest.raises(type(error), match="SYNTHETIC_PRIVATE"):
        asyncio.run(outer(scope, receive, send))
    assert len(messages) == 1
    assert messages[0]["type"] == "http.response.start" and messages[0]["status"] == 200
    assert (b"cache-control", b"no-store") in messages[0]["headers"]


def test_programming_error_is_not_hidden_as_storage_outage(boundary_client):
    async def downstream(*args):
        raise TypeError("synthetic programming error")

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    with pytest.raises(TypeError, match="synthetic programming error"):
        run_outer_boundary(boundary_client.app.state.gateway, downstream, receive)


@pytest.mark.parametrize("error", ERRORS)
@pytest.mark.parametrize("route", ["evaluate", "chat", "approval", "redteam"])
def test_required_commit_failure_returns_no_output_or_durable_approval_success(boundary_client, error, route):
    path, user, payload = route_request(boundary_client, route)
    if route == "evaluate":
        payload["output"] = "SYNTHETIC_SUBMITTED_SECRET"
    gateway = boundary_client.app.state.gateway
    with sqlite3.connect(gateway.store.path) as db:
        before = db.execute("SELECT body FROM gateway_state WHERE id=1").fetchone()
    with patch.object(gateway.store, "save", side_effect=error) as save:
        result = boundary_client.post(path, json=payload, headers={"Authorization": "Bearer " + TOKENS[user]})
    assert result.status_code == 503 and result.json() == FALLBACK
    for name, value in SECURITY_HEADERS.items():
        assert result.headers[name] == value
    assert "SYNTHETIC_SUBMITTED_SECRET" not in result.text
    assert "SYNTHETIC_PRIVATE" not in result.text
    assert save.call_count == 1
    with sqlite3.connect(gateway.store.path) as db:
        after = db.execute("SELECT body FROM gateway_state WHERE id=1").fetchone()
    assert after == before


@pytest.mark.parametrize("error", ERRORS)
def test_schema_rejection_audit_failure_also_uses_outer_fallback(boundary_client, error):
    gateway = boundary_client.app.state.gateway
    with patch.object(gateway, "record", side_effect=error) as record:
        result = boundary_client.post("/api/security/evaluate", json={"action": "invalid", "output": "SYNTHETIC_SUBMITTED_SECRET"},
                                      headers={"Authorization": "Bearer " + TOKENS["manager_1"]})
    assert result.status_code == 503 and result.json() == FALLBACK
    for name, value in SECURITY_HEADERS.items():
        assert result.headers[name] == value
    assert record.call_count == 1
