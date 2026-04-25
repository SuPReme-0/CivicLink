# backend/core/security.py
"""
Cryptographic Edge Security (Frontend-to-Backend Edition).
Verifies incoming requests from the Next.js frontend and encrypts PII.
"""
import hashlib
import secrets
import logging
from fastapi import HTTPException, Security
from fastapi.security.api_key import APIKeyHeader

from backend.core.config import settings

logger = logging.getLogger(__name__)

# The Next.js backend API routes will pass this key to FastAPI
API_KEY_NAME = "X-Frontend-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

async def verify_frontend_auth(api_key: str = Security(api_key_header)) -> bool:
    """
    Validates that the incoming request originates from the trusted Next.js server.
    Prevents unauthorized actors from triggering expensive LangGraph workflows.
    """
    # Bypass verification in local development if explicitly configured
    if getattr(settings, "ENVIRONMENT", "development") == "development" and not getattr(settings, "FRONTEND_API_KEY", None):
        logger.debug("Development mode: Bypassing frontend auth.")
        return True

    if not api_key:
        logger.warning("Missing API Key header from incoming request.")
        raise HTTPException(status_code=403, detail="Missing authentication")

    # Use secrets.compare_digest for constant-time comparison to prevent timing attacks
    expected_key = getattr(settings, "FRONTEND_API_KEY", "")
    if not secrets.compare_digest(api_key, expected_key):
        logger.error("Frontend API Key mismatch! Potential unauthorized access attempt.")
        raise HTTPException(status_code=403, detail="Invalid API Key")

    return True

def hash_phone_number(phone: str) -> str:
    """
    Creates a deterministic blind index for O(1) database lookups 
    without storing raw phone numbers in the clear.
    """
    salt = getattr(settings, "PII_HASH_SALT", "civiclink_default_salt")
    return hashlib.sha256(f"{phone}:{salt}".encode()).hexdigest()