"""Bounded real HTTP load against two owned workers and a restarted worker."""

import json
from contextlib import closing
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import httpx

ROOT = Path(__file__).resolve().parents[3]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start(port, state_path, tokens):
    env = {**os.environ, "AEGIS_PROFILE": "authenticated", "AEGIS_STATE_PATH": str(state_path),
           "AEGIS_AUTH_FILE": "", "AEGIS_AUTH_TOKENS": json.dumps(tokens),
           "AEGIS_POLICY_PATH": str(ROOT / "policies/default.yaml"),
           "AEGIS_ALLOWED_HOSTS": "localhost,127.0.0.1", "AEGIS_ALLOWED_ORIGINS": "http://localhost:5173"}
    child = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
                              "--port", str(port), "--no-access-log"], cwd=ROOT, env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    with httpx.Client(timeout=1, trust_env=False) as client:
        for _ in range(100):
            if child.poll() is not None:
                raise RuntimeError("Isolated worker startup failed")
            try:
                if client.get(f"http://127.0.0.1:{port}/health",
                              headers={"Authorization": "Bearer " + tokens["security_admin_1"]}).status_code == 200:
                    return child
            except httpx.TransportError:
                pass
            time.sleep(.05)
    child.terminate()
    child.wait(timeout=5)
    raise RuntimeError("Isolated worker readiness timeout")


def run():
    children = []
    with tempfile.TemporaryDirectory(prefix="aegis-retention-") as directory:
        state = Path(directory) / "shared.sqlite3"
        tokens = {user: secrets.token_urlsafe(36) for user in ("manager_1", "analyst_42", "security_admin_1")}
        ports = [free_port(), free_port()]
        try:
            for port in ports:
                children.append(start(port, state, tokens))
            bases = [f"http://127.0.0.1:{port}" for port in ports]
            credentials = {user: {"Authorization": "Bearer " + token} for user, token in tokens.items()}
            with httpx.Client(timeout=10, trust_env=False) as client:
                proposal = {"action": "read", "resource": "portfolio/current_positions", "classification": "RESTRICTED", "destination": "INTERNAL"}
                result = client.post(bases[0] + "/api/security/evaluate", json=proposal, headers=credentials["manager_1"])
                assert result.status_code == 200 and result.json()["decision"] == "ALLOW"
                path = "/api/events/" + result.json()["event_id"]
                counts = {}
                started = time.perf_counter()
                for index in range(2050):
                    response = client.post(bases[index % 2] + "/api/security/evaluate", content=b'{"role":"SECURITY_ADMIN"}',
                                           headers={"X-Forwarded-For": f"203.0.{index // 256}.{index % 256}"})
                    counts[str(response.status_code)] = counts.get(str(response.status_code), 0) + 1
                    assert response.headers["cache-control"] == "no-store"
                elapsed = time.perf_counter() - started
                assert counts.get("429", 0) > 0
                for base in bases:
                    for user in ("manager_1", "security_admin_1"):
                        assert client.get(base + path, headers=credentials[user]).status_code == 200
                    assert client.get(base + path, headers=credentials["analyst_42"]).status_code == 404
                children[1].terminate()
                children[1].wait(timeout=5)
                children[1] = start(ports[1], state, tokens)
                for user in ("manager_1", "security_admin_1"):
                    assert client.get(bases[1] + path, headers=credentials[user]).status_code == 200
                stats = client.get(bases[1] + "/api/stats", headers=credentials["security_admin_1"]).json()
                with closing(sqlite3.connect(state)) as db:
                    controls = json.loads(db.execute("SELECT body FROM security_controls WHERE id=1").fetchone()[0])
                    disk = db.execute("PRAGMA page_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0]
                evidence = {"requests": 2050, "statuses": counts, "elapsed_seconds": round(elapsed, 3),
                            "workers": 2, "restart_owner_and_admin": "PASS", "cross_user": "404",
                            "retention": stats["retention"], "abuse": stats["abuse"],
                            "limiter_keys": len(controls["windows"]), "sqlite_bytes": disk,
                            "scope": "Synthetic credentials; ephemeral loopback workers and SQLite; bounded sequential flood."}
                assert evidence["retention"]["protected_retained"] == 1
                assert evidence["retention"]["rejection_retained"] <= 256
                assert evidence["limiter_keys"] <= 1002
                return evidence
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=5)


if __name__ == "__main__":
    evidence = run()
    (Path(__file__).parent / "retention-load.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
