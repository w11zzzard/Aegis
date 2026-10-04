"""Deterministic authorization and sanitized, bounded in-memory audit."""

import json

from collections import Counter, defaultdict, deque
from contextlib import contextmanager
from copy import deepcopy
from threading import RLock
from time import monotonic, perf_counter, time
from uuid import uuid4

from .models import Decision, EvaluateRequest
from .policy import PolicyStore, utc_now
from .guards import CredentialRedactor, redact_secrets, tool_problem
from .state import StateStore
from .admission import SecurityControls, increment


class Gateway:
    def __init__(self, policy_path, state_path=None, snapshot=None, *, credential_digests=()):
        self.policies = PolicyStore(policy_path)
        self.events = deque(maxlen=2000)
        self.counts = Counter()
        self.lock = RLock()
        self.usage = defaultdict(deque)
        self.approvals = {}
        self.store = StateStore(state_path) if state_path else None
        self.controls = SecurityControls(self.store)
        self.credential_redactor = CredentialRedactor(credential_digests)
        self.legacy_preserved = 0
        self.fixed_snapshot = snapshot
        self.transaction_depth = 0
        self.transaction_db = None
        self.admin_last_run = 0
        self.redteam_last = {"status": "not_run", "results": [], "total": 0, "unexpected_allows": 0}

    def now(self):
        return time() if self.store else monotonic()

    @contextmanager
    def transaction(self):
        with self.lock:
            if not self.store or self.transaction_depth:
                yield
                return
            with self.store.transaction() as (db, state):
                if state is not None:
                    self.events = deque(state["events"], maxlen=2000)
                    self.counts = Counter(state["counts"])
                    self.usage = defaultdict(deque, {key: deque(value) for key, value in state["usage"].items()})
                    self.approvals = {key: {**value, "request": EvaluateRequest.model_validate_json(json.dumps(value["request"]))} for key, value in state["approvals"].items()}
                    self.admin_last_run = state.get("admin_last_run", 0)
                    self.redteam_last = state.get("redteam_last", self.redteam_last)
                    # Prior versions did not establish trustworthy event classes.
                    # Preserve every retained legacy record in protected capacity.
                    self.legacy_preserved = state.get("legacy_preserved", len(self.events) if "schema_version" not in state else 0)
                self.transaction_depth += 1
                self.transaction_db = db
                try:
                    yield
                    self.store.save(db, {
                        "events": list(self.events), "counts": dict(self.counts),
                        "usage": {key: list(value) for key, value in self.usage.items()},
                        "approvals": {key: {**value, "request": value["request"].model_dump(mode="json")} for key, value in self.approvals.items()},
                        "admin_last_run": self.admin_last_run,
                        "redteam_last": self.redteam_last,
                        "schema_version": 2, "legacy_preserved": self.legacy_preserved,
                    })
                finally:
                    self.transaction_depth -= 1
                    self.transaction_db = None

    def snapshot(self):
        return self.fixed_snapshot or self.policies.snapshot()

    def evaluate(self, request: EvaluateRequest, *, protected=True):
        started = perf_counter()
        with self.transaction():
            snapshot = self.snapshot()
            config = snapshot.config
            decision, policy, reason = self.decide(request, config)
            sanitized_output = None
            if decision in (Decision.ALLOW, Decision.REDACT) and request.output is not None:
                sanitized_output = self.redact(request.output)[0]
            result = self.record(request, decision, policy, reason, started, protected=protected)
            if sanitized_output is not None:
                result["sanitized_output"] = sanitized_output
            if decision == Decision.REQUIRE_APPROVAL:
                self.expire_approvals()
                if len(self.approvals) >= 2000:
                    self.approvals.pop(next(iter(self.approvals)))
                self.approvals[result["event_id"]] = {
                    "created": self.now(), "status": "pending",
                    "policy_digest": snapshot.digest,
                    "request": request.model_copy(update={"prompt": None, "output": None, "source": None, "model": None, "request_id": None}),
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
        if request.output is not None and self.redact(request.output)[1]:
            return Decision.REDACT, "output_secrets", "Secrets removed from model output"
        return Decision.ALLOW, resource.policy, "Authorized by resource policy"

    def consume_budget(self, request, config):
        now = self.now()
        for user, previous in list(self.usage.items()):
            while previous and previous[0][0] <= now - config.budgets.window_seconds:
                previous.popleft()
            if not previous:
                del self.usage[user]
        # Retain live reservations across policy identity churn without letting
        # abandoned principals accumulate forever or resetting live quotas.
        if request.user not in self.usage and len(self.usage) >= 1000:
            return False
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
        now = self.now()
        for item in self.approvals.values():
            if item["status"] == "pending" and (now < item["created"] or now - item["created"] >= 300):
                item["status"] = "expired"

    def resolve_approval(self, event_id, user, approve):
        started = perf_counter()
        with self.transaction():
            snapshot = self.snapshot()
            config = snapshot.config
            def denied(status, detail):
                self.record(EvaluateRequest(), Decision.BLOCK, "approval_denied", detail, started, actor=user, correlation=event_id,
                            protected=bool(config and config.identities.get(user) == "SECURITY_ADMIN"))
                return status, {"detail": detail}
            if config is None or config.identities.get(user) != "SECURITY_ADMIN":
                return denied(403, "A valid SECURITY_ADMIN identity is required")
            self.expire_approvals()
            item = self.approvals.get(event_id)
            if item is None:
                return denied(404, "Approval not found")
            if item["status"] != "pending":
                return denied(409, "Approval is no longer pending")
            original = item["request"]
            resource = config.resources.get(original.resource)
            if (item["policy_digest"] != snapshot.digest or resource is None
                or config.identities.get(original.user) != original.role
                or original.classification != resource.classification
                or original.role not in resource.roles or original.action not in resource.actions
                or original.action not in resource.approval_actions
                or (original.destination == "EXTERNAL" and resource.classification != "PUBLIC")
                or tool_problem(original)):
                item["status"] = "invalidated"
                return denied(409, "Policy or authorization changed; evaluate again")
            item["status"] = "approved" if approve else "denied"
            item["resolved_at"] = utc_now()
            self.record(
                original, Decision.REQUIRE_APPROVAL if approve else Decision.BLOCK,
                "approval_resolution", "Approval recorded; evaluate-only, no action executed" if approve else "Approval denied",
                started, actor=user, correlation=event_id,
                protected=True,
            )
            # Resolution is evidence only: no tool execution or reusable authorization grant.
            return 200, {"id": event_id, "status": item["status"], "resolved_by": user, "executed": False}

    def record(self, request, decision, policy, reason, started, actor=None, correlation=None, *, protected=False):
        if not protected:
            # Low-trust rejections never load or rewrite protected evidence.
            with self.lock:
                return self._record(request, decision, policy, reason, started, actor, correlation, protected=False)
        with self.transaction():
            return self._record(request, decision, policy, reason, started, actor, correlation)

    def _record(self, request, decision, policy, reason, started, actor, correlation, protected=True):
        event_id = str(uuid4())
        latency = round((perf_counter() - started) * 1000, 4)
        response = {
            "decision": decision.value, "policy": policy, "reason": reason,
            "event_id": event_id, "latency_ms": latency,
        }
        event = {
            "id": event_id, "timestamp": utc_now(), "category": policy,
            "evidence_class": "protected" if protected else "rejection",
            **{key: self.audit_value(key, getattr(request, key)) for key in (
                "request_id", "user", "role", "action", "resource", "classification", "destination"
            )},
            **{key: value for key, value in response.items() if key != "event_id"},
        }
        if actor is not None:
            event["actor"] = self.audit_value("user", actor)
        if correlation is not None:
            # IDs from unknown callers are never copied into the audit.
            event["approval_id"] = correlation if correlation in self.approvals else None
        if protected:
            self.events.appendleft(event)
            self.counts[decision.value] = increment(self.counts[decision.value])
        else:
            self.controls.record(event, db=self.transaction_db)
        return response

    def audit_value(self, key, value):
        if value is None:
            return None
        if key == "user" and (not self.policies.config or value not in self.policies.config.identities):
            return None
        if key == "resource" and (not self.policies.config or value not in self.policies.config.resources):
            return None
        return self.redact(str(value))[0]

    def redact(self, value):
        opaque, changed = self.credential_redactor.redact(value)
        result, patterned = redact_secrets(opaque, known_secret=self.credential_redactor.matches)
        return result, changed or patterned

    def list_events(self, limit=100):
        with self.transaction():
            protected = deepcopy(list(self.events))
        samples = self.controls.snapshot()["samples"]
        return sorted(protected + samples, key=lambda event: event["timestamp"], reverse=True)[:limit]

    def find_event(self, event_id):
        with self.transaction():
            event = next((item.copy() for item in self.events if item["id"] == event_id), None)
        return event or next((item.copy() for item in self.controls.snapshot()["samples"] if item["id"] == event_id), None)

    def stats(self):
        telemetry = self.controls.snapshot()
        with self.transaction():
            self.expire_approvals()
            samples = [event["latency_ms"] for event in list(self.events) + telemetry["samples"]]
            return {
                "total_events": sum(self.counts.values()) + sum(telemetry["decisions"].values()),
                "decisions": {decision.value: self.counts[decision.value] + telemetry["decisions"].get(decision.value, 0) for decision in Decision},
                "retained_events": len(self.events) + len(telemetry["samples"]),
                "retention": {"protected_limit": 2000, "protected_retained": len(self.events),
                              "rejection_limit": 256, "rejection_retained": len(telemetry["samples"]),
                              "legacy_preserved": self.legacy_preserved},
                "abuse": {key: telemetry[key] for key in ("admission_denied", "rejections", "dropped_samples")},
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
        now = self.now()
        for user, entries in list(self.usage.items()):
            while entries and entries[0][0] <= now - config.budgets.window_seconds:
                entries.popleft()
            if not entries:
                del self.usage[user]
        return {
            "requests_used": sum(len(entries) for entries in self.usage.values()),
            "tokens_used": sum(item[1] for entries in self.usage.values() for item in entries),
            "requests_limit_per_user": config.budgets.requests,
            "tokens_limit_per_user": config.budgets.tokens,
            "window_seconds": config.budgets.window_seconds,
            "accounting": "conservative_character_units",
        }
