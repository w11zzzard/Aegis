"""In-process integration rehearsal using the public HTTP API."""

import json
import secrets

from fastapi.testclient import TestClient

from .main import create_app


def main():
    token = secrets.token_urlsafe(32)
    with TestClient(create_app(profile="local-demo", auth_tokens={"security_admin_1": token}), base_url="http://localhost", client=("127.0.0.1", 50000)) as client:
        base = {
            "user": "analyst_42", "role": "ANALYST", "action": "read",
            "resource": "portfolio/current_positions", "classification": "RESTRICTED",
            "destination": "INTERNAL",
        }
        for name, updates in (
            ("analyst_restricted", {}),
            ("manager_authorized", {"user": "manager_1", "role": "PORTFOLIO_MANAGER"}),
            ("manager_external", {"user": "manager_1", "role": "PORTFOLIO_MANAGER", "destination": "EXTERNAL"}),
        ):
            response = client.post("/api/security/evaluate", json={**base, **updates})
            response.raise_for_status()
            result = response.json()
            if client.get(f'/api/events/{result["event_id"]}').status_code != 200:
                raise RuntimeError("Audit event unavailable")
            print(json.dumps({"scenario": name, **result}))
        response = client.post("/api/redteam/run", headers={"Authorization": "Bearer " + token})
        response.raise_for_status()
        result = response.json()
        print(json.dumps({key: value for key, value in result.items() if key != "results"}))
        if result["failed"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
