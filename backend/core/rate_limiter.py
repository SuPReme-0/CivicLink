# backend/core/rate_limiter.py
"""
Native, SQLite-backed async token bucket rate limiter.
Synchronizes across multi-worker Uvicorn deployments without requiring Redis.
Uses an atomic Write-Ahead Logging (WAL) SQL transaction for high-performance concurrency.
"""
import time
import logging
from typing import Optional, Dict, Tuple
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from backend.core.config import settings

logger = logging.getLogger(__name__)

# Ensure a local directory exists for the rate limit database
DB_PATH = Path("data/ratelimit.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

class AsyncRateLimiter:
    """
    Multi-dimensional rate limiter (Global, Provider, API Key).
    Uses SQLite WAL mode for OS-level IPC (Inter-Process Communication).
    """
    
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        """Initialize SQLite connection and create schemas with WAL optimization."""
        try:
            self._db = await aiosqlite.connect(self.db_path, isolation_level=None)
            # Enable WAL mode for high-concurrency multi-process reads/writes
            await self._db.execute("PRAGMA journal_mode=WAL;")
            await self._db.execute("PRAGMA synchronous=NORMAL;")
            
            # Create Bucket Schema
            await self._db.execute("""
                CREATE TABLE IF NOT EXISTS buckets (
                    id TEXT PRIMARY KEY,
                    tokens REAL NOT NULL,
                    last_refill REAL NOT NULL,
                    capacity REAL NOT NULL,
                    refill_rate REAL NOT NULL
                )
            """)
            
            # Create Usage Schema for Budgets
            await self._db.execute("""
                CREATE TABLE IF NOT EXISTS usage (
                    id TEXT PRIMARY KEY,
                    tokens REAL DEFAULT 0,
                    cost_usd REAL DEFAULT 0.0,
                    last_updated TEXT NOT NULL
                )
            """)
            logger.info("Native SQLite rate limiter initialized.")
        except Exception as e:
            logger.error(f"Failed to initialize rate limiter DB: {e}")
            raise

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    def _get_bucket_key(self, dimension: str, identifier: str) -> str:
        return f"{dimension}:{identifier}"

    async def _consume_atomic(
        self, 
        bucket_id: str, 
        capacity: float, 
        refill_rate: float, 
        token_cost: float, 
        now: float
    ) -> Tuple[bool, float]:
        """
        Calculates refill, checks capacity, and subtracts tokens in a SINGLE atomic SQL transaction.
        Returns (is_allowed, wait_time_seconds).
        """
        if not self._db:
            return True, 0.0

        # Step 1: Ensure bucket exists (Initialize to full capacity)
        await self._db.execute("""
            INSERT INTO buckets (id, tokens, last_refill, capacity, refill_rate)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        """, (bucket_id, capacity, now, capacity, refill_rate))

        # Step 2: The Atomic Consume Query
        # This dynamically calculates how many tokens generated since last_refill.
        # It ONLY updates the row if the calculated tokens >= token_cost.
        query = """
            UPDATE buckets
            SET 
                tokens = MIN(capacity, tokens + (? - last_refill) * refill_rate) - ?,
                last_refill = ?
            WHERE 
                id = ? 
                AND MIN(capacity, tokens + (? - last_refill) * refill_rate) >= ?
        """
        
        cursor = await self._db.execute(query, (now, token_cost, now, bucket_id, now, token_cost))
        
        # If rowcount == 1, the WHERE clause passed, meaning we had enough tokens.
        if cursor.rowcount == 1:
            return True, 0.0

        # Step 3: If rejected, calculate how long the user must wait
        async with self._db.execute("SELECT tokens, last_refill FROM buckets WHERE id = ?", (bucket_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                current_tokens = min(capacity, row[0] + (now - row[1]) * refill_rate)
                tokens_needed = token_cost - current_tokens
                wait_sec = max(0.0, tokens_needed / refill_rate)
                return False, wait_sec
            
        return False, 1.0 # Fallback wait time

    async def allow_request(
        self,
        provider: str,
        api_key_hash: str,
        token_cost: int,
        model: str
    ) -> Tuple[bool, float]:
        """Check all rate limit dimensions atomically."""
        now = time.time()
        wait_times = []

        # Dimensions to enforce
        dimensions = [
            ("global", "all", settings.RATE_LIMIT_BUCKET_SIZE, settings.RATE_LIMIT_REFILL_RATE),
            ("provider", provider, 
             getattr(settings, f"{provider.upper()}_RATE_LIMIT_RPM", 30) * 100, 
             getattr(settings, f"{provider.upper()}_RATE_LIMIT_RPM", 30) * 100 / 60),
            ("api_key", api_key_hash, settings.RATE_LIMIT_BUCKET_SIZE, settings.RATE_LIMIT_REFILL_RATE),
        ]

        for dim_name, dim_id, capacity, refill_rate in dimensions:
            bucket_id = self._get_bucket_key(dim_name, dim_id)
            
            allowed, wait_sec = await self._consume_atomic(
                bucket_id, capacity, refill_rate, token_cost, now
            )
            
            if not allowed:
                wait_times.append(wait_sec)

        if wait_times:
            return False, max(wait_times)
        return True, 0.0

    async def record_usage(
        self,
        provider: str,
        api_key_hash: str,
        token_cost: int,
        model: str,
        cost_usd: float
    ) -> None:
        """Records financial metrics natively."""
        if not settings.ENABLE_COST_TRACKING or not self._db:
            return

        now_str = datetime.now(timezone.utc).isoformat()
        usage_id = f"usage:{api_key_hash}:{datetime.now(timezone.utc).date()}"

        await self._db.execute("""
            INSERT INTO usage (id, tokens, cost_usd, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                tokens = tokens + excluded.tokens,
                cost_usd = cost_usd + excluded.cost_usd,
                last_updated = excluded.last_updated
        """, (usage_id, token_cost, cost_usd, now_str))

# Global singleton
rate_limiter = AsyncRateLimiter()