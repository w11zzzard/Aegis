"""Fixed-cardinality admission and rejection telemetry, separate from evidence.

SQLite transactions touch only this small row, never the protected audit buffer.
The caller supplies a credential-verified principal, never an address or claim.
"""

from collections import deque
from contextlib import contextmanager
from copy import deepcopy
from threading import RLock
from time import monotonic, time

WINDOW_SECONDS = 10
UNTRUSTED_LIMIT = 120
PRINCIPAL_LIMIT = 120
AUTHENTICATED_LIMIT = 1200
MAX_KEYS = 1002
MAX_SAMPLES = 256
SAMPLES_PER_WINDOW = 16
MAX_COUNTER = (1 << 63) - 1
REASONS = frozenset({"api_access_denied", "fail_closed", "identity", "approval_denied", "redteam_denied", "other"})


def increment(value, amount=1):
    return min(MAX_COUNTER, value + amount)


def empty_state():
    return {"windows": {}, "samples": [], "sample_window": None, "sample_count": 0,
            "admission_denied": 0, "rejections": {}, "decisions": {}, "dropped_samples": 0}


class SecurityControls:
    def __init__(self, store=None):
        self.store = store
        self.clock = time if store else monotonic
        self.lock = RLock()
        self.state = empty_state()

    @contextmanager
    def transaction(self, db=None):
        if db is not None:
            # The gateway already owns the SQLite writer lock. Taking our
            # in-process lock here would invert standalone admission's order.
            current = self.store.load_controls(db) or empty_state()
            yield current
            self.store.save_controls(db, current)
            return
        with self.lock:
            if self.store:
                with self.store.controls_transaction() as (db, state):
                    current = state or empty_state()
                    yield current
                    self.store.save_controls(db, current)
            else:
                yield self.state

    def admit(self, principal):
        now = self.clock()
        with self.transaction() as state:
            windows = state["windows"]
            # Remove expired keys; rollback never grants a fresh allowance.
            for key in list(windows):
                if now - windows[key][0] >= WINDOW_SECONDS:
                    del windows[key]
            limits = [("untrusted", UNTRUSTED_LIMIT)] if principal is None else [
                ("authenticated", AUTHENTICATED_LIMIT), ("principal:" + principal, PRINCIPAL_LIMIT)]
            if (len(windows) + sum(key not in windows for key, _ in limits) > MAX_KEYS
                or any(key in windows and (now < windows[key][0] or windows[key][1] >= limit) for key, limit in limits)):
                state["admission_denied"] = increment(state["admission_denied"])
                state["dropped_samples"] = increment(state["dropped_samples"])
                return False
            for key, _ in limits:
                entry = windows.setdefault(key, [now, 0])
                entry[1] += 1
            return True

    def record(self, event, db=None):
        now = self.clock()
        with self.transaction(db) as state:
            reason = event["category"] if event["category"] in REASONS else "other"
            state["rejections"][reason] = increment(state["rejections"].get(reason, 0))
            decision = event["decision"]
            state["decisions"][decision] = increment(state["decisions"].get(decision, 0))
            start = state["sample_window"]
            if start is None or now - start >= WINDOW_SECONDS:
                state["sample_window"], state["sample_count"] = now, 0
            if (start is not None and now < start) or state["sample_count"] >= SAMPLES_PER_WINDOW:
                state["dropped_samples"] = increment(state["dropped_samples"])
                return
            samples = deque(state["samples"], maxlen=MAX_SAMPLES)
            if len(samples) == MAX_SAMPLES:
                state["dropped_samples"] = increment(state["dropped_samples"])
            samples.appendleft(event)
            state["samples"] = list(samples)
            state["sample_count"] += 1

    def snapshot(self):
        with self.transaction() as state:
            return deepcopy(state)

    def stats(self):
        state = self.snapshot()
        return {key: state[key] for key in ("admission_denied", "rejections", "dropped_samples")} | {
            "limiter_keys": len(state["windows"]), "retained_samples": len(state["samples"]),
            "sample_limit": MAX_SAMPLES, "samples_per_window": SAMPLES_PER_WINDOW,
            "window_seconds": WINDOW_SECONDS}
