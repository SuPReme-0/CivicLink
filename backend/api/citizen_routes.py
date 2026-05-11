import hashlib
import os
import asyncio
import logging
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional

from backend.core.db import prisma 

logger = logging.getLogger(__name__)
citizen_router = APIRouter()

# ---------------------------------------------------------
# PYDANTIC SCHEMAS (Strictly Synced with Frontend)
# ---------------------------------------------------------
class CitizenRegisterReq(BaseModel):
    username: str
    password: str 
    phone_number: Optional[str] = None

class CitizenLoginReq(BaseModel):
    username: str
    password: str

# ---------------------------------------------------------
# DEPENDENCY: SESSION VERIFICATION
# ---------------------------------------------------------
async def verify_citizen_session(request: Request):
    """
    Extracts session token from either X-Session-ID (Web Frontend) 
    or Bearer token (Mobile/API), hashes it, and validates.
    """
    session_id = request.headers.get("X-Session-ID")
    auth_header = request.headers.get("Authorization")

    raw_token = None
    if session_id:
        raw_token = session_id
    elif auth_header and auth_header.startswith("Bearer "):
        raw_token = auth_header.split(" ")[1]

    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing or invalid authentication token")
    
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    
    session = await prisma.citizensession.find_first(
        where={
            "sessionTokenHash": token_hash,
            "isRevoked": False,
            "expiresAt": {"gt": datetime.now(timezone.utc)}
        },
        include={"citizen": True}
    )
    
    if not session or not session.citizen:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
        
    # Fire-and-forget: Update last active timestamp without blocking the request latency
    asyncio.create_task(
        prisma.citizensession.update(
            where={"id": session.id},
            data={"lastActiveAt": datetime.now(timezone.utc)}
        )
    )
    
    return session.citizen

# ---------------------------------------------------------
# ROUTES
# ---------------------------------------------------------
def generate_session_token():
    return os.urandom(32).hex()

@citizen_router.post("/register")
async def register_citizen(req: CitizenRegisterReq):
    existing = await prisma.citizen.find_unique(where={"username": req.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    # 1. Anonymized Phone Hashing for Blind Indexing
    phone_hash = hashlib.sha256(req.phone_number.encode('utf-8')).hexdigest() if req.phone_number else f"anon-{os.urandom(8).hex()}"

    # 2. Secure Bcrypt Password Hashing
    try:
        salt = bcrypt.gensalt()
        secure_password_hash = bcrypt.hashpw(req.password.encode('utf-8'), salt).decode('utf-8')
    except Exception as e:
        logger.error(f"Encryption Failure during registration: {e}")
        raise HTTPException(status_code=500, detail="Internal cryptography error")

    try:
        new_citizen = await prisma.citizen.create(
            data={
                "username": req.username,
                "passwordHash": secure_password_hash,
                "phoneHash": phone_hash,
                "encryptedPhone": "encrypted-placeholder", # To be replaced with KMS encryption in production
            }
        )
        return {"status": "success", "citizen_id": new_citizen.id}
        
    except Exception as e:
        logger.error(f"Citizen Registration Failed: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal error occurred during registration.")


@citizen_router.post("/login")
async def login_citizen(req: CitizenLoginReq, request: Request):
    citizen = await prisma.citizen.find_unique(where={"username": req.username})
    
    # Generic failure message prevents user enumeration attacks
    if not citizen or not citizen.passwordHash:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Verify Bcrypt Hash
    try:
        is_valid_password = bcrypt.checkpw(
            req.password.encode('utf-8'), 
            citizen.passwordHash.encode('utf-8')
        )
    except ValueError:
        # Catches legacy corrupted passwords without crashing the server
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not is_valid_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Generate Secure Session
    raw_token = generate_session_token()
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("User-Agent", "unknown")

    await prisma.citizensession.create(
        data={
            "citizenId": citizen.id,
            "sessionTokenHash": token_hash,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=7),
            "ipAddress": client_ip,
            "userAgent": user_agent[:255] if user_agent else "unknown" # Truncate to prevent payload bloat
        }
    )
    
    await prisma.citizen.update(
        where={"id": citizen.id}, 
        data={"lastWebLoginAt": datetime.now(timezone.utc)}
    )

    return {
        "status": "success", 
        "token": raw_token,
        "citizen": {
            "id": citizen.id,
            "username": citizen.username
        }
    }


@citizen_router.get("/me/grievances")
async def get_my_grievances(current_citizen = Depends(verify_citizen_session)):
    """
    Returns all historical grievances for the logged-in citizen.
    """
    try:
        grievances = await prisma.grievancecase.find_many(
            where={"citizenId": current_citizen.id},
            order={"updatedAt": "desc"}
        )
        
        def format_date(dt):
            if not dt: return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")

        return {
            "status": "success",
            "grievances": [
                {
                    "id": g.id,
                    "tracking_id": g.trackingId,     
                    "thread_id": g.threadId,         
                    "issue_category": g.issueCategory, 
                    "severity": g.severity,
                    "status": g.status,
                    "created_at": format_date(g.createdAt), 
                    "updated_at": format_date(g.updatedAt)
                } for g in grievances
            ]
        }
    except Exception as e:
        logger.error(f"Failed to fetch grievances for {current_citizen.id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve grievance history.")