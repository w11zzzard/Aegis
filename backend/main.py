"""Single-process, offline FastAPI demo."""

import os
from pathlib import Path
from time import perf_counter, time
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core import Gateway
from .models import ApprovalRequest, ChatRequest, Decision, EvaluateRequest, StrictModel
from .body_limit import BodyLimitMiddleware
from .redteam import RedteamRunner

ROOT = Path(__file__).resolve().parent.parent


def create_app(policy_path=None):
    app = FastAPI(title="AEGIS", version="0.1.0")
    gateway = Gateway(Path(policy_path or os.getenv("AEGIS_POLICY_PATH", ROOT / "policies/default.yaml")))
    app.state.gateway = gateway
    runner = RedteamRunner(gateway, ROOT / "redteam/corpus.json")
    app.state.redteam = runner
    app.add_middleware(BodyLimitMiddleware, gateway=gateway)
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
        with gateway.lock:
            result = gateway.stats()
            redteam = runner.results()
            result["unexpected_allows"] = redteam["unexpected_allows"]
            result["redteam"] = {key: value for key, value in redteam.items() if key != "results"}
            return result

    @app.get("/api/policies/status")
    def policy_status():
        return gateway.policies.status()

    @app.post("/api/security/evaluate")
    def evaluate(request: EvaluateRequest):
        return gateway.evaluate(request)

    @app.post("/api/redteam/run")
    def redteam_run(body: StrictModel | None = None):
        try:
            return runner.run()
        except (OSError, ValueError, TypeError):
            with gateway.lock:
                runner.last = {
                    "status": "failed", "results": [], "total": 0,
                    "unexpected_allows": 0, "error": "Red-team corpus unavailable or invalid",
                }
            raise HTTPException(503, "Red-team corpus unavailable or invalid") from None

    @app.get("/api/redteam/results")
    def redteam_results():
        return runner.results()

    @app.post("/api/approvals/{event_id}")
    def approval(event_id: str, body: ApprovalRequest, x_aegis_user: str | None = Header(None)):
        status, result = gateway.resolve_approval(event_id, x_aegis_user, body.approve)
        return JSONResponse(status_code=status, content=result)

    @app.post("/v1/chat/completions")
    def chat(body: ChatRequest):
        # Offline fixture response only. No network or online model is called.
        prompt = "\n".join(message.content for message in body.messages)
        output = "AEGIS offline demo: request accepted. No live portfolio data is loaded."
        request = body.security.model_copy(update={
            "prompt": prompt, "output": output,
            "estimated_tokens": max(body.security.estimated_tokens, len(prompt) + body.max_tokens),
        })
        result = gateway.evaluate(request)
        if result["decision"] not in {"ALLOW", "REDACT"}:
            return JSONResponse(status_code=429 if result["decision"] == "THROTTLE" else 403, content=result)
        content = result.pop("sanitized_output")
        return {
            "id": "chatcmpl-" + uuid4().hex, "object": "chat.completion", "created": int(time()),
            "model": "aegis-offline-demo",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "aegis": result,
        }

    return app


app = create_app()
