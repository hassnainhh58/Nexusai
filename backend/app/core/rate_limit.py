"""Small in-process rate limiter for expensive endpoints.

A sliding window per user id is enough for a single-worker deployment (which is
what SQLite implies). For a multi-worker / multi-instance deployment this should
be replaced by a shared store such as Redis; the interface is intentionally tiny
so that swap stays local.
"""

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, status

from .auth import CurrentUser, get_current_user
from .config import get_settings


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: float = 60.0) -> bool:
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and now - bucket[0] >= window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True

    def retry_after(self, key: str, window_seconds: float = 60.0) -> int:
        bucket = self._hits.get(key)
        if not bucket:
            return 0
        return max(1, int(window_seconds - (time.monotonic() - bucket[0])))

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


async def rate_limit(
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Dependency that rejects a user who exceeds the per-minute quota."""
    settings = get_settings()
    limit = settings.rate_limit_requests_per_minute + settings.rate_limit_burst
    if not limiter.allow(f"user:{current_user.id}", limit=limit):
        retry_after = limiter.retry_after(f"user:{current_user.id}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please slow down and try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )
