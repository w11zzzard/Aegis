"""Bound bodies before JSON parsing, including chunked requests."""

from fastapi.responses import JSONResponse
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
        while True:
            message = await receive()
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
        index = 0

        async def bounded_receive():
            nonlocal index
            if index < len(chunks):
                message = chunks[index]
                index += 1
                return message
            return await receive()

        return await self.app(scope, bounded_receive, send)
