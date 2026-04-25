# backend/core/db.py
"""
Global Database Singleton.
Prevents PostgreSQL connection pool exhaustion by sharing a single Prisma client 
across all LangGraph nodes and Uvicorn workers.
"""
import logging
from prisma import Prisma

logger = logging.getLogger(__name__)

# The Global Singleton
prisma_client = Prisma()

async def connect_db() -> None:
    """To be called in the FastAPI lifespan startup event."""
    if not prisma_client.is_connected():
        await prisma_client.connect()
        logger.info("Prisma database client connected successfully.")

async def disconnect_db() -> None:
    """To be called in the FastAPI lifespan shutdown event."""
    if prisma_client.is_connected():
        await prisma_client.disconnect()
        logger.info("Prisma database client disconnected.")