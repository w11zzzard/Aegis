import json
import base64
import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from backend.core import Gateway
from backend.main import ROOT, create_app
from backend.models import EvaluateRequest
from backend.redteam import RedteamRunner
from backend.tests.test_core import proposal

TOKENS = {"analyst_42": "a" * 48, "manager_1": "m" * 48, "security_admin_1": "s" * 48}


def headers(user):
    return {"Authorization": "Bearer " + TOKENS[user]}


@pytest.fixture
def secure(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_bytes((ROOT / "policies/default.yaml").read_bytes())
    app = create_app(policy, profile="authenticated", auth_tokens=TOKENS, state_path=tmp_path / "state.sqlite3")
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as client:
        yield client


@pytest.mark.parametrize("method,path", [("get", "/api/events"), ("get", "/api/events/unknown"),
    ("get", "/api/stats"), ("get", "/api/policies/status"), ("get", "/api/redteam/results"),
    ("post", "/api/security/evaluate"), ("post", "/v1/chat/completions"),
    ("post", "/api/redteam/run"), ("post", "/api/approvals/unknown")])
def test_all_routes_require_real_credentials(secure, method, path):
    result = getattr(secure, method)(path, headers={"X-Aegis-User": "security_admin_1"})
    assert result.status_code == 401
    assert result.headers["cache-control"] == "no-store"
    assert TOKENS["security_admin_1"] not in result.text


def test_principal_binding_and_object_access(secure):
    spoof = secure.post("/api/security/evaluate", json=proposal(user="manager_1", role="PORTFOLIO_MANAGER"), headers=headers("analyst_42"))
    assert spoof.json()["decision"] == "BLOCK"
    body = proposal(user=None, role=None)
    result = secure.post("/api/security/evaluate", json=body, headers=headers("manager_1")).json()
    assert result["decision"] == "ALLOW"
    event_id = result["event_id"]
    assert secure.get("/api/events/" + event_id, headers=headers("analyst_42")).status_code == 404
    event = secure.get("/api/events/" + event_id, headers=headers("manager_1")).json()
    assert (event["user"], event["role"], event["action"]) == ("manager_1", "PORTFOLIO_MANAGER", "read")
    assert all(row["user"] == "analyst_42" for row in secure.get("/api/events", headers=headers("analyst_42")).json()["events"])
    assert secure.get("/api/stats", headers=headers("analyst_42")).status_code == 403
    assert secure.get("/api/stats", headers=headers("security_admin_1")).status_code == 200


def test_admin_auth_origin_limits_and_evidence(secure):
    assert secure.post("/api/redteam/run").status_code == 401
    assert secure.post("/api/redteam/run", headers=headers("analyst_42")).status_code == 403
    assert secure.post("/api/redteam/run", headers={**headers("security_admin_1"), "Origin": "http://127.0.0.1:18882"}).status_code == 403
    assert secure.app.state.redteam.results()["status"] == "not_run"
    result = secure.post("/api/redteam/run", json={}, headers={**headers("security_admin_1"), "Origin": "http://localhost:5173"})
    assert result.status_code == 200 and result.json()["passed"] == 16
    assert result.json()["policy_digest"]
    assert secure.post("/api/redteam/run", headers=headers("security_admin_1")).status_code == 429
    assert secure.app.state.gateway.list_events()[0]["category"] == "redteam_denied"


def test_approval_actor_denials_and_restart(secure):
    pending = secure.post("/api/security/evaluate", json=proposal(user=None, role=None, action="export"), headers=headers("manager_1")).json()
    path = "/api/approvals/" + pending["event_id"]
    assert secure.post(path, json={"approve": True}, headers=headers("analyst_42")).status_code == 403
    result = secure.post(path, json={"approve": True}, headers=headers("security_admin_1"))
    assert result.status_code == 200 and result.json()["executed"] is False
    gateway = secure.app.state.gateway
    event = gateway.list_events()[0]
    assert event["user"] == "manager_1" and event["actor"] == "security_admin_1"
    assert event["action"] == "export" and event["approval_id"] == pending["event_id"]
    restarted = Gateway(gateway.policies.path, gateway.store.path)
    assert restarted.resolve_approval(pending["event_id"], "security_admin_1", True)[0] == 409
    assert restarted.list_events()[0]["category"] == "approval_denied"


def test_policy_digest_interleaving_binds_original_snapshot(secure):
    gateway = secure.app.state.gateway
    original_record = gateway._record
    def interleave(*args):
        config = yaml.safe_load(gateway.policies.path.read_text())
        resource = config["resources"]["portfolio/current_positions"]
        resource.update(classification="PUBLIC", approval_actions=[])
        gateway.policies.path.write_text(yaml.safe_dump(config))
        gateway.policies.status()
        return original_record(*args)
    request = EvaluateRequest.model_validate_json(json.dumps(proposal(user="manager_1", role="PORTFOLIO_MANAGER", action="export")))
    before = gateway.policies.snapshot().digest
    with patch.object(gateway, "_record", side_effect=interleave):
        pending = gateway.evaluate(request)
    assert gateway.approvals[pending["event_id"]]["policy_digest"] == before
    assert gateway.resolve_approval(pending["event_id"], "security_admin_1", True)[0] == 409
    assert gateway.evaluate(request)["decision"] == "BLOCK"


def test_shared_quota_and_audit_across_workers_and_restart(secure):
    gateway = secure.app.state.gateway
    config = yaml.safe_load(gateway.policies.path.read_text())
    config["budgets"]["requests"] = 3
    gateway.policies.path.write_text(yaml.safe_dump(config))
    engines = [Gateway(gateway.policies.path, gateway.store.path) for _ in range(4)]
    request = EvaluateRequest.model_validate_json(json.dumps(proposal(user="manager_1", role="PORTFOLIO_MANAGER")))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda index: engines[index % 4].evaluate(request)["decision"], range(20)))
    assert results.count("ALLOW") == 3 and results.count("THROTTLE") == 17
    restarted = Gateway(gateway.policies.path, gateway.store.path)
    assert restarted.evaluate(request)["decision"] == "THROTTLE"
    assert restarted.stats()["total_events"] == 21


