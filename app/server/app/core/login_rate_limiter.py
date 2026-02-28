from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque


class LoginRateLimiter:
    def __init__(
        self,
        max_attempts: int = 6,
        window_seconds: int = 300,
        block_seconds: int = 600,
    ) -> None:
        self._max_attempts = max(1, max_attempts)
        self._window_seconds = max(30, window_seconds)
        self._block_seconds = max(30, block_seconds)
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._blocked_until: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def blocked_seconds(self, key: str) -> int:
        async with self._lock:
            return self._blocked_seconds_locked(key)

    async def register_failure(self, key: str) -> int:
        async with self._lock:
            now = time.time()
            self._prune_locked(key, now)
            attempts = self._attempts[key]
            attempts.append(now)
            if len(attempts) < self._max_attempts:
                return 0

            block_until = now + self._block_seconds
            self._blocked_until[key] = block_until
            attempts.clear()
            return int(self._block_seconds)

    async def register_success(self, key: str) -> None:
        async with self._lock:
            self._attempts.pop(key, None)
            self._blocked_until.pop(key, None)

    def _blocked_seconds_locked(self, key: str) -> int:
        now = time.time()
        self._prune_locked(key, now)
        blocked_until = self._blocked_until.get(key)
        if not blocked_until:
            return 0
        remaining = int(blocked_until - now)
        return max(0, remaining)

    def _prune_locked(self, key: str, now: float) -> None:
        blocked_until = self._blocked_until.get(key)
        if blocked_until and blocked_until <= now:
            self._blocked_until.pop(key, None)

        attempts = self._attempts.get(key)
        if not attempts:
            return

        cutoff = now - self._window_seconds
        while attempts and attempts[0] < cutoff:
            attempts.popleft()

        if not attempts:
            self._attempts.pop(key, None)
