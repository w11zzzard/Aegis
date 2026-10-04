"""Ambiguous operator corpora must never produce a green security report."""
import json

import pytest
from fastapi.testclient import TestClient

from backend.main import ROOT, create_app


ADMIN_TOKEN = "s" * 48
MANAGER = {
    "user": "manager_1", "role": "PORTFOLIO_MANAGER", "action": "read",
    "resource": "portfolio/current_positions", "classification": "RESTRICTED",
    "destination": "INTERNAL",
}


def ambiguous_corpora():
    request = json.dumps(MANAGER)
    case = '{"id":"positive","expected":"ALLOW","request":' + request + '}'
    return [
        '{"cases":[{"id":"expectation","expected":"BLOCK","expected":"ALLOW","request":' + request + '}]}',
        '{"cases":[{"id":"request","expected":"ALLOW","request":{},"request":' + request + '}]}',
        '{"cases":[],"cases":[' + case + ']}',
        '{"cases":[{"id":"nested","expected":"ALLOW","request":' + request[:-1]
        + ',"tool":"read_resource","tool_arguments":{"resource":"portfolio/current_positions",'
        + '"destination":"EXTERNAL","destination":"INTERNAL"}}}]}',
    ]


@pytest.mark.parametrize("raw", ambiguous_corpora(), ids=["expectation", "request", "cases", "tool_argument"])
def test_duplicate_corpus_keys_fail_visibly_without_a_green_result(tmp_path, raw):
    corpus = tmp_path / "ambiguous.json"
    corpus.write_text(raw, encoding="utf-8")
    app = create_app(
        profile="authenticated", auth_tokens={"security_admin_1": ADMIN_TOKEN},
        state_path=tmp_path / "state.sqlite3",
    )
    app.state.redteam.corpus_path = corpus
    headers = {"Authorization": "Bearer " + ADMIN_TOKEN}
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post("/api/redteam/run", headers=headers)
        assert response.status_code == 503
        assert response.json() == {"detail": "Red-team corpus unavailable or invalid"}
        result = client.get("/api/redteam/results", headers=headers).json()
        assert result["status"] == "failed"
        assert result["results"] == [] and result["total"] == 0
        assert "completed" not in response.text
        assert client.get("/api/stats", headers=headers).json()["redteam"]["status"] == "failed"


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400"])
def test_nonfinite_corpus_numbers_fail_visibly_in_untyped_tool_arguments(tmp_path, number):
    request = json.dumps(MANAGER)[:-1]
    raw = ('{"cases":[{"id":"nonfinite","expected":"BLOCK","request":' + request
           + ',"tool":"read_resource","tool_arguments":{"resource":"portfolio/current_positions",'
           + '"destination":"INTERNAL","unexpected":' + number + '}}}]}')
    corpus = tmp_path / "nonfinite.json"
    corpus.write_text(raw, encoding="utf-8")
    app = create_app(profile="authenticated", auth_tokens={"security_admin_1": ADMIN_TOKEN}, state_path=tmp_path / "state.sqlite3")
    app.state.redteam.corpus_path = corpus
    headers = {"Authorization": "Bearer " + ADMIN_TOKEN}
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post("/api/redteam/run", headers=headers)
        assert response.status_code == 503
        assert response.json() == {"detail": "Red-team corpus unavailable or invalid"}
        result = client.get("/api/redteam/results", headers=headers).json()
        assert result["status"] == "failed" and result["results"] == []
        assert client.get("/api/stats", headers=headers).json()["redteam"]["status"] == "failed"


def test_committed_unambiguous_corpus_still_uses_the_actual_guards(tmp_path):
    app = create_app(
        profile="authenticated", auth_tokens={"security_admin_1": ADMIN_TOKEN},
        state_path=tmp_path / "state.sqlite3",
    )
    assert app.state.redteam.corpus_path == ROOT / "redteam/corpus.json"
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post("/api/redteam/run", headers={"Authorization": "Bearer " + ADMIN_TOKEN})
    assert response.status_code == 200
    result = response.json()
    assert result["passed"] == result["total"] == 16
    assert result["failed"] == result["unexpected_allows"] == 0
    assert next(case for case in result["results"] if case["id"] == "dangerous_shell")["policy"] == "tool_guard"
