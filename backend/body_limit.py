"""Bound bodies before JSON parsing, including chunked requests."""

from fastapi.responses import JSONResponse
import asyncio
from email.message import Message
import json
import math
from time import perf_counter

from .models import Decision, EvaluateRequest


class BodyLimitMiddleware:
    def __init__(self, app, gateway, max_bytes=65536):
        self.app = app
        self.gateway = gateway
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        chunks = []
        size = 0
        started = perf_counter()
        def reject_duplicates(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Duplicate JSON key")
                result[key] = value
            return result

        async def refuse(status, reason):
            result = self.gateway.record(EvaluateRequest(), Decision.BLOCK, "fail_closed", reason, started)
            return await JSONResponse(status_code=status, content=result)(scope, receive, send)

        while True:
            remaining = 10 - (perf_counter() - started)
            try:
                if remaining <= 0:
                    raise TimeoutError
                message = await asyncio.wait_for(receive(), timeout=remaining)
            except TimeoutError:
                return await refuse(408, "Request body timed out")
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.max_bytes:
                with self.gateway.lock:
                    result = self.gateway.record(
                        EvaluateRequest(), Decision.BLOCK, "fail_closed", "Request body too large", started,
                    )
                response = JSONResponse(status_code=413, content=result)
                return await response(scope, receive, send)
            chunks.append(message)
            if not message.get("more_body", False):
                break
        # Match FastAPI's email MIME parser, including case/parameter variants
        # and application subtypes ending in +json. The installed FastAPI uses
        # strict_content_type=True, so absent/empty types stay non-JSON bytes
        # and its schema handler refuses nonempty bodies on these JSON routes.
        content_type = next((value.decode("latin-1") for key, value in scope.get("headers", [])
                             if key == b"content-type"), "")
        media_type = Message()
        if content_type:
            media_type["content-type"] = content_type
        is_json = (bool(content_type) and media_type.get_content_maintype() == "application"
                   and (media_type.get_content_subtype() == "json"
                        or media_type.get_content_subtype().endswith("+json")))
        if size and is_json:
            try:
                parsed = json.loads(b"".join(chunk.get("body", b"") for chunk in chunks), object_pairs_hook=reject_duplicates)
                pending = [(parsed, 0)]
                nodes = 0
                while pending:
                    value, depth = pending.pop()
                    nodes += 1
                    if depth > 32 or nodes > 10000:
                        raise ValueError("JSON complexity limit exceeded")
                    if isinstance(value, float) and not math.isfinite(value):
                        raise ValueError("Nonfinite JSON value")
                    if isinstance(value, dict):
                        pending.extend((child, depth + 1) for child in value.values())
                    elif isinstance(value, list):
                        pending.extend((child, depth + 1) for child in value)
            except (ValueError, UnicodeError, RecursionError):
                return await refuse(422, "Malformed or ambiguous JSON request")
        index = 0

        async def bounded_receive():
            nonlocal index
            if index < len(chunks):
                message = chunks[index]
                index += 1
                return message
            return await receive()

        return await self.app(scope, bounded_receive, send)
