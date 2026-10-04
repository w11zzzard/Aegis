"""Specific corrupt-data refusal, compatibility, and no programming-error suppression."""
import json
import sqlite3
from contextlib import closing
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.admission import empty_state
from backend.main import ROOT, create_app
from backend.models import EvaluateRequest


TOKEN = "m" * 48
HEADERS = {"Authorization": "Bearer " + TOKEN}
PROPOSAL = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL"}
ERROR = {"detail": "Security state unavailable; request refused"}


@pytest.fixture
def state_app(tmp_path):
    app = create_app(profile="authenticated", auth_tokens={"manager_1": TOKEN}, state_path=tmp_path / "state.sqlite3")
    return app


def replace(app, table, raw):
    assert table in {"gateway_state", "security_controls"}
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        with db:
            db.execute(f"INSERT INTO {table} VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", (raw,))


def stored(app, table):
    assert table in {"gateway_state", "security_controls"}
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        return db.execute(f"SELECT body FROM {table} WHERE id=1").fetchone()[0]


@pytest.mark.parametrize("raw", ["{}", "[]", "null", '{"events":[],"events":[]}', "{bad-json}", '{"private":"SYNTHETIC_PRIVATE_STATE"}'])
@pytest.mark.parametrize("table", ["gateway_state", "security_controls"])
def test_corrupt_stored_shape_refuses_and_preserves_raw_bytes(state_app, table, raw):
    replace(state_app, table, raw)
    with TestClient(state_app, base_url="http://localhost") as client:
        response = client.post("/api/security/evaluate", headers=HEADERS, json={**PROPOSAL, "output": "SYNTHETIC_PRIVATE_OUTPUT"})
    assert response.status_code == 503
    assert response.json() == ERROR
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "SYNTHETIC_PRIVATE" not in response.text
    assert stored(state_app, table) == raw


def malformed_controls():
    invalid = []
    for field, value in [
        ("windows", {"evil-header-key": [1, 1]}),
        ("windows", {"principal:" + "x" * 129: [1, 1]}),
        ("windows", {"principal:user" + str(i): [1, 1] for i in range(1003)}),
        ("windows", {"untrusted": [float("nan"), 0]}),
        ("windows", {"authenticated": [1, 1201]}),
        ("sample_window", -1), ("sample_count", 17),
        ("admission_denied", -1), ("admission_denied", True),
        ("dropped_samples", 1 << 63),
        ("rejections", {"body-selected-reason": 1}),
        ("decisions", {"FAKE_ALLOW": 1}),
        ("samples", [{}] * 257),
    ]:
        state = empty_state()
        state[field] = value
        invalid.append(state)
    return invalid


@pytest.mark.parametrize("state", malformed_controls())
def test_corrupt_control_values_refuse_without_reset(state_app, state):
    raw = json.dumps(state)
    replace(state_app, "security_controls", raw)
    with TestClient(state_app, base_url="http://localhost") as client:
        response = client.get("/api/events", headers=HEADERS)
    assert response.status_code == 503 and response.json() == ERROR
    assert stored(state_app, "security_controls") == raw


@pytest.mark.parametrize("corrupt", [
    lambda state: state.update(counts={"ALLOW": -1}),
    lambda state: state.update(counts={"EVIL": 1}),
    lambda state: state.update(usage={"manager_1": [[1, -1]]}),
    lambda state: state.update(usage={"manager_1": [[1, True]]}),
    lambda state: state.update(approvals={"broken": {"request": {"role": "SYNTHETIC_PRIVATE_ROLE"}}}),
    lambda state: state.update(redteam_last=None),
    lambda state: state.update(schema_version=3),
    lambda state: state["events"][0].update(latency_ms=float("inf")),
    lambda state: state["events"][0].update(output="SYNTHETIC_PRIVATE_OUTPUT"),
])
def test_corrupt_gateway_values_refuse_without_reset(state_app, corrupt):
    gateway = state_app.state.gateway
    gateway.evaluate(EvaluateRequest(**PROPOSAL, user="manager_1", role="PORTFOLIO_MANAGER"))
    state = json.loads(stored(state_app, "gateway_state"))
    corrupt(state)
    raw = json.dumps(state)
    replace(state_app, "gateway_state", raw)
    with TestClient(state_app, base_url="http://localhost") as client:
        response = client.post("/api/security/evaluate", headers=HEADERS, json=PROPOSAL)
    assert response.status_code == 503 and response.json() == ERROR
    assert stored(state_app, "gateway_state") == raw


def test_legacy_valid_shape_remains_readable_and_preserved(state_app):
    gateway = state_app.state.gateway
    event = gateway.evaluate(EvaluateRequest(**PROPOSAL, user="manager_1", role="PORTFOLIO_MANAGER"))
    state = json.loads(stored(state_app, "gateway_state"))
    for field in ("schema_version", "legacy_preserved", "admin_last_run", "redteam_last"):
        state.pop(field, None)
    state["events"][0].pop("evidence_class", None)
    before = deepcopy(state["events"])
    replace(state_app, "gateway_state", json.dumps(state))
    with TestClient(state_app, base_url="http://localhost") as client:
        response = client.get("/api/events/" + event["event_id"], headers=HEADERS)
    assert response.status_code == 200
    after = json.loads(stored(state_app, "gateway_state"))["events"]
    assert all(after[0].get(key) == value for key, value in before[0].items())


def test_programming_errors_are_not_disguised_as_storage_failures(state_app, monkeypatch):
    def broken(*_args):
        raise KeyError("Synthetic programming error")
    monkeypatch.setattr(state_app.state.gateway, "decide", broken)
    with TestClient(state_app, base_url="http://localhost") as client:
        with pytest.raises(KeyError, match="Synthetic programming error"):
            client.post("/api/security/evaluate", headers=HEADERS, json=PROPOSAL)
