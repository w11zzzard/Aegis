"""CP1 gaps: quota reloads, reviewed approval context, and inert proposals."""
import json
from copy import deepcopy
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from backend.core import Gateway
from backend.main import ROOT, create_app
from backend.models import EvaluateRequest


TOKENS = {"manager_1": "m" * 48, "security_admin_1": "s" * 48}
PROPOSAL = {
    "action": "read", "resource": "portfolio/current_positions",
    "classification": "RESTRICTED", "destination": "INTERNAL",
}


def headers(user="manager_1"):
    return {"Authorization": "Bearer " + TOKENS[user]}


@pytest.fixture
def secured(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_bytes((ROOT / "policies/default.yaml").read_bytes())
    app = create_app(policy, profile="authenticated", auth_tokens=TOKENS, state_path=tmp_path / "state.sqlite3")
    with TestClient(app, base_url="http://localhost") as client:
        yield client


@pytest.mark.parametrize("lower", [{"requests": 1}, {"tokens": 15}], ids=["requests", "character_units"])
def test_lowered_budget_preserves_consumed_usage_after_reload_and_restart(secured, lower):
    for _ in range(2):
        result = secured.post("/api/security/evaluate", headers=headers(), json={**PROPOSAL, "estimated_tokens": 8})
        assert result.json()["decision"] == "ALLOW"
    gateway = secured.app.state.gateway
    config = yaml.safe_load(gateway.policies.path.read_text())
    config["budgets"].update(lower)
    gateway.policies.path.write_text(yaml.safe_dump(config))
    blocked = secured.post("/api/security/evaluate", headers=headers(), json={**PROPOSAL, "output": "pwd=x"}).json()
    assert blocked["decision"] == "THROTTLE" and "sanitized_output" not in blocked
    budget = secured.get("/api/stats", headers=headers("security_admin_1")).json()["budgets"]
    assert budget["requests_used"] == 2 and budget["tokens_used"] == 16
    restarted = Gateway(gateway.policies.path, gateway.store.path)
    request = EvaluateRequest(**PROPOSAL, user="manager_1", role="PORTFOLIO_MANAGER", output="pwd=x")
    assert restarted.evaluate(request)["decision"] == "THROTTLE"
    assert restarted.stats()["budgets"]["tokens_used"] == 16


@pytest.mark.parametrize("mutate", [
    {"resource": "public/market_summary"}, {"destination": "EXTERNAL"},
    {"user": "security_admin_1"},
    {"tool_arguments": {"resource": "portfolio/current_positions", "destination": "EXTERNAL"}},
], ids=["resource", "destination", "identity", "tool_arguments"])
def test_approval_resolution_cannot_mutate_the_reviewed_proposal(secured, mutate):
    body = {
        **PROPOSAL, "action": "export", "tool": "export_resource",
        "tool_arguments": {"resource": PROPOSAL["resource"], "destination": "INTERNAL"},
        "output": "password=SYNTHETIC_PENDING_OUTPUT",
    }
    pending = secured.post("/api/security/evaluate", headers=headers(), json=body).json()
    assert pending["decision"] == "REQUIRE_APPROVAL" and "sanitized_output" not in pending
    gateway = secured.app.state.gateway
    reviewed = deepcopy(gateway.approvals[pending["event_id"]]["request"].model_dump(mode="json"))
    path = "/api/approvals/" + pending["event_id"]
    malformed = secured.post(path, headers=headers("security_admin_1"), json={"approve": True, **mutate})
    assert malformed.status_code == 422 and malformed.json()["decision"] == "BLOCK"
    with gateway.transaction():
        assert gateway.approvals[pending["event_id"]]["status"] == "pending"
        assert gateway.approvals[pending["event_id"]]["request"].model_dump(mode="json") == reviewed
    resolved = secured.post(path, headers=headers("security_admin_1"), json={"approve": True})
    assert resolved.status_code == 200 and resolved.json()["executed"] is False
    event = gateway.list_events()[0]
    assert event["resource"] == PROPOSAL["resource"] and event["destination"] == "INTERNAL"
    assert event["user"] == "manager_1" and event["actor"] == "security_admin_1"
    assert event["approval_id"] == pending["event_id"]
    assert "SYNTHETIC_PENDING_OUTPUT" not in json.dumps(gateway.list_events())
    # Recording approval is never an execution grant for another evaluation.
    assert secured.post("/api/security/evaluate", headers=headers(), json=body).json()["decision"] == "REQUIRE_APPROVAL"


@pytest.mark.parametrize("tool,args", [
    ("shell", {"command": "INERT_TOOL_SENTINEL"}),
    ("http_post", {"url": "http://127.0.0.1:9/INERT_DOWNSTREAM_SENTINEL"}),
    ("read_resource", {"resource": {"nested": "portfolio/current_positions"}, "destination": "INTERNAL"}),
    ("read_resource", {"resource": "portfolio/current_positions", "destination": "INTERNAL", "nested": {"url": "INERT_DOWNSTREAM_SENTINEL"}}),
], ids=["shell", "http", "nested_resource", "extra_nested_argument"])
def test_structurally_valid_proposals_reach_tool_guard_without_downstream_execution(secured, tmp_path, tool, args):
    sentinel = tmp_path / "INERT_TOOL_SENTINEL"
    with patch("subprocess.run", side_effect=AssertionError("Proposed tool executed")), \
         patch("subprocess.Popen", side_effect=AssertionError("Proposed process executed")), \
         patch("os.system", side_effect=AssertionError("Proposed shell executed")), \
         patch("socket.create_connection", side_effect=AssertionError("Proposed target contacted")):
        response = secured.post(
            "/api/security/evaluate", headers=headers(),
            json={**PROPOSAL, "tool": tool, "tool_arguments": args, "output": "password=SYNTHETIC_DENIED_OUTPUT"},
        )
    assert response.status_code == 200
    result = response.json()
    assert result["decision"] == "BLOCK" and result["policy"] == "tool_guard"
    assert "sanitized_output" not in result and "SYNTHETIC_DENIED_OUTPUT" not in response.text
    event = secured.get("/api/events/" + result["event_id"], headers=headers()).json()
    assert event["decision"] == "BLOCK" and event["policy"] == "tool_guard"
    assert "INERT_" not in json.dumps(event) and not sentinel.exists()
