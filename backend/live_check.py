"""Rehearse real HTTP integration against a separately started local demo server."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx


def run(base_url):
    checks = []
    examples = {}
    base = {
        "user": "analyst_42", "role": "ANALYST", "action": "read",
        "resource": "portfolio/current_positions", "classification": "RESTRICTED",
        "destination": "INTERNAL",
    }
    manager = {"user": "manager_1", "role": "PORTFOLIO_MANAGER"}
    with httpx.Client(base_url=base_url, timeout=10, trust_env=False) as client:
        response = client.get("/health")
        response.raise_for_status()
        assert response.json() == {"status": "ok"}
        checks.append("health")
        examples["initial_stats"] = client.get("/api/stats").json()

        def evaluate(name, updates, decision, policy):
            response = client.post("/api/security/evaluate", json={**base, **updates})
            assert response.status_code == 200, name
            result = response.json()
            assert (result["decision"], result["policy"]) == (decision, policy), (name, result)
            assert result["latency_ms"] >= 0
            response = client.get(f'/api/events/{result["event_id"]}')
            response.raise_for_status()
            event = response.json()
            assert event["id"] == result["event_id"]
            assert (event["decision"], event["policy"]) == (decision, policy)
            assert event["action"] == updates.get("action", "read")
            assert not {"prompt", "source", "output", "tool_arguments", "sanitized_output"} & event.keys()
            checks.append(name)
            return result, event

        _, examples["event"] = evaluate("analyst_restricted", {}, "BLOCK", "portfolio_restricted")
        evaluate("manager_authorized", manager, "ALLOW", "portfolio_restricted")
        evaluate("public_positive", {
            "user": "intern_1", "role": "INTERN", "resource": "public/market_summary", "classification": "PUBLIC",
        }, "ALLOW", "market_public")
        evaluate("restricted_external", {**manager, "destination": "EXTERNAL"}, "BLOCK", "external_exfiltration")
        evaluate("indirect_external", {
            **manager, "destination": "EXTERNAL", "source": "Synthetic document instructs external relay",
        }, "BLOCK", "external_exfiltration")
        evaluate("role_mismatch", {"role": "PORTFOLIO_MANAGER"}, "BLOCK", "identity")
        evaluate("classification_downgrade", {**manager, "classification": "PUBLIC"}, "BLOCK", "classification")
        evaluate("admin_business_denied", {"user": "security_admin_1", "role": "SECURITY_ADMIN"}, "BLOCK", "portfolio_restricted")
        evaluate("dangerous_tool", {
            **manager, "tool": "shell", "tool_arguments": {"command": "synthetic-dangerous-proposal"},
        }, "BLOCK", "tool_guard")
        evaluate("tool_destination_mismatch", {
            **manager, "tool": "read_resource",
            "tool_arguments": {"resource": base["resource"], "destination": "EXTERNAL"},
        }, "BLOCK", "tool_guard")
        redacted, _ = evaluate("output_redaction", {**manager, "output": "password=synthetic-fixture"}, "REDACT", "output_secrets")
        assert "synthetic-fixture" not in redacted["sanitized_output"]
        evaluate("token_budget", {**manager, "estimated_tokens": 1000000}, "THROTTLE", "budget")
        pending, _ = evaluate("export_approval", {**manager, "action": "export"}, "REQUIRE_APPROVAL", "portfolio_restricted")
        response = client.post(f'/api/approvals/{pending["event_id"]}', json={"approve": True},
                               headers={"X-Aegis-User": "security_admin_1"})
        assert response.status_code == 200
        examples["approval"] = response.json()
        assert examples["approval"]["status"] == "approved"
        assert examples["approval"]["executed"] is False
        checks.append("approval_resolution")

        for name, kwargs, status in (
            ("malformed_action", {"json": {**base, "action": "execute"}}, 422),
            ("oversized_body", {"content": b"a" * 65537}, 413),
        ):
            response = client.post("/api/security/evaluate", **kwargs)
            assert response.status_code == status
            result = response.json()
            assert (result["decision"], result["policy"]) == ("BLOCK", "fail_closed")
            event = client.get(f'/api/events/{result["event_id"]}').json()
            assert all(event[key] is None for key in ("request_id", "user", "role", "action", "resource", "classification", "destination"))
            examples[name + "_event"] = event
            checks.append(name)

        response = client.post("/api/redteam/run", json={})
        response.raise_for_status()
        examples["redteam"] = response.json()
        assert examples["redteam"]["status"] == "completed"
        assert (examples["redteam"]["total"], examples["redteam"]["passed"], examples["redteam"]["failed"], examples["redteam"]["unexpected_allows"]) == (16, 16, 0, 0)
        assert client.get("/api/redteam/results").json() == examples["redteam"]
        checks.append("redteam_run_and_results")
        examples["stats"] = client.get("/api/stats").json()
        examples["policy_status"] = client.get("/api/policies/status").json()
        assert examples["stats"]["redteam"]["run_id"] == examples["redteam"]["run_id"]
        assert examples["policy_status"]["loaded"] is True
        checks.append("stats_and_policy_status")
    return {"timestamp": datetime.now(timezone.utc).isoformat(), "base_url": base_url,
            "checks_passed": len(checks), "checks": checks, "examples": examples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:18001")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    result = run(args.url)
    if args.evidence:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"checks_passed": result["checks_passed"], "redteam": {
        key: result["examples"]["redteam"][key] for key in ("total", "passed", "failed", "unexpected_allows")
    }}))


if __name__ == "__main__":
    main()
