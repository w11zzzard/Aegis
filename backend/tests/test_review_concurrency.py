"""Independent lock-order and cross-process state challenges."""
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
from time import perf_counter

from backend.core import Gateway
from backend.main import ROOT
from backend.models import Decision, EvaluateRequest


def test_nested_telemetry_does_not_wait_on_admission_mutex(tmp_path, monkeypatch):
    gateway = Gateway(ROOT / "policies/default.yaml", tmp_path / "state.sqlite3")
    admission_waiting = Event()
    original_transaction = gateway.store.controls_transaction

    @contextmanager
    def waiting_transaction():
        # The admission mutex is held while its separate DB transaction waits
        # for the gateway's existing write transaction below.
        admission_waiting.set()
        with original_transaction() as value:
            yield value

    monkeypatch.setattr(gateway.store, "controls_transaction", waiting_transaction)
    original_connect = sqlite3.connect

    def quick_connect(*args, **kwargs):
        # A lock-order bug fails quickly instead of stalling the test for 5s.
        kwargs["timeout"] = 0.2
        return original_connect(*args, **kwargs)

    monkeypatch.setattr("backend.state.sqlite3.connect", quick_connect)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with gateway.transaction():
            future = pool.submit(gateway.controls.admit, None)
            assert admission_waiting.wait(2)
            gateway.record(EvaluateRequest(), Decision.BLOCK, "fail_closed", "Synthetic rejection", perf_counter())
        # Both transitions commit once the owning gateway transaction releases
        # the DB. A mutex/DB cycle instead exhausts the separate transaction.
        assert future.result(timeout=2) is True
