"""Separate process challenge with synthetic temporary SQLite state only."""
import json
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from backend.core import Gateway
from backend.main import ROOT
from backend.models import EvaluateRequest


def admission(path):
    gateway = Gateway(ROOT / "policies/default.yaml", path)
    gateway.controls.clock = lambda: 100.0
    return sum(gateway.controls.admit("manager_1") for _ in range(50))


def resolve(values):
    path, event_id = values
    gateway = Gateway(ROOT / "policies/default.yaml", path)
    return gateway.resolve_approval(event_id, "security_admin_1", True)[0]


def run():
    with tempfile.TemporaryDirectory(prefix="aegis-review-workers-") as folder:
        path = Path(folder) / "synthetic.sqlite3"
        gateway = Gateway(ROOT / "policies/default.yaml", path)
        request = EvaluateRequest(user="manager_1", role="PORTFOLIO_MANAGER", action="export", resource="portfolio/current_positions", classification="RESTRICTED", destination="INTERNAL")
        pending = gateway.evaluate(request)
        assert pending["decision"] == "REQUIRE_APPROVAL"
        with ProcessPoolExecutor(max_workers=4) as pool:
            totals = list(pool.map(admission, [str(path)] * 4))
            statuses = list(pool.map(resolve, [(str(path), pending["event_id"])] * 16))
        assert sum(totals) == 120
        assert statuses.count(200) == 1
        assert statuses.count(409) == 15
        restart = Gateway(ROOT / "policies/default.yaml", path)
        restart.controls.clock = lambda: 100.0
        assert not restart.controls.admit("manager_1")
        assert restart.resolve_approval(pending["event_id"], "security_admin_1", False)[0] == 409
        assert any(event.get("approval_id") == pending["event_id"] and event["category"] == "approval_resolution" for event in restart.list_events())
        return {"processes":4, "principal_attempts":200, "principal_admitted":sum(totals), "approval_attempts":16, "approved_once":statuses.count(200), "replays_refused":statuses.count(409), "restart_limit_preserved":True, "restart_replay_refused":True, "approval_evidence_preserved":True}


if __name__ == "__main__":
    result = run()
    target = Path(__file__).with_name("review-processes.json")
    target.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
