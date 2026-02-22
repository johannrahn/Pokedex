"""
Thread-safe in-memory TTL cache.

Provides a simple key-value store with automatic expiration.
Completely decoupled from the rest of the application — if the
cache fails, the caller should fall back to a direct API request.
"""

import threading
import time
from typing import Any, Optional


class TTLCache:
    """In-memory cache with per-key time-to-live expiration.

    Attributes:
        default_ttl: Default TTL in seconds for cached entries.
    """

    def __init__(self, default_ttl: int = 300) -> None:
        self.default_ttl = default_ttl
        self._store: dict[str, tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a value if it exists and hasn't expired.

        Args:
            key: Cache key to look up.

        Returns:
            The cached value, or None if missing/expired.
        """
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None

            value, expiry = entry
            if time.monotonic() > expiry:
                del self._store[key]
                return None

            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Store a value with an optional custom TTL.

        Args:
            key: Cache key.
            value: Value to store.
            ttl: Time-to-live in seconds. Uses default_ttl if not specified.
        """
        ttl = ttl if ttl is not None else self.default_ttl
        expiry = time.monotonic() + ttl

        with self._lock:
            self._store[key] = (value, expiry)
            self._cleanup_expired()

    def clear(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()

    def _cleanup_expired(self) -> None:
        """Remove expired entries. Must be called while holding the lock."""
        now = time.monotonic()
        expired_keys = [
            k for k, (_, expiry) in self._store.items() if now > expiry
        ]
        for key in expired_keys:
            del self._store[key]

    def __len__(self) -> int:
        """Return the number of non-expired entries."""
        with self._lock:
            self._cleanup_expired()
            return len(self._store)
