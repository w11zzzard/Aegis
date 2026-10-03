"""Atomic shared state for workers on one host, on a local SQLite filesystem."""

import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, ValidationError

from .models import Classification, Decision, EvaluateRequest, Identifier, Role, StrictModel

CounterValue = Annotated[int, Field(ge=0, le=(1 << 63) - 1)]
ClockValue = Annotated[float, Field(ge=0, allow_inf_nan=False)]
AuditText = Annotated[str, StringConstraints(max_length=128)]


class StoredEvent(StrictModel):
    id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    timestamp: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    category: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    decision: Decision
    policy: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    reason: Annotated[str, StringConstraints(min_length=1, max_length=1024)]
    latency_ms: ClockValue
    request_id: AuditText | None = None
    user: AuditText | None = None
    role: Role | None = None
    action: Literal["read", "export"] | None = None
    resource: AuditText | None = None
    classification: Classification | None = None
    destination: Literal["INTERNAL", "EXTERNAL"] | None = None
    actor: AuditText | None = None
    approval_id: AuditText | None = None
    evidence_class: Literal["protected", "rejection"] | None = None


class StoredApproval(StrictModel):
    created: ClockValue
    status: Literal["pending", "approved", "denied", "expired", "invalidated"]
    policy_digest: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    request: EvaluateRequest
    resolved_at: Annotated[str, StringConstraints(max_length=64)] | None = None


class StoredRedteamResult(StrictModel):
    id: Identifier
    expected: Decision
    actual: Decision
    passed: bool
    policy: AuditText
    reason: Annotated[str, StringConstraints(max_length=1024)]
    latency_ms: ClockValue


class StoredRedteam(StrictModel):
    status: Literal["not_run", "failed", "completed"]
    results: Annotated[list[StoredRedteamResult], Field(max_length=100)]
    total: Annotated[int, Field(ge=0, le=100)]
    unexpected_allows: Annotated[int, Field(ge=0, le=100)]
    run_id: AuditText | None = None
    timestamp: Annotated[str, StringConstraints(max_length=64)] | None = None
    policy_version: AuditText | None = None
    policy_digest: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    passed: Annotated[int, Field(ge=0, le=100)] | None = None
    failed: Annotated[int, Field(ge=0, le=100)] | None = None
    latency_ms: ClockValue | None = None
    error: Annotated[str, StringConstraints(max_length=1024)] | None = None


class StoredGateway(StrictModel):
    # Missing version/new metadata is the prior on-disk schema, preserved intact.
    schema_version: Literal[2] = 2
    events: Annotated[list[StoredEvent], Field(max_length=2000)]
    counts: dict[Decision, CounterValue]
    usage: dict[Identifier, Annotated[list[tuple[ClockValue, Annotated[int, Field(ge=1, le=1000000)]]], Field(max_length=100000)]]
    approvals: Annotated[dict[AuditText, StoredApproval], Field(max_length=2000)]
    admin_last_run: ClockValue = 0
    redteam_last: StoredRedteam = Field(default_factory=lambda: StoredRedteam(status="not_run", results=[], total=0, unexpected_allows=0))
    legacy_preserved: Annotated[int, Field(ge=0, le=2000)] = 0


class StoredControls(StrictModel):
    windows: Annotated[dict[Annotated[str, StringConstraints(pattern=r"^(?:untrusted|authenticated|principal:[A-Za-z0-9_./:-]{1,128})$")], tuple[ClockValue, Annotated[int, Field(ge=0, le=1200)]]], Field(max_length=1002)]
    samples: Annotated[list[StoredEvent], Field(max_length=256)]
    sample_window: ClockValue | None
    sample_count: Annotated[int, Field(ge=0, le=16)]
    admission_denied: CounterValue
    rejections: dict[Literal["api_access_denied", "fail_closed", "identity", "approval_denied", "redteam_denied", "other"], CounterValue]
    decisions: dict[Decision, CounterValue]
    dropped_samples: CounterValue


def decode_state(raw, schema):
    """Refuse corrupt stored data without replacing it or hiding application bugs."""
    def unique(pairs):
        values = {}
        for key, value in pairs:
            if key in values:
                raise ValueError("Duplicate state key")
            values[key] = value
        return values

    def finite(_value):
        raise ValueError("Nonfinite state number")

    try:
        state = json.loads(raw, object_pairs_hook=unique, parse_constant=finite)
        schema.model_validate_json(raw)
    except (ValueError, TypeError, UnicodeError, RecursionError, ValidationError):
        raise sqlite3.DatabaseError("Invalid security state") from None
    return state


class StateStore:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=5)) as db:
            db.execute("CREATE TABLE IF NOT EXISTS gateway_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS security_controls (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
            db.commit()

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT body FROM gateway_state WHERE id=1").fetchone()
            state = decode_state(row[0], StoredGateway) if row else None
            yield db, state
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def save(db, body):
        db.execute("INSERT INTO gateway_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", (json.dumps(body),))

    @contextmanager
    def controls_transaction(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            state = self.load_controls(db)
            yield db, state
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def save_controls(db, body):
        db.execute("INSERT INTO security_controls VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", (json.dumps(body),))

    @staticmethod
    def load_controls(db):
        row = db.execute("SELECT body FROM security_controls WHERE id=1").fetchone()
        return decode_state(row[0], StoredControls) if row else None
