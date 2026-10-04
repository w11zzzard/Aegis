"""Verify the public HTTP boundary on an isolated, disposable server."""

import os
import json
import socket
import subprocess
import sys
import time

import httpx

from backend.live_check import main, run
from backend.main import ROOT


def test_real_http_guard_and_contract_rehearsal(tmp_path, monkeypatch, capsys):
    policy = tmp_path / "policy.yaml"
    policy.write_bytes((ROOT / "policies/default.yaml").read_bytes())
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("AEGIS_CHECK_ADMIN_TOKEN", "a" * 48)
    environment = {**os.environ, "AEGIS_POLICY_PATH": str(policy), "AEGIS_PROFILE": "local-demo", "AEGIS_AUTH_FILE": "", "AEGIS_STATE_PATH": "", "AEGIS_AUTH_TOKENS": json.dumps({"security_admin_1": "a" * 48})}
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
         "--port", str(port), "--no-access-log"],
        cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 10
        with httpx.Client(timeout=0.5, trust_env=False) as client:
            while time.monotonic() < deadline:
                assert server.poll() is None, "Disposable backend failed to start"
                try:
                    if client.get(url + "/health").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            else:
                raise AssertionError("Disposable backend did not become ready")
        result = run(url)
        assert result["checks_passed"] == 19
        assert result["examples"]["event"]["action"] == "read"
        assert result["examples"]["initial_stats"]["latency_ms"]["mean"] is None
        assert result["examples"]["redteam"]["failed"] == 0
        # Exercise the published CLI, including actual evidence writing and its optional branch.
        # Reuse the verified run for CLI serialization; repeated rehearsals share admission quotas.
        monkeypatch.setattr("backend.live_check.run", lambda base_url: result)
        evidence = tmp_path / "evidence" / "http.json"
        monkeypatch.setattr(sys, "argv", ["backend.live_check", "--url", url, "--evidence", str(evidence)])
        main()
        saved = json.loads(evidence.read_text(encoding="utf-8"))
        assert saved["checks_passed"] == 19
        assert saved["examples"]["event"] is None or saved["examples"]["event"]["policy"] == "portfolio_restricted"
        assert json.loads(capsys.readouterr().out)["redteam"]["failed"] == 0
        monkeypatch.setattr(sys, "argv", ["backend.live_check", "--url", url])
        main()
        assert json.loads(capsys.readouterr().out)["checks_passed"] == 19
    finally:
        # Only the child process created by this test is terminated.
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
