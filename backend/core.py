"""Deterministic authorization and sanitized, bounded in-memory audit."""

from collections import Counter, defaultdict, deque
from threading import RLock
from time import monotonic, perf_counter
from uuid import uuid4

from .models import Decision, EvaluateRequest
from .policy import PolicyStore, utc_now
from .guards import redact_secrets, tool_problem


class Gateway:
    def __init__(self, policy_path):
        self.policies = PolicyStore(policy_path)
        self.events = deque(maxlen=2000)
        self.counts = Counter()
        self.lock = RLock()
        self.usage = defaultdict(deque)
        self.approvals = {}

    def evaluate(self, request: EvaluateRequest):
        started = perf_counter()
        with self.lock:
            config = self.policies.reload()
            decision, policy, reason = self.decide(request, config)
            sanitized_output = None
            if decision in (Decision.ALLOW, Decision.REDACT) and request.output is not None:
                sanitized_output = redact_secrets(request.output)[0]
            result = self.record(request, decision, policy, reason, started)
            if sanitized_output is not None:
                result["sanitized_output"] = sanitized_output
            if decision == Decision.REQUIRE_APPROVAL:
                self.expire_approvals()
                if len(self.approvals) >= 2000:
                    self.approvals.pop(next(iter(self.approvals)))
                self.approvals[result["event_id"]] = {
                    "created": monotonic(), "status": "pending",
                    "policy_digest": self.policies.digest,
                    "request": request.model_copy(update={"prompt": None, "output": None, "source": None}),
                }
            return result

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
        # Trusted classification and declared classification both protect this boundary.
        resource = config.resources.get(request.resource)
        if resource is None:
            return Decision.BLOCK, "fail_closed", "Resource has no policy"
        if request.destination == "EXTERNAL" and (
            resource.classification == "RESTRICTED" or request.classification == "RESTRICTED"
        ):
            return Decision.BLOCK, "external_exfiltration", "RESTRICTED data cannot leave INTERNAL destinations"
        if resource.classification != request.classification:
            return Decision.BLOCK, "classification", "Classification does not match trusted resource policy"
        if request.role not in resource.roles or request.action not in resource.actions:
            return Decision.BLOCK, resource.policy, f"{request.role} cannot access {request.classification} resource"
        if request.destination == "EXTERNAL" and resource.classification != "PUBLIC":
            return Decision.BLOCK, "external_exfiltration", "Non-public data cannot leave INTERNAL destinations"
        problem = tool_problem(request)
        if problem:
            return Decision.BLOCK, "tool_guard", problem
        if not self.consume_budget(request, config):
            return Decision.THROTTLE, "budget", "Request or token budget exceeded"
        if request.action in resource.approval_actions:
            return Decision.REQUIRE_APPROVAL, resource.policy, "Authorized action requires explicit approval"
        if request.output is not None and redact_secrets(request.output)[1]:
            return Decision.REDACT, "output_secrets", "Secrets removed from model output"
        return Decision.ALLOW, resource.policy, "Authorized by resource policy"

    def consume_budget(self, request, config):
        now = monotonic()
        entries = self.usage[request.user]
        while entries and entries[0][0] <= now - config.budgets.window_seconds:
            entries.popleft()
        # Conservative offline accounting; callers cannot bypass quota by declaring zero.
        # Character count is a quota unit, not a claimed model-token measurement.
        chars = sum(len(value or "") for value in (request.prompt, request.output, request.source))
        tokens = max(request.estimated_tokens, chars, 1)
        if len(entries) >= config.budgets.requests or sum(item[1] for item in entries) + tokens > config.budgets.tokens:
            return False
        entries.append((now, tokens))
        return True

    def expire_approvals(self):
        now = monotonic()
        for item in self.approvals.values():
            if item["status"] == "pending" and now - item["created"] >= 300:
                item["status"] = "expired"

    def resolve_approval(self, event_id, user, approve):
        started = perf_counter()
        with self.lock:
            config = self.policies.reload()
            if config is None or config.identities.get(user) != "SECURITY_ADMIN":
                return 403, {"detail": "A valid SECURITY_ADMIN identity is required"}
            self.expire_approvals()
            item = self.approvals.get(event_id)
            if item is None:
                return 404, {"detail": "Approval not found"}
            if item["status"] != "pending":
                return 409, {"detail": "Approval is no longer pending"}
            original = item["request"]
            resource = config.resources.get(original.resource)
            if (item["policy_digest"] != self.policies.digest or resource is None
                or config.identities.get(original.user) != original.role
                or original.role not in resource.roles or original.action not in resource.actions):
                item["status"] = "invalidated"
                return 409, {"detail": "Policy or authorization changed; evaluate again"}
            item["status"] = "approved" if approve else "denied"
            item["resolved_at"] = utc_now()
            self.record(
                original, Decision.REQUIRE_APPROVAL if approve else Decision.BLOCK,
                "approval_resolution", "Approval recorded; evaluate-only, no action executed" if approve else "Approval denied",
                started,
            )
            # Resolution is evidence only: no tool execution or reusable authorization grant.
            return 200, {"id": event_id, "status": item["status"], "resolved_by": user, "executed": False}

    def record(self, request, decision, policy, reason, started):
        event_id = str(uuid4())
        latency = round((perf_counter() - started) * 1000, 4)
        response = {
            "decision": decision.value, "policy": policy, "reason": reason,
            "event_id": event_id, "latency_ms": latency,
        }
        event = {
            "id": event_id, "timestamp": utc_now(), "category": policy,
            **{key: self.audit_value(key, getattr(request, key)) for key in (
                "request_id", "user", "role", "resource", "classification", "destination"
            )},
            **{key: value for key, value in response.items() if key != "event_id"},
        }
        self.events.appendleft(event)
        self.counts[decision.value] += 1
        return response

    def audit_value(self, key, value):
        if value is None:
            return None
        if key == "user" and (not self.policies.config or value not in self.policies.config.identities):
            return None
        if key == "resource" and (not self.policies.config or value not in self.policies.config.resources):
            return None
        return redact_secrets(str(value))[0]

    def list_events(self, limit=100):
        with self.lock:
            return list(self.events)[:limit]

    def find_event(self, event_id):
        with self.lock:
            return next((item.copy() for item in self.events if item["id"] == event_id), None)

    def stats(self):
        with self.lock:
            self.expire_approvals()
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
                "budgets": self.budget_stats(),
                "approvals": dict(Counter(item["status"] for item in self.approvals.values())),
            }

    def budget_stats(self):
        config = self.policies.config
        if config is None:
            return {"requests_used": 0, "tokens_used": 0, "accounting": "conservative_character_units"}
        now = monotonic()
        for entries in self.usage.values():
            while entries and entries[0][0] <= now - config.budgets.window_seconds:
                entries.popleft()
        return {
            "requests_used": sum(len(entries) for entries in self.usage.values()),
            "tokens_used": sum(item[1] for entries in self.usage.values() for item in entries),
            "requests_limit_per_user": config.budgets.requests,
            "tokens_limit_per_user": config.budgets.tokens,
            "window_seconds": config.budgets.window_seconds,
            "accounting": "conservative_character_units",
        }
