"""Regressions for separate trusted evidence and shared bounded admission."""

import json
import sqlite3
from time import perf_counter
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.core import Gateway
from backend.main import ROOT, create_app
from backend.models import Decision, EvaluateRequest
from backend.tests.test_core import proposal
from backend.tests.test_security_fixes import TOKENS, headers


def test_untrusted_flood_preserves_owner_admin_worker_and_restart(tmp_path):
    path = tmp_path / "shared.sqlite3"
    apps = [create_app(profile="authenticated", auth_tokens=TOKENS, state_path=path) for _ in range(2)]
    with TestClient(apps[0], base_url="http://localhost") as owner, TestClient(apps[1], base_url="http://localhost") as other:
        event = owner.post("/api/security/evaluate", json=proposal(user=None, role=None), headers=headers("manager_1")).json()
        statuses = []
        for index in range(2050):
            client = owner if index % 2 else other
            statuses.append(client.post("/api/security/evaluate", content=b'{"role":"SECURITY_ADMIN"}',
                headers={"X-Forwarded-For": f"203.0.{index // 256}.{index % 256}"}).status_code)
        assert 429 in statuses
        for client in (owner, other):
            for user in ("manager_1", "security_admin_1"):
                assert client.get("/api/events/" + event["event_id"], headers=headers(user)).status_code == 200
            assert client.get("/api/events/" + event["event_id"], headers=headers("analyst_42")).status_code == 404
        gateway = apps[0].state.gateway
        stats = gateway.stats()
        assert stats["retention"]["protected_retained"] == 1
        assert stats["retention"]["rejection_retained"] <= 256
        assert stats["abuse"]["admission_denied"] > 0
        assert stats["abuse"]["dropped_samples"] > 0
    restarted = create_app(profile="authenticated", auth_tokens=TOKENS, state_path=path)
    with TestClient(restarted, base_url="http://localhost") as client:
        assert client.get("/api/events/" + event["event_id"], headers=headers("manager_1")).status_code == 200
        assert client.get("/api/events/" + event["event_id"], headers=headers("security_admin_1")).status_code == 200


def test_atomic_principal_global_limits_and_clock_rollback(tmp_path):
    engines = [Gateway(ROOT / "policies/default.yaml", tmp_path / "shared.sqlite3") for _ in range(4)]
    for engine in engines:
        engine.controls.clock = lambda: 100.0
    with ThreadPoolExecutor(max_workers=8) as pool:
        admitted = list(pool.map(lambda index: engines[index % 4].controls.admit("manager_1"), range(200)))
    assert sum(admitted) == 120
    restarted = Gateway(ROOT / "policies/default.yaml", tmp_path / "shared.sqlite3")
    restarted.controls.clock = lambda: 100.0
    assert not restarted.controls.admit("manager_1")
    assert engines[0].controls.admit("analyst_42")
    for engine in engines:
        engine.controls.clock = lambda: 99.0
    assert not engines[0].controls.admit("manager_1")
    for engine in engines:
        engine.controls.clock = lambda: 110.0
    assert engines[1].controls.admit("manager_1")
    # Distributed source addresses cannot bypass a fixed global untrusted bucket.
    assert sum(engines[index % 4].controls.admit(None) for index in range(200)) == 120
    assert engines[0].controls.stats()["limiter_keys"] <= 1002


def test_global_authenticated_capacity_key_cap_and_bounded_samples(tmp_path):
    gateway = Gateway(ROOT / "policies/default.yaml", tmp_path / "shared.sqlite3")
    gateway.controls.clock = lambda: 10.0
    # These names are supplied internally, never accepted from HTTP claims.
    assert all(gateway.controls.admit("principal_" + str(index)) for index in range(1000))
    assert gateway.controls.admit(None)
    assert not gateway.controls.admit("principal_1000")
    assert gateway.controls.stats()["limiter_keys"] == 1002
    # Existing principals are still subject to the shared global quota.
    assert sum(gateway.controls.admit("principal_" + str(index % 1000)) for index in range(250)) == 200
    for window in range(18):
        gateway.controls.clock = lambda window=window: 20.0 + window * 10
        for _ in range(16):
            gateway.record(EvaluateRequest(), Decision.BLOCK, "fail_closed", "Synthetic sample", perf_counter())
    assert gateway.controls.stats()["retained_samples"] == 256
    assert gateway.controls.stats()["dropped_samples"] >= 32


def test_demo_body_claims_cannot_select_protected_retention(tmp_path):
    app = create_app(profile="local-demo", auth_tokens=TOKENS, state_path=tmp_path / "state.sqlite3")
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 1)) as client:
        response = client.post("/api/security/evaluate", json=proposal(user="manager_1", role="PORTFOLIO_MANAGER"))
        assert response.json()["decision"] == "ALLOW"
        event = client.get("/api/events/" + response.json()["event_id"]).json()
        assert event["evidence_class"] == "rejection"
        assert app.state.gateway.stats()["retention"]["protected_retained"] == 0


def test_usage_keys_expire_without_erasing_live_reservations(tmp_path):
    gateway = Gateway(ROOT / "policies/default.yaml")
    gateway.usage.update({"retired_" + str(index): deque([(100.0, 1)]) for index in range(1000)})
    request = EvaluateRequest.model_validate(proposal(user="manager_1", role="PORTFOLIO_MANAGER"))
    with patch.object(gateway, "now", return_value=100.0):
        assert not gateway.consume_budget(request, gateway.snapshot().config)
    with patch.object(gateway, "now", return_value=160.0):
        assert gateway.consume_budget(request, gateway.snapshot().config)
    assert set(gateway.usage) == {"manager_1"}


def test_all_evaluated_decisions_and_approval_evidence_protected(tmp_path):
    app = create_app(profile="authenticated", auth_tokens=TOKENS, state_path=tmp_path / "shared.sqlite3")
    gateway = app.state.gateway
    with TestClient(app, base_url="http://localhost") as client:
        blocked = client.post("/api/security/evaluate", json=proposal(user=None, role=None), headers=headers("analyst_42")).json()
        pending = client.post("/api/security/evaluate", json=proposal(user=None, role=None, action="export"), headers=headers("manager_1")).json()
        assert client.post("/api/approvals/" + pending["event_id"], json={"approve": False}, headers=headers("security_admin_1")).status_code == 200
    request = EvaluateRequest.model_validate(proposal(user="manager_1", role="PORTFOLIO_MANAGER"))
    with patch.object(gateway, "consume_budget", return_value=False):
        throttled = gateway.evaluate(request)
    for index in range(2100):
        gateway.record(request, Decision.ALLOW, "caller_chosen", "Synthetic low trust", perf_counter())
    assert gateway.find_event(blocked["event_id"])["decision"] == "BLOCK"
    assert gateway.find_event(throttled["event_id"])["decision"] == "THROTTLE"
    assert any(event["category"] == "approval_resolution" for event in gateway.list_events(2256))
    assert gateway.stats()["retention"]["protected_retained"] == 4


def test_legacy_state_migrates_without_reclassifying_or_losing_evidence(tmp_path):
    path = tmp_path / "state.sqlite3"
    engine = Gateway(ROOT / "policies/default.yaml", path)
    event = engine.evaluate(EvaluateRequest.model_validate(proposal()))
    with sqlite3.connect(path) as db:
        state = json.loads(db.execute("SELECT body FROM gateway_state").fetchone()[0])
        state.pop("schema_version", None)
        state.pop("legacy_preserved", None)
        db.execute("UPDATE gateway_state SET body=?", (json.dumps(state),))
    restart = Gateway(ROOT / "policies/default.yaml", path)
    assert restart.find_event(event["event_id"])
    assert restart.stats()["retention"]["legacy_preserved"] >= 1
