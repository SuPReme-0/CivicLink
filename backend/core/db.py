# backend/core/db.py
"""
Global Database Singleton.
Prevents PostgreSQL connection pool exhaustion by sharing a single Prisma client 
across all LangGraph nodes and Uvicorn workers.
"""
import logging
from prisma import Prisma

logger = logging.getLogger(__name__)

prisma = Prisma()

async def connect_db() -> None:
    """To be called in the FastAPI lifespan startup event."""
    if not prisma.is_connected():
        await prisma.connect()
        logger.info("Prisma database client connected successfully.")

async def disconnect_db() -> None:
    """To be called in the FastAPI lifespan shutdown event."""
    if prisma.is_connected():
        await prisma.disconnect()
        logger.info("Prisma database client disconnected.")