def test_store_failure_refuses_evaluation_without_output(secure):
    with patch("backend.state.sqlite3.connect", side_effect=sqlite3.OperationalError("synthetic private failure")):
        result = secure.post("/api/security/evaluate", json=proposal(user=None, role=None, output="synthetic confidential output"), headers=headers("manager_1"))
    assert result.status_code == 503
    assert "private failure" not in result.text and "confidential output" not in result.text


def test_json_and_response_bounds(secure):
    raw = json.dumps(proposal(user=None, role=None))[:-1] + ',"role":"PORTFOLIO_MANAGER"}'
    result = secure.post("/api/security/evaluate", content=raw, headers={**headers("manager_1"), "Content-Type": "application/json"})
    assert result.status_code == 422 and result.json()["decision"] == "BLOCK"
    assert secure.get("/api/events?limit=101", headers=headers("security_admin_1")).status_code == 422
    assert secure.get("/api/events", headers={**headers("security_admin_1"), "Host": "attacker.invalid"}).status_code == 400
    assert secure.get("/docs", headers=headers("security_admin_1")).status_code == 404


def test_redteam_does_not_hold_live_gateway_lock(secure):
    gateway = secure.app.state.gateway
    runner = RedteamRunner(gateway, ROOT / "redteam/corpus.json")
    original = Gateway.evaluate
    def evaluate(engine, request):
        with ThreadPoolExecutor(max_workers=1) as pool:
            # A separate thread must be able to inspect live state during each case.
            assert pool.submit(gateway.stats).result(timeout=2)["total_events"] >= 0
        return original(engine, request)
    with patch.object(Gateway, "evaluate", evaluate):
        assert runner.run()["passed"] == 16


def test_defaults_and_demo_boundary(tmp_path):
    app = create_app(profile="authenticated", auth_tokens=TOKENS)
    with TestClient(app, base_url="http://localhost") as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/events", headers=headers("security_admin_1")).status_code == 503
    app = create_app(profile="local-demo", auth_tokens=TOKENS)
    with TestClient(app, base_url="http://localhost", client=("203.0.113.1", 1234)) as client:
        assert client.get("/api/events").status_code == 403
    with pytest.raises(ValueError):
        create_app(profile="production")
    with pytest.raises(ValueError):
        create_app(auth_tokens={"manager_1": "short"})


def test_temporary_aws_key_redaction(secure):
    response = secure.post("/api/security/evaluate", json=proposal(user=None, role=None, output="ASIAABCDEFGHIJKLMNOP"), headers=headers("manager_1"))
    assert response.json()["sanitized_output"] == "[REDACTED]"


def test_bounded_encoded_credentials_and_ordinary_text():
    from backend.guards import redact_secrets
    encoded = base64.b64encode(b"password=synthetic-secret").decode()
    assert redact_secrets(encoded) == ("[REDACTED]", True)
    ordinary = base64.b64encode(b"ordinary synthetic text").decode()
    assert redact_secrets(ordinary) == (ordinary, False)
    assert redact_secrets("x" * 16000) == ("x" * 16000, False)


def test_approval_state_excludes_raw_content_and_secret_metadata(secure):
    body = proposal(user=None, role=None, action="export", prompt="SYNTHETIC_PRIVATE_PROMPT", source="SYNTHETIC_PRIVATE_SOURCE",
                    output="password=SYNTHETIC_PRIVATE_OUTPUT", model="sk-synthetic_model_secret_123456", request_id="sk-synthetic_request_secret_123456")
    result = secure.post("/api/security/evaluate", json=body, headers=headers("manager_1"))
    assert result.json()["decision"] == "REQUIRE_APPROVAL"
    with sqlite3.connect(secure.app.state.gateway.store.path) as db:
        state = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    for key in ("prompt", "source", "output", "model", "request_id"):
        assert body[key] not in state


def test_complex_json_refused_before_evaluation(secure):
    for nested in ([0] * 10001, {"a": 0}):
        if isinstance(nested, dict):
            for _ in range(34):
                nested = {"a": nested}
        result = secure.post("/api/security/evaluate", json=nested, headers=headers("manager_1"))
        assert result.status_code == 422 and result.json()["decision"] == "BLOCK"


def test_body_timeout_audited_without_evaluation(secure):
    from backend.body_limit import BodyLimitMiddleware
    async def run():
        async def downstream(*args):
            raise AssertionError("Timed-out request was evaluated")
        async def receive():
            raise TimeoutError
        messages = []
        async def send(message):
            messages.append(message)
        await BodyLimitMiddleware(downstream, secure.app.state.gateway)({"type": "http", "method": "POST", "path": "/api/security/evaluate", "headers": []}, receive, send)
        assert messages[0]["status"] == 408
    asyncio.run(run())
    assert secure.app.state.gateway.list_events()[0]["reason"] == "Request body timed out"


def test_duplicate_credentials_and_wildcard_origin_rejected(monkeypatch):
    from backend.security import parse_credentials, validate_origins
    with pytest.raises(ValueError):
        create_app(auth_tokens={"manager_1": "m" * 48, "analyst_42": "m" * 48})
    with pytest.raises(ValueError):
        parse_credentials('{"manager_1":"first","manager_1":"second"}')
    for value in ("http://*.example.com", "null", "https://example.com/path"):
        with pytest.raises(ValueError):
            validate_origins([value])
