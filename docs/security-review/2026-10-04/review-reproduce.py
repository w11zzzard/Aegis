"""Independent synthetic state-corruption characterization; never opens operator state."""
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import ROOT, create_app

TOKENS = {"manager_1": "m" * 48, "security_admin_1": "s" * 48}

def characterize():
    outcomes = []
    for corrupted in ({}, [], {"events": [], "counts": {}, "usage": {}, "approvals": {"bad": {"request": {"role": "secret"}}}}):
        with tempfile.TemporaryDirectory(prefix="aegis-review-") as folder:
            path = Path(folder) / "synthetic.sqlite3"
            app = create_app(ROOT / "policies/default.yaml", profile="authenticated", auth_tokens=TOKENS, state_path=path)
            with closing(sqlite3.connect(path)) as db:
                with db:
                    db.execute("INSERT INTO gateway_state VALUES (1, ?)", (json.dumps(corrupted),))
            with TestClient(app, base_url="http://localhost", raise_server_exceptions=False) as client:
                response = client.post("/api/security/evaluate", headers={"Authorization": "Bearer " + TOKENS["manager_1"]}, json={"action":"read", "resource":"portfolio/current_positions", "classification":"RESTRICTED", "destination":"INTERNAL"})
                outcomes.append({"synthetic_state_shape": type(corrupted).__name__, "status": response.status_code, "cache_control": response.headers.get("cache-control"), "body": response.text})
    return outcomes

if __name__ == "__main__":
    outcomes = characterize()
    Path(__file__).with_name("review-outage-after.json").write_text(json.dumps(outcomes, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(outcomes, indent=2))
