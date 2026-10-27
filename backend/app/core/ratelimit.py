"""Tiny per-IP rate limit for state-changing requests (plan section 3.7: no login, so cap abuse instead)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request, call_next):
        limit = settings.rate_limit_per_min
        if limit > 0 and request.method in _MUTATING:
            ip = request.client.host if request.client else "unknown"
            now = time.monotonic()
            q = self.hits[ip]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                return JSONResponse({"detail": f"Rate limit exceeded ({limit} changes per minute)"}, status_code=429)
            q.append(now)
        return await call_next(request)
