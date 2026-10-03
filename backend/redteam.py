"""Run committed cases against a fresh instance of the actual enforcement engine."""

import json
from pathlib import Path
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
        self.last = {"status": "not_run", "results": [], "total": 0, "unexpected_allows": 0}

    def run(self):
        with self.gateway.lock:
            started = perf_counter()
            with self.corpus_path.open("rb") as handle:
                raw = handle.read(262145)
            if len(raw) > 262144:
                raise ValueError("Corpus too large")
            corpus = Corpus.model_validate_json(raw)
            if len({case.id for case in corpus.cases}) != len(corpus.cases):
                raise ValueError("Duplicate case IDs")
            engine = Gateway(self.gateway.policies.path)
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
            self.last = {
                "status": "completed", "run_id": str(uuid4()), "timestamp": utc_now(),
                "policy_version": engine.policies.config.version if engine.policies.config else None,
                "total": len(results), "passed": passed, "failed": len(results) - passed,
                "unexpected_allows": unexpected, "results": results,
                "latency_ms": round((perf_counter() - started) * 1000, 4),
            }
            return json.loads(json.dumps(self.last))

    def results(self):
        with self.gateway.lock:
            return json.loads(json.dumps(self.last))
