"""Once-encoded configured credentials remain secret inside surrounding text."""
import base64
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.mark.parametrize("context", ["{}.", "Synthetic value: {}", "prefix_{}_suffix"])
@pytest.mark.parametrize("encoder", [base64.b64encode, base64.urlsafe_b64encode])
def test_encoded_credential_context_redacted_across_output_metadata_and_state(tmp_path, context, encoder):
    manager_token, admin_token = "M" * 48, "S" * 48
    encoded = encoder(context.format(admin_token).encode()).decode().rstrip("=")
    ordinary = encoder(b"ordinary synthetic text").decode().rstrip("=")
    app = create_app(profile="authenticated", auth_tokens={"manager_1": manager_token, "security_admin_1": admin_token}, state_path=tmp_path / "synthetic.sqlite3")
    headers = {"Authorization": "Bearer " + manager_token}
    body = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL"}
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post("/api/security/evaluate", headers=headers, json={**body, "request_id": encoded, "model": encoded, "output": "Encoded fixture: " + encoded})
        assert response.status_code == 200
        result = response.json()
        assert result["decision"] == "REDACT"
        assert result["sanitized_output"] == "Encoded fixture: [REDACTED]"
        event = client.get("/api/events/" + result["event_id"], headers=headers)
        assert event.status_code == 200 and event.json()["request_id"] == "[REDACTED]"
        feed = client.get("/api/events", headers=headers)
        assert encoded not in response.text + event.text + feed.text
        for action, extra, expected in [("export", {}, "REQUIRE_APPROVAL"), ("read", {"destination": "EXTERNAL"}, "BLOCK"), ("read", {"estimated_tokens": 1000000}, "THROTTLE")]:
            refused = client.post("/api/security/evaluate", headers=headers, json={**body, "action": action, "request_id": encoded, "output": encoded, **extra})
            assert refused.json()["decision"] == expected
            assert "sanitized_output" not in refused.json() and encoded not in refused.text
            retained = client.get("/api/events/" + refused.json()["event_id"], headers=headers)
            assert encoded not in retained.text and retained.json()["request_id"] == "[REDACTED]"
        positive = client.post("/api/security/evaluate", headers=headers, json={**body, "output": ordinary}).json()
        assert positive["decision"] == "ALLOW" and positive["sanitized_output"] == ordinary
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        raw = db.execute("SELECT body FROM gateway_state").fetchone()[0]
    assert encoded not in raw and admin_token not in raw and manager_token not in raw


@pytest.mark.parametrize("repetitions", [128, 1320], ids=["larger_than_old_decoder", "near_api_text_limit"])
def test_large_once_encoded_credential_container_is_masked_with_benign_control(tmp_path, repetitions):
    token = "S" * 48
    prefix = "Surrounding prose: " + "ordinary " * repetitions
    encoded = base64.urlsafe_b64encode((prefix + token + ".").encode()).decode()
    benign = base64.urlsafe_b64encode((prefix + "ordinary example text.").encode()).decode()
    assert 1024 < len(encoded) <= 16000 and len(benign) <= 16000
    app = create_app(profile="authenticated", auth_tokens={"manager_1": token}, state_path=tmp_path / "large.sqlite3")
    body = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL"}
    headers = {"Authorization": "Bearer " + token}
    with TestClient(app, base_url="http://localhost") as client:
        result = client.post("/api/security/evaluate", headers=headers, json={**body, "output": encoded}).json()
        assert result["decision"] == "REDACT" and result["sanitized_output"] == "[REDACTED]"
        assert encoded not in client.get("/api/events", headers=headers).text
        positive = client.post("/api/security/evaluate", headers=headers, json={**body, "output": benign}).json()
        assert positive["decision"] == "ALLOW" and positive["sanitized_output"] == benign
    with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
        assert encoded not in db.execute("SELECT body FROM gateway_state").fetchone()[0]
