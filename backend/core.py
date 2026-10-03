"""Deterministic authorization and sanitized, bounded in-memory audit."""

from collections import Counter, deque
from threading import RLock
from time import perf_counter
from uuid import uuid4

from .models import Decision, EvaluateRequest
from .policy import PolicyStore, utc_now


class Gateway:
    def __init__(self, policy_path):
        self.policies = PolicyStore(policy_path)
        self.events = deque(maxlen=2000)
        self.counts = Counter()
        self.lock = RLock()

    def evaluate(self, request: EvaluateRequest):
        started = perf_counter()
        with self.lock:
            config = self.policies.reload()
            decision, policy, reason = self.decide(request, config)
            return self.record(request, decision, policy, reason, started)

    def decide(self, request, config):
        if config is None:
            return Decision.BLOCK, "fail_closed", "Policy unavailable or invalid"
        if any(value is None for value in (
            request.user, request.role, request.action, request.resource,
            request.classification, request.destination,
        )):
            return Decision.BLOCK, "fail_closed", "Required identity or security context missing"
        if config.identities.get(request.user) != request.role:
            return Decision.BLOCK, "identity", "Unknown identity or claimed role mismatch"
        resource = config.resources.get(request.resource)
        if resource is None:
            return Decision.BLOCK, "fail_closed", "Resource has no policy"
        if resource.classification != request.classification:
            return Decision.BLOCK, "classification", "Classification does not match trusted resource policy"
        if request.classification == "RESTRICTED" and request.destination == "EXTERNAL":
            return Decision.BLOCK, "external_exfiltration", "RESTRICTED data cannot leave INTERNAL destinations"
        if request.role not in resource.roles or request.action not in resource.actions:
            return Decision.BLOCK, resource.policy, f"{request.role} cannot access {request.classification} resource"
        return Decision.ALLOW, resource.policy, "Authorized by resource policy"

    def record(self, request, decision, policy, reason, started):
        event_id = str(uuid4())
        latency = round((perf_counter() - started) * 1000, 4)
        response = {
            "decision": decision.value, "policy": policy, "reason": reason,
            "event_id": event_id, "latency_ms": latency,
        }
        event = {
            "id": event_id, "timestamp": utc_now(), "category": policy,
            **{key: getattr(request, key) for key in (
                "request_id", "user", "role", "resource", "classification", "destination"
            )},
            **{key: value for key, value in response.items() if key != "event_id"},
        }
        self.events.appendleft(event)
        self.counts[decision.value] += 1
        return response

    def list_events(self, limit=100):
        with self.lock:
            return list(self.events)[:limit]

    def find_event(self, event_id):
        with self.lock:
            return next((item.copy() for item in self.events if item["id"] == event_id), None)

    def stats(self):
        with self.lock:
            samples = [event["latency_ms"] for event in self.events]
            return {
                "total_events": sum(self.counts.values()),
                "decisions": {decision.value: self.counts[decision.value] for decision in Decision},
                "retained_events": len(self.events),
                "latency_ms": {
                    "samples": len(samples),
                    "mean": sum(samples) / len(samples) if samples else None,
                    "max": max(samples) if samples else None,
                },
                "unexpected_allows": 0,
            }
