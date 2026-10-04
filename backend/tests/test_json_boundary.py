"""Regressions for the JSON media types accepted by the installed FastAPI."""

import asyncio
from copy import deepcopy
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.body_limit import BodyLimitMiddleware
from backend.main import ROOT, create_app
from backend.tests.test_core import proposal


TOKENS = {"manager_1": "m" * 48, "security_admin_1": "s" * 48}
JSON_MEDIA = [
    "application/json",
    'Application/JSON; Charset="UTF-8"',
    "application/vnd.aegis+json",
    'APPLICATION/VND.AEGIS+JSON; charset="utf-8"; version=1',
    "application/problem+json",
    "application/+json; charset=utf-8",
]
ROUTES = ["evaluate", "chat", "approval", "redteam"]


@pytest.fixture
def boundary_client(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_bytes((ROOT / "policies/default.yaml").read_bytes())
    app = create_app(policy, profile="authenticated", auth_tokens=TOKENS,
                     state_path=tmp_path / "state.sqlite3")
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as client:
        yield client


def route_request(client, route):
    security = proposal(user=None, role=None)
    if route == "evaluate":
        return "/api/security/evaluate", "manager_1", security
    if route == "chat":
        return "/v1/chat/completions", "manager_1", {
            "messages": [{"role": "user", "content": "Synthetic ordinary question"}],
            "security": security,
        }
    if route == "approval":
        pending = client.post("/api/security/evaluate", json={**security, "action": "export"},
                              headers={"Authorization": "Bearer " + TOKENS["manager_1"]}).json()
        assert pending["decision"] == "REQUIRE_APPROVAL"
        return "/api/approvals/" + pending["event_id"], "security_admin_1", {"approve": True}
    return "/api/redteam/run", "security_admin_1", {}


def primary_duplicate(route, payload):
    raw = json.dumps(payload)
    if route == "evaluate":
        return raw[:-1] + ',"action":"export"}'
    if route == "chat":
        security = json.dumps(payload["security"])
        return raw.replace(security, security[:-1] + ',"role":"PORTFOLIO_MANAGER"}')
    if route == "approval":
        return '{"approve":false,"approve":true}'
    return '{"synthetic":"first","synthetic":"last"}'


def nested_duplicate(route, payload):
    nested = '{"outer":{"synthetic":"first","synthetic":"last"}}'
    raw = json.dumps(payload)
    if route == "chat":
        security = json.dumps(payload["security"])
        return raw.replace(security, security[:-1] + ',"tool_arguments":' + nested + '}')
    return raw[:-1] + ("," if payload else "") + '"tool_arguments":' + nested + '}'


def rejected_body(case, route, payload):
    if case == "duplicate":
        return primary_duplicate(route, payload).encode()
    if case == "nested-duplicate":
        return nested_duplicate(route, payload).encode()
    if case == "malformed-json":
        return b'{"synthetic_private":"submitted-secret",'
    if case == "malformed-encoding":
        return b'{"synthetic_private":"submitted-secret\xff"}'
    if case == "depth":
        return ('{"nested":' + '[' * 34 + '0' + ']' * 34 + '}').encode()
    return json.dumps({"nested": [0] * 10001}).encode()


@pytest.mark.parametrize("media", JSON_MEDIA)
@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("case", ["duplicate", "nested-duplicate", "malformed-json",
                                  "malformed-encoding", "depth", "nodes"])
def test_accepted_json_is_refused_before_any_body_route_mutation(boundary_client, media, route, case):
    path, user, payload = route_request(boundary_client, route)
    gateway = boundary_client.app.state.gateway
    approvals = deepcopy(gateway.approvals)
    with patch.object(gateway, "evaluate", wraps=gateway.evaluate) as evaluate, \
         patch.object(gateway, "resolve_approval", wraps=gateway.resolve_approval) as resolve, \
         patch.object(boundary_client.app.state.redteam, "run", wraps=boundary_client.app.state.redteam.run) as run:
        result = boundary_client.post(path, content=rejected_body(case, route, payload), headers={
            "Authorization": "Bearer " + TOKENS[user], "Content-Type": media,
        })
    assert result.status_code == 422
    assert result.json()["decision"] == "BLOCK"
    assert result.json()["reason"] == "Malformed or ambiguous JSON request"
    assert result.headers["cache-control"] == "no-store"
    assert "submitted-secret" not in result.text
    evaluate.assert_not_called()
    resolve.assert_not_called()
    run.assert_not_called()
    assert gateway.approvals == approvals


@pytest.mark.parametrize("media", JSON_MEDIA)
@pytest.mark.parametrize("field,first,last", [("user", "analyst_42", None), ("role", "ANALYST", None)])
def test_duplicate_identity_is_rejected_before_binding(boundary_client, media, field, first, last):
    payload = proposal(user=None, role=None)
    payload[field] = first
    raw = json.dumps(payload)[:-1] + ',' + json.dumps(field) + ':' + json.dumps(last) + '}'
    gateway = boundary_client.app.state.gateway
    with patch.object(gateway, "evaluate", wraps=gateway.evaluate) as evaluate:
        result = boundary_client.post("/api/security/evaluate", content=raw, headers={
            "Authorization": "Bearer " + TOKENS["manager_1"], "Content-Type": media,
        })
    assert result.status_code == 422 and result.json()["decision"] == "BLOCK"
    assert result.json()["reason"] == "Malformed or ambiguous JSON request"
    evaluate.assert_not_called()


@pytest.mark.parametrize("media", JSON_MEDIA)
@pytest.mark.parametrize("route", ROUTES)
def test_valid_json_has_equivalent_route_behavior(boundary_client, media, route):
    path, user, payload = route_request(boundary_client, route)
    result = boundary_client.post(path, content=json.dumps(payload), headers={
        "Authorization": "Bearer " + TOKENS[user], "Content-Type": media,
    })
    assert result.status_code == 200
    if route == "evaluate":
        assert result.json()["decision"] == "ALLOW"
    elif route == "chat":
        assert result.json()["aegis"]["decision"] == "ALLOW"
        assert result.json()["choices"][0]["message"]["content"].startswith("AEGIS offline demo:")
    elif route == "approval":
        assert result.json()["status"] == "approved" and result.json()["executed"] is False
    else:
        assert result.json()["passed"] == 16 and result.json()["unexpected_allows"] == 0


@pytest.mark.parametrize("content_type", [None, ""])
@pytest.mark.parametrize("route", ROUTES)
def test_installed_fastapi_strict_media_type_refuses_nonempty_body_without_type(boundary_client, content_type, route):
    # FastAPI 0.142.2 defaults to strict_content_type=True: body bytes are not JSON here.
    path, user, payload = route_request(boundary_client, route)
    gateway = boundary_client.app.state.gateway
    approvals = deepcopy(gateway.approvals)
    request_headers = {"Authorization": "Bearer " + TOKENS[user]}
    if content_type is not None:
        request_headers["Content-Type"] = content_type
    with patch.object(gateway, "evaluate", wraps=gateway.evaluate) as evaluate, \
         patch.object(gateway, "resolve_approval", wraps=gateway.resolve_approval) as resolve, \
         patch.object(boundary_client.app.state.redteam, "run", wraps=boundary_client.app.state.redteam.run) as run:
        result = boundary_client.post(path, content=json.dumps(payload), headers=request_headers)
    assert result.status_code == 422 and result.json()["decision"] == "BLOCK"
    assert result.headers["cache-control"] == "no-store"
    evaluate.assert_not_called()
    resolve.assert_not_called()
    run.assert_not_called()
    assert gateway.approvals == approvals


def test_bodyless_redteam_still_works_without_content_type(boundary_client):
    result = boundary_client.post("/api/redteam/run", headers={
        "Authorization": "Bearer " + TOKENS["security_admin_1"],
    })
    assert result.status_code == 200 and result.json()["passed"] == 16


@pytest.mark.parametrize("encoding", ["utf-8-sig", "utf-16", "utf-32"])
def test_supported_json_byte_encoding_is_not_narrowed(boundary_client, encoding):
    result = boundary_client.post("/api/security/evaluate", content=json.dumps(proposal(user=None, role=None)).encode(encoding),
                                  headers={"Authorization": "Bearer " + TOKENS["manager_1"],
                                           "Content-Type": "application/vnd.aegis+json"})
    assert result.status_code == 200 and result.json()["decision"] == "ALLOW"


@pytest.mark.parametrize("media_pair", [("application/json", "application/vnd.aegis+json"),
                                      ("application/vnd.aegis+json", "application/json")])
def test_duplicate_content_type_headers_remain_ambiguous(boundary_client, media_pair):
    gateway = boundary_client.app.state.gateway
    with patch.object(gateway, "evaluate", wraps=gateway.evaluate) as evaluate:
        result = boundary_client.post("/api/security/evaluate", content=json.dumps(proposal(user=None, role=None)),
                                      headers=[("Authorization", "Bearer " + TOKENS["manager_1"]),
                                               *(('Content-Type', media) for media in media_pair)])
    assert result.status_code == 400 and result.json()["detail"] == "Ambiguous content type"
    evaluate.assert_not_called()


def run_body_boundary(gateway, body_chunks, headers, downstream, receive_error=None):
    messages = []

    async def run():
        incoming = iter(body_chunks)

        async def receive():
            if receive_error is not None:
                raise receive_error
            return next(incoming)

        async def send(message):
            messages.append(message)

        scope = {"type": "http", "method": "POST", "path": "/api/security/evaluate", "headers": headers}
        await BodyLimitMiddleware(downstream, gateway)(scope, receive, send)

    asyncio.run(run())
    return messages


@pytest.mark.parametrize("length", [None, b"1", b"99999999"])
@pytest.mark.parametrize("body", [b'{"action":"export","action":"read"}', b'x' * 65537],
                         ids=["duplicate-json", "oversized"])
def test_chunked_json_and_size_limits_ignore_untrusted_content_length(boundary_client, length, body):
    async def downstream(*args):
        raise AssertionError("Rejected chunked body reached downstream")

    headers = [(b"content-type", b"application/vnd.aegis+json"), (b"transfer-encoding", b"chunked")]
    if length is not None:
        headers.append((b"content-length", length))
    chunks = [{"type": "http.request", "body": body[:7], "more_body": True},
              {"type": "http.request", "body": body[7:], "more_body": False}]
    messages = run_body_boundary(boundary_client.app.state.gateway, chunks, headers, downstream)
    expected = 413 if len(body) > 65536 else 422
    assert messages[0]["status"] == expected
    assert json.loads(messages[1]["body"])["decision"] == "BLOCK"


def test_valid_chunked_json_is_replayed_unchanged(boundary_client):
    chunks = [{"type": "http.request", "body": b'{"action":', "more_body": True},
              {"type": "http.request", "body": b'"read"}', "more_body": False}]
    observed = []

    async def downstream(scope, receive, send):
        observed.append(await receive())
        observed.append(await receive())

    run_body_boundary(boundary_client.app.state.gateway, chunks,
                      [(b"content-type", b"application/vnd.aegis+json")], downstream)
    assert observed == chunks


def test_ten_second_receive_deadline_covers_entire_chunked_body(boundary_client):
    async def downstream(*args):
        raise AssertionError("Timed-out body reached downstream")

    chunks = [{"type": "http.request", "body": b'{"action":', "more_body": True}]
    with patch("backend.body_limit.perf_counter", side_effect=[0, 0, 10.01]):
        messages = run_body_boundary(boundary_client.app.state.gateway, chunks,
                                    [(b"content-type", b"application/vnd.aegis+json")], downstream)
    assert messages[0]["status"] == 408
    assert json.loads(messages[1]["body"])["reason"] == "Request body timed out"


@pytest.mark.parametrize("body", [b'[' * 32 + b'0' + b']' * 32,
                                 json.dumps([0] * 9999).encode(),
                                 b'{}' + b' ' * (65536 - 2)],
                         ids=["exact-depth", "exact-node-count", "exact-byte-limit"])
def test_documented_json_limits_accept_exact_boundary(boundary_client, body):
    observed = []

    async def downstream(scope, receive, send):
        observed.append((await receive())["body"])

    messages = run_body_boundary(boundary_client.app.state.gateway,
                                [{"type": "http.request", "body": body, "more_body": False}],
                                [(b"content-type", b"application/vnd.aegis+json")], downstream)
    assert messages == []
    assert observed == [body]


@pytest.mark.parametrize("media", ["application/json", "application/vnd.aegis+json"])
@pytest.mark.parametrize("constant", [b"NaN", b"Infinity", b"-Infinity", b"1e999"])
def test_nonfinite_json_values_refused_before_downstream(boundary_client, media, constant):
    async def downstream(*args):
        raise AssertionError("Nonfinite JSON reached downstream")

    body = b'{"tool_arguments":{"synthetic":' + constant + b'}}'
    messages = run_body_boundary(boundary_client.app.state.gateway,
                                [{"type": "http.request", "body": body, "more_body": False}],
                                [(b"content-type", media.encode())], downstream)
    assert messages[0]["status"] == 422
    assert json.loads(messages[1]["body"])["decision"] == "BLOCK"
