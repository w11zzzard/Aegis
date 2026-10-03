"""Run committed cases against a fresh instance of the actual enforcement engine."""

import json
from pathlib import Path
from threading import Lock
from time import perf_counter
from uuid import uuid4

from pydantic import Field
from typing import Annotated

from .core import Gateway
from .models import Decision, EvaluateRequest, Identifier, StrictModel
from .policy import utc_now


class AttackCase(StrictModel):
    id: Identifier
    expected: Decision
    request: EvaluateRequest


class Corpus(StrictModel):
    cases: Annotated[list[AttackCase], Field(min_length=1, max_length=100)]


class RedteamRunner:
    def __init__(self, gateway, corpus_path: Path):
        self.gateway = gateway
        self.corpus_path = corpus_path
        self.run_lock = Lock()
        self.last = {"status": "not_run", "results": [], "total": 0, "unexpected_allows": 0}

    def run(self):
        if not self.run_lock.acquire(blocking=False):
            raise RuntimeError("Run already active")
        try:
            started = perf_counter()
            with self.corpus_path.open("rb") as handle:
                raw = handle.read(262145)
            if len(raw) > 262144:
                raise ValueError("Corpus too large")
            corpus = Corpus.model_validate_json(raw)
            if len({case.id for case in corpus.cases}) != len(corpus.cases):
                raise ValueError("Duplicate case IDs")
            snapshot = self.gateway.policies.snapshot()
            engine = Gateway(self.gateway.policies.path, snapshot=snapshot)
            results = []
            for case in corpus.cases:
                actual = engine.evaluate(case.request)
                results.append({
                    "id": case.id, "expected": case.expected.value,
                    "actual": actual["decision"], "passed": actual["decision"] == case.expected.value,
                    "policy": actual["policy"], "reason": actual["reason"],
                    "latency_ms": actual["latency_ms"],
                })
            passed = sum(result["passed"] for result in results)
            unexpected = sum(result["expected"] == "BLOCK" and result["actual"] == "ALLOW" for result in results)
            completed = {
                "status": "completed", "run_id": str(uuid4()), "timestamp": utc_now(),
                "policy_version": snapshot.config.version if snapshot.config else None,
                "policy_digest": snapshot.digest,
                "total": len(results), "passed": passed, "failed": len(results) - passed,
                "unexpected_allows": unexpected, "results": results,
                "latency_ms": round((perf_counter() - started) * 1000, 4),
            }
            with self.gateway.transaction():
                self.last = completed
                return json.loads(json.dumps(self.last))
        finally:
            self.run_lock.release()

    def results(self):
        with self.gateway.transaction():
            return json.loads(json.dumps(self.last))

    @property
    def last(self):
        return self.gateway.redteam_last

    @last.setter
    def last(self, value):
        self.gateway.redteam_last = value
