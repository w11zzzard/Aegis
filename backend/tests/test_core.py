from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import ROOT, create_app


@pytest.fixture
def client(tmp_path):
    policy = tmp_path / "policy.yaml"
    policy.write_bytes((ROOT / "policies/default.yaml").read_bytes())
    with TestClient(create_app(policy)) as client:
        yield client


def proposal(**updates):
    return {
        "user": "analyst_42", "role": "ANALYST", "action": "read",
        "resource": "portfolio/current_positions", "classification": "RESTRICTED",
        "destination": "INTERNAL", **updates,
    }


def test_first_vertical_slice(client):
    result = client.post("/api/security/evaluate", json=proposal(prompt="confidential content")).json()
    assert result["decision"] == "BLOCK"
    assert result["policy"] == "portfolio_restricted"
    assert result["latency_ms"] >= 0
    event = client.get(f'/api/events/{result["event_id"]}').json()
    assert event["decision"] == "BLOCK"
    assert "confidential content" not in str(event)
    assert client.get("/api/events").json()["events"][0]["id"] == result["event_id"]


def test_manager_allowed(client):
    result = client.post("/api/security/evaluate", json=proposal(user="manager_1", role="PORTFOLIO_MANAGER")).json()
    assert result["decision"] == "ALLOW"


def test_restricted_external_blocked(client):
    result = client.post("/api/security/evaluate", json=proposal(user="manager_1", role="PORTFOLIO_MANAGER", destination="EXTERNAL")).json()
    assert result["decision"] == "BLOCK"


@pytest.mark.parametrize("change", [
    {"role": "PORTFOLIO_MANAGER"}, {"user": "unknown"}, {"user": None},
    {"classification": None}, {"classification": "PUBLIC"}, {"resource": "missing"},
    {"user": "security_admin_1", "role": "SECURITY_ADMIN"},
])
def test_fail_closed(client, change):
    assert client.post("/api/security/evaluate", json=proposal(**change)).json()["decision"] == "BLOCK"


def test_validation_does_not_leak(client):
    result = client.post("/api/security/evaluate", json=proposal(role="password=supersecret"))
    assert result.status_code == 422
    assert result.json()["decision"] == "BLOCK"
    assert "supersecret" not in result.text
    assert "supersecret" not in client.get("/api/events").text
