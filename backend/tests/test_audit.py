"""Wire regressions for safe attempted-action and nullable audit metadata."""

import pytest

from backend.tests.test_core import client, proposal


METADATA = ("request_id", "user", "role", "action", "resource", "classification", "destination")
FORBIDDEN_FIELDS = {"prompt", "source", "output", "sanitized_output", "tool", "tool_arguments"}


@pytest.mark.parametrize("action,decision", [("read", "REDACT"), ("export", "REQUIRE_APPROVAL")])
def test_valid_attempted_action_in_listing_and_detail(client, action, decision):
    response = client.post("/api/security/evaluate", json=proposal(
        user="manager_1", role="PORTFOLIO_MANAGER", action=action,
        prompt="private prompt fixture", source="restricted source fixture",
        output="password=synthetic-secret",
    ))
    result = response.json()
    # Read output is inspected; approval responses do not return output at all.
    assert result["decision"] == decision
    assert response.status_code == 200
    assert result["latency_ms"] >= 0
    event = client.get(f'/api/events/{result["event_id"]}').json()
    assert event["id"] == result["event_id"]
    assert event["action"] == action
    assert event["latency_ms"] == result["latency_ms"]
    assert event["request_id"] is None
    assert event["decision"] == result["decision"]
    assert not (FORBIDDEN_FIELDS & event.keys())
    assert "synthetic-secret" not in str(event)
    assert client.get("/api/events").json()["events"][0] == event


@pytest.mark.parametrize("update", [
    {"action": "execute"}, {"action": {"password": "synthetic-secret"}},
    {"action": 1}, {"action": "read" * 1000},
    {"action": "read", "role": "password=synthetic-secret"},
])
def test_malformed_requests_do_not_guess_audit_context(client, update):
    response = client.post("/api/security/evaluate", json=proposal(**update))
    assert response.status_code == 422
    result = response.json()
    assert (result["decision"], result["policy"]) == ("BLOCK", "fail_closed")
    event = client.get(f'/api/events/{result["event_id"]}').json()
    assert all(event[key] is None for key in METADATA)
    assert not (FORBIDDEN_FIELDS & event.keys())
    assert "synthetic-secret" not in response.text
    assert "synthetic-secret" not in str(event)


def test_missing_action_and_oversized_body_audited_as_null(client):
    payload = proposal()
    del payload["action"]
    response = client.post("/api/security/evaluate", json=payload)
    assert response.status_code == 200
    assert response.json()["decision"] == "BLOCK"
    event = client.get(f'/api/events/{response.json()["event_id"]}').json()
    assert event["action"] is None
    response = client.post("/api/security/evaluate", content=b'{"action":"read","padding":"' + b"a" * 65536 + b'"}')
    assert response.status_code == 413
    event = client.get(f'/api/events/{response.json()["event_id"]}').json()
    assert all(event[key] is None for key in METADATA)


def test_mixed_nullable_events_remain_retrievable(client):
    for payload in (proposal(), proposal(user="unknown"), proposal(action="execute")):
        result = client.post("/api/security/evaluate", json=payload).json()
        assert client.get(f'/api/events/{result["event_id"]}').status_code == 200
    events = client.get("/api/events").json()["events"]
    assert [event["action"] for event in events] == [None, "read", "read"]
    assert [event["user"] for event in events] == [None, None, "analyst_42"]
    assert all(event["request_id"] is None for event in events)


def test_approval_resolution_preserves_original_attempted_action(client):
    pending = client.post("/api/security/evaluate", json=proposal(
        user="manager_1", role="PORTFOLIO_MANAGER", action="export",
    )).json()
    result = client.post(f'/api/approvals/{pending["event_id"]}', json={"approve": True},
                         headers={"Authorization": "Bearer " + "a" * 48})
    assert result.status_code == 200
    assert result.json()["executed"] is False
    event = client.get("/api/events").json()["events"][0]
    assert (event["action"], event["policy"]) == ("export", "approval_resolution")


def test_empty_stats_does_not_invent_measurements(client):
    stats = client.get("/api/stats").json()
    assert stats["total_events"] == stats["retained_events"] == 0
    assert stats["latency_ms"] == {"samples": 0, "mean": None, "max": None}
    assert stats["redteam"]["status"] == "not_run"
    assert stats["budgets"]["accounting"] == "conservative_character_units"
