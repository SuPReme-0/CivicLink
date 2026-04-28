# backend/api/citizen_routes.py
import hashlib
import os
import asyncio
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional
from backend.core.db import prisma

citizen_router = APIRouter()

# --- Pydantic Schemas ---
class CitizenRegisterReq(BaseModel):
    username: str
    passwordHash: str
    phone: Optional[str] = None

class CitizenLoginReq(BaseModel):
    username: str
    passwordHash: str

# --- Dependency: Verify Citizen Session ---
async def verify_citizen_session(request: Request):
    """Extracts Bearer token, hashes it, and validates against active CitizenSessions."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authentication token")
    
    raw_token = auth_header.split(" ")[1]
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    
    # 🚨 FIX: Replaced utcnow() with timezone-aware datetime
    session = await prisma.citizensession.find_first(
        where={
            "sessionTokenHash": token_hash,
            "isRevoked": False,
            "expiresAt": {"gt": datetime.now(timezone.utc)}
        },
        include={"citizen": True}
    )
    
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
        
    # 🚨 FIX: Actually fire-and-forget to remove database latency from the auth middleware
    asyncio.create_task(
        prisma.citizensession.update(
            where={"id": session.id},
            data={"lastActiveAt": datetime.now(timezone.utc)}
        )
    )
    
    return session.citizen

# --- Routes ---

def generate_session_token():
    return os.urandom(32).hex()

@citizen_router.post("/register")
async def register_citizen(req: CitizenRegisterReq):
    existing = await prisma.citizen.find_unique(where={"username": req.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    phone_hash = hashlib.sha256(req.phone.encode()).hexdigest() if req.phone else f"anon-{os.urandom(8).hex()}"

    try:
        new_citizen = await prisma.citizen.create(
            data={
                "username": req.username,
                # ⚠️ SECURITY NOTE: Upgrade to bcrypt (passlib) before production launch
                "passwordHash": hashlib.sha256(req.passwordHash.encode()).hexdigest(),
                "phoneHash": phone_hash,
                "encryptedPhone": "encrypted-placeholder", # Requires KMS in prod
            }
        )
        return {"status": "success", "citizen_id": new_citizen.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@citizen_router.post("/login")
async def login_citizen(req: CitizenLoginReq):
    citizen = await prisma.citizen.find_unique(where={"username": req.username})
    if not citizen or not citizen.passwordHash:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    hashed_input = hashlib.sha256(req.passwordHash.encode()).hexdigest()
    if citizen.passwordHash != hashed_input:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    raw_token = generate_session_token()
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    # 🚨 FIX: Replaced utcnow() with timezone-aware datetime
    await prisma.citizensession.create(
        data={
            "citizenId": citizen.id,
            "sessionTokenHash": token_hash,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=7),
            "ipAddress": "127.0.0.1" # In prod, extract from Request
        }
    )
    
    # Update citizen's last login
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
    The frontend uses the `threadId` from this response to resume the LangGraph chat!
    """
    try:
        grievances = await prisma.grievancecase.find_many(
            where={"citizenId": current_citizen.id},
            order={"updatedAt": "desc"}
        )
        
        # 🚨 FIX: Safe ISO 8601 formatting for React/Next.js date parsers
        def format_date(dt):
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")

        return {
            "status": "success",
            "grievances": [
                {
                    "id": g.id,
                    "trackingId": g.trackingId,
                    "threadId": g.threadId, 
                    "issueCategory": g.issueCategory,
                    "severity": g.severity,
                    "status": g.status,
                    "updatedAt": format_date(g.updatedAt)
                } for g in grievances
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")