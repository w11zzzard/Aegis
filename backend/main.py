"""Single-process, offline FastAPI demo."""

import os
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core import Gateway
from .models import Decision, EvaluateRequest

ROOT = Path(__file__).resolve().parent.parent


def create_app(policy_path=None):
    app = FastAPI(title="AEGIS", version="0.1.0")
    gateway = Gateway(Path(policy_path or os.getenv("AEGIS_POLICY_PATH", ROOT / "policies/default.yaml")))
    app.state.gateway = gateway
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Aegis-User"],
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        # Pydantic errors include input values; never reflect those into responses.
        with gateway.lock:
            result = gateway.record(EvaluateRequest(), Decision.BLOCK, "fail_closed", "Malformed request", perf_counter())
        return JSONResponse(status_code=422, content=result)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/events")
    def events(limit: int = Query(100, ge=1, le=2000)):
        return {"events": gateway.list_events(limit)}

    @app.get("/api/events/{event_id}")
    def event(event_id: str):
        result = gateway.find_event(event_id)
        if result is None:
            raise HTTPException(404, "Event not found")
        return result

    @app.get("/api/stats")
    def stats():
        return gateway.stats()

    @app.get("/api/policies/status")
    def policy_status():
        return gateway.policies.status()

    @app.post("/api/security/evaluate")
    def evaluate(request: EvaluateRequest):
        return gateway.evaluate(request)

    return app


app = create_app()
