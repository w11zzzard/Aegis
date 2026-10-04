"""Single-process, offline FastAPI demo."""

import os
import sqlite3
from pathlib import Path
from time import perf_counter, time
from uuid import uuid4
import hashlib

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .core import Gateway
from .models import ApprovalRequest, ChatRequest, Decision, EvaluateRequest, StrictModel
from .body_limit import BodyLimitMiddleware
from .redteam import RedteamRunner
from .security import SecurityMiddleware, credential_hashes, parse_credentials, validate_origins, TRUSTED_ORIGINS

ROOT = Path(__file__).resolve().parent.parent


def create_app(policy_path=None, *, profile=None, auth_tokens=None, state_path=None):
    profile = profile or os.getenv("AEGIS_PROFILE", "authenticated")
    if profile not in {"local-demo", "authenticated"}:
        raise ValueError("Unsupported profile: production deployment requires a separately verified identity/TLS/runtime design")
    if auth_tokens is not None:
        tokens = auth_tokens
    elif os.getenv("AEGIS_AUTH_FILE"):
        with Path(os.environ["AEGIS_AUTH_FILE"]).open("rb") as handle:
            raw = handle.read(262145)
        if len(raw) > 262144:
            raise ValueError("Credential file too large")
        tokens = parse_credentials(raw)
    else:
        tokens = parse_credentials(os.getenv("AEGIS_AUTH_TOKENS", "{}"))
    hashes = credential_hashes(tokens)
    origins = validate_origins(os.environ["AEGIS_ALLOWED_ORIGINS"].split(",") if os.getenv("AEGIS_ALLOWED_ORIGINS") else TRUSTED_ORIGINS)
    state_path = state_path or os.getenv("AEGIS_STATE_PATH")
    app = FastAPI(title="AEGIS", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    gateway = Gateway(Path(policy_path or os.getenv("AEGIS_POLICY_PATH", ROOT / "policies/default.yaml")), state_path,
                      credential_digests={hashlib.sha256(token.encode()).digest(): len(token) for token in tokens.values()})
    app.state.gateway = gateway
    runner = RedteamRunner(gateway, ROOT / "redteam/corpus.json")
    app.state.redteam = runner
    app.add_middleware(BodyLimitMiddleware, gateway=gateway)
    app.add_middleware(
        CORSMiddleware, allow_origins=sorted(origins),
        allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=os.getenv("AEGIS_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(","))
    app.add_middleware(SecurityMiddleware, gateway=gateway, profile=profile, hashes=hashes, state_ready=bool(state_path), origins=origins)

    @app.exception_handler(sqlite3.Error)
    async def state_unavailable(request: Request, exc: sqlite3.Error):
        return JSONResponse(status_code=503, content={"detail": "Security state unavailable; request refused"})

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
    def events(request: Request, limit: int = Query(100, ge=1, le=100)):
        principal = getattr(request.state, "principal", None)
        rows = gateway.list_events(2000)
        if principal and principal[1] != "SECURITY_ADMIN":
            rows = [event for event in rows if event["user"] == principal[0]]
        return {"events": rows[:limit]}

    @app.get("/api/events/{event_id}")
    def event(event_id: str, request: Request):
        result = gateway.find_event(event_id)
        principal = getattr(request.state, "principal", None)
        if result is None or (principal and principal[1] != "SECURITY_ADMIN" and result["user"] != principal[0]):
            raise HTTPException(404, "Event not found")
        return result

    @app.get("/api/stats")
    def stats(request: Request):
        require_observer(request)
        with gateway.lock:
            result = gateway.stats()
            redteam = runner.results()
            result["unexpected_allows"] = redteam["unexpected_allows"]
            result["redteam"] = {key: value for key, value in redteam.items() if key != "results"}
            return result

    @app.get("/api/policies/status")
    def policy_status(request: Request):
        require_observer(request)
        return gateway.policies.status()

    def require_observer(request):
        principal = getattr(request.state, "principal", None)
        if principal and principal[1] != "SECURITY_ADMIN":
            gateway.record(EvaluateRequest(), Decision.BLOCK, "api_access_denied", "SECURITY_ADMIN access is required", perf_counter(), actor=principal[0])
            raise HTTPException(403, "SECURITY_ADMIN access is required")

    def bind_identity(body, request):
        principal = getattr(request.state, "principal", None)
        if principal:
            if body.user not in {None, principal[0]} or body.role not in {None, principal[1]}:
                return None, gateway.record(EvaluateRequest(user=principal[0], role=principal[1]), Decision.BLOCK, "identity", "Authenticated identity or role mismatch", perf_counter(), protected=True)
            body = body.model_copy(update={"user": principal[0], "role": principal[1]})
        return body, None

    @app.post("/api/security/evaluate")
    def evaluate(body: EvaluateRequest, request: Request):
        body, denied = bind_identity(body, request)
        return denied or gateway.evaluate(body, protected=getattr(request.state, "principal", None) is not None)

    @app.post("/api/redteam/run")
    def redteam_run(request: Request, body: StrictModel | None = None):
        actor = request.state.principal[0]
        started = perf_counter()
        limited = False
        with gateway.transaction():
            if gateway.admin_last_run and gateway.now() - gateway.admin_last_run < 10:
                gateway.record(EvaluateRequest(), Decision.BLOCK, "redteam_denied", "Red-team run rate exceeded", started, actor=actor, protected=True)
                limited = True
            else:
                gateway.admin_last_run = gateway.now()
        if limited:
            raise HTTPException(429, "Red-team runs are limited to one per ten seconds")
        try:
            result = runner.run()
            gateway.record(EvaluateRequest(), Decision.ALLOW, "redteam_run", "Isolated red-team run completed", started, actor=actor, protected=True)
            return result
        except RuntimeError:
            gateway.record(EvaluateRequest(), Decision.BLOCK, "redteam_denied", "A red-team run is already active", started, actor=actor, protected=True)
            raise HTTPException(409, "A red-team run is already active") from None
        except (OSError, ValueError, TypeError):
            with gateway.transaction():
                runner.last = {
                    "status": "failed", "results": [], "total": 0,
                    "unexpected_allows": 0, "error": "Red-team corpus unavailable or invalid",
                }
                gateway.record(EvaluateRequest(), Decision.BLOCK, "redteam_failed", "Red-team corpus unavailable or invalid", started, actor=actor, protected=True)
            raise HTTPException(503, "Red-team corpus unavailable or invalid") from None

    @app.get("/api/redteam/results")
    def redteam_results(request: Request):
        require_observer(request)
        return runner.results()

    @app.post("/api/approvals/{event_id}")
    def approval(event_id: str, body: ApprovalRequest, request: Request):
        status, result = gateway.resolve_approval(event_id, request.state.principal[0], body.approve)
        return JSONResponse(status_code=status, content=result)

    @app.post("/v1/chat/completions")
    def chat(body: ChatRequest, http_request: Request):
        security, denied = bind_identity(body.security, http_request)
        if denied:
            return JSONResponse(status_code=403, content=denied)
        # Offline fixture response only. No network or online model is called.
        prompt = "\n".join(message.content for message in body.messages)
        output = "AEGIS offline demo: request accepted. No live portfolio data is loaded."
        request = security.model_copy(update={
            "prompt": prompt, "output": output,
            "estimated_tokens": max(body.security.estimated_tokens, len(prompt) + body.max_tokens),
        })
        result = gateway.evaluate(request, protected=getattr(http_request.state, "principal", None) is not None)
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
