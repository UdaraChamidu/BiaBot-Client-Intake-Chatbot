"""Simple in-memory rate limiting utility."""

from collections import defaultdict, deque
from time import time

from fastapi import HTTPException, status


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self.events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time()
        bucket = self.events[key]

        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()

        if len(bucket) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please retry shortly.",
            )

        bucket.append(now)


rate_limiter = InMemoryRateLimiter()
