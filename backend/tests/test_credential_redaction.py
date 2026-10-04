"""Configured service credentials never become audit metadata or output."""
import sqlite3
import hashlib
import base64
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.guards import CredentialRedactor


@pytest.mark.parametrize("length", [32, 48, 128, 256])
def test_known_service_credential_masked_in_output_audit_and_state(tmp_path, length):
    manager_token, admin_token = "m" * length, "s" * length
    app = create_app(profile="authenticated", auth_tokens={"manager_1": manager_token, "security_admin_1": admin_token}, state_path=tmp_path / "synthetic.sqlite3")
    with TestClient(app, base_url="http://localhost") as client:
        body = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL", "request_id": manager_token if length <= 128 else "synthetic-id", "output": "Synthetic value: " + manager_token}
        response = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + manager_token}, json=body)
        result = response.json()
        assert result["decision"] == "REDACT"
        assert manager_token not in response.text
        assert "[REDACTED]" in result["sanitized_output"]
        for token in (manager_token, admin_token):
            event = client.get("/api/events/" + result["event_id"], headers={"Authorization": "Bearer " + token})
            assert event.status_code == 200
            assert event.json()["request_id"] == ("[REDACTED]" if length <= 128 else "synthetic-id")
            assert manager_token not in event.text
        # An unrelated opaque identifier must retain its correlation value.
        ordinary = "u" * 48
        result = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + manager_token}, json={**body, "request_id": ordinary, "output": ordinary}).json()
        assert result["decision"] == "ALLOW" and result["sanitized_output"] == ordinary
        assert client.get("/api/events/" + result["event_id"], headers={"Authorization": "Bearer " + manager_token}).json()["request_id"] == ordinary
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        raw = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    assert manager_token not in raw and admin_token not in raw


@pytest.mark.parametrize("prefix,suffix", [("prefix_", "_suffix"), ("/metadata/", ":correlation"), ("", "")])
def test_embedded_opaque_service_credential_masked_without_body_retention(tmp_path, prefix, suffix):
    token = "m" * 48
    app = create_app(profile="authenticated", auth_tokens={"manager_1": token}, state_path=tmp_path / "synthetic.sqlite3")
    marker = prefix + token + suffix
    with TestClient(app, base_url="http://localhost") as client:
        body = {"action": "export", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL", "request_id": marker, "model": marker, "prompt": "SYNTHETIC_PRIVATE_PROMPT " + marker, "source": "SYNTHETIC_PRIVATE_SOURCE " + marker, "output": marker}
        pending = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + token}, json=body).json()
        assert pending["decision"] == "REQUIRE_APPROVAL" and "sanitized_output" not in pending
        audit = client.get("/api/events/" + pending["event_id"], headers={"Authorization": "Bearer " + token})
        assert token not in audit.text and "[REDACTED]" in audit.text
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        raw = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    assert token not in raw
    assert "SYNTHETIC_PRIVATE_PROMPT" not in raw and "SYNTHETIC_PRIVATE_SOURCE" not in raw


def test_unrelated_opaque_pending_tool_arguments_are_minimal_and_bounded(tmp_path):
    token = "m" * 48
    app = create_app(profile="authenticated", auth_tokens={"manager_1": token}, state_path=tmp_path / "synthetic.sqlite3")
    with TestClient(app, base_url="http://localhost") as client:
        body = {"action": "export", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL", "tool": "export_resource", "tool_arguments": {"resource": "portfolio/current_positions", "destination": "INTERNAL"}}
        pending = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + token}, json=body).json()
        assert pending["decision"] == "REQUIRE_APPROVAL"
        blocked = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + token}, json={**body, "tool_arguments": {**body["tool_arguments"], "password": token}}).json()
        assert blocked["decision"] == "BLOCK"
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        raw = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    assert token not in raw


def test_known_credential_comparison_budget_conservatively_masks_and_stops(monkeypatch):
    # Three configured lengths force the ordinary 16KiB opaque run beyond the
    # bounded search budget. No known token is present, so full masking is the
    # documented conservative fallback rather than an incomplete scan.
    tokens = ("a" * 32, "b" * 33, "c" * 34)
    redactor = CredentialRedactor({hashlib.sha256(token.encode()).digest(): len(token) for token in tokens})
    original_sha256 = hashlib.sha256
    calls = 0

    def counted_sha256(value):
        nonlocal calls
        calls += 1
        return original_sha256(value)

    monkeypatch.setattr("backend.guards.hashlib.sha256", counted_sha256)
    assert redactor.redact("u" * 16000) == ("[REDACTED]", True)
    assert calls == CredentialRedactor.MAX_COMPARISONS


def test_once_encoded_known_opaque_credential_is_masked_but_ordinary_base64_survives(tmp_path):
    token = "m" * 48
    encoded = base64.urlsafe_b64encode(token.encode()).decode()
    ordinary = base64.urlsafe_b64encode(b"ordinary synthetic text").decode()
    app = create_app(profile="authenticated", auth_tokens={"manager_1": token}, state_path=tmp_path / "synthetic.sqlite3")
    headers = {"Authorization": "Bearer " + token}
    body = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL"}
    with TestClient(app, base_url="http://localhost") as client:
        result = client.post("/api/security/evaluate", headers=headers, json={**body, "request_id": encoded, "output": encoded}).json()
        assert result["decision"] == "REDACT" and result["sanitized_output"] == "[REDACTED]"
        event = client.get("/api/events/" + result["event_id"], headers=headers)
        assert event.json()["request_id"] == "[REDACTED]" and encoded not in event.text
        allowed = client.post("/api/security/evaluate", headers=headers, json={**body, "output": ordinary}).json()
        assert allowed["decision"] == "ALLOW" and allowed["sanitized_output"] == ordinary
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        raw = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    assert token not in raw and encoded not in raw
