import os
import json
import math
import hashlib
import logging
import bcrypt
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel, EmailStr

from backend.core.db import prisma
from backend.core.security import verify_frontend_auth
from backend.core.observability import get_tracer

logger = logging.getLogger(__name__)

admin_router = APIRouter(
    dependencies=[Depends(verify_frontend_auth)]
)

# ==============================================================================
# STRICT PYDANTIC SCHEMAS
# ==============================================================================

class AdminUserCreate(BaseModel):
    name: str
    email: EmailStr
    role: str
    status: Optional[str] = "ACTIVE"
    password: str # Required for initial setup

class AdminReviewPayload(BaseModel):
    decision: str # "APPROVED" or "REJECTED"
    notes: Optional[str] = None

class SystemSettingsUpdate(BaseModel):
    system: Dict[str, Any]
    ai: Dict[str, Any]
    features: Dict[str, Any]
    security: Dict[str, Any]

# ==============================================================================
# DASHBOARD METRICS
# ==============================================================================

@admin_router.get("/dashboard-stats")
async def get_dashboard_stats():
    tracer = get_tracer("civiclink.admin")
    with tracer.start_as_current_span("admin.dashboard_stats"):
        try:
            total = await prisma.grievancecase.count()
            
            terminal_states = ["DISPATCHED", "RESOLVED", "FAILED", "REJECTED_FRAUD", "ESCALATED"]
            active = await prisma.grievancecase.count(
                where={"status": {"notIn": terminal_states}}
            )
            
            resolved = await prisma.grievancecase.count(where={"status": "RESOLVED"})

            avg_time_query = """
                SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_seconds 
                FROM "grievance_cases" 
                WHERE status IN ('RESOLVED', 'DISPATCHED')
            """
            avg_time_raw = await prisma.query_raw(avg_time_query)
            
            avg_seconds = 0
            if avg_time_raw and len(avg_time_raw) > 0 and avg_time_raw[0].get("avg_seconds") is not None:
                avg_seconds = float(avg_time_raw[0]["avg_seconds"])
            
            avg_time_str = "0h"
            if avg_seconds > 0:
                if avg_seconds < 3600:
                    avg_time_str = f"{int(avg_seconds // 60)}m"
                else:
                    avg_time_str = f"{round(avg_seconds / 3600, 1)}h"

            # 🚨 FIXED: Prisma Python uses `count` not `_count` as the kwarg!
            status_groups = await prisma.grievancecase.group_by(
                by=["status"],
                count={"_all": True} 
            )
            
            status_mapping = {
                "DISPATCHED": "Dispatched",
                "AWAITING_REVIEW": "Awaiting Review",
                "FAILED": "Failed",
                "RESOLVED": "Resolved",
                "RECEIVED": "Processing"
            }
            
            status_data = []
            for group in status_groups:
                db_status = group.get("status")
                if db_status in status_mapping:
                    # 🚨 Safe extraction: Handles how Prisma Python formats the response dictionary
                    val = group.get("_count", {}).get("_all", group.get("count", {}).get("_all", 0))
                    status_data.append({
                        "name": status_mapping[db_status],
                        "value": int(val)
                    })

            throughput_query = """
                SELECT 
                    TO_CHAR(date_trunc('hour', "createdAt"), 'HH24:MI') as time_bucket,
                    COUNT(*)::int as count
                FROM "grievance_cases"
                WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
                GROUP BY date_trunc('hour', "createdAt")
                ORDER BY date_trunc('hour', "createdAt") ASC
            """
            throughput_raw = await prisma.query_raw(throughput_query)
            
            throughput_data = []
            for row in throughput_raw:
                throughput_data.append({
                    "time": str(row["time_bucket"]),
                    "count": int(row["count"])
                })

            if not throughput_data:
                throughput_data = [{"time": datetime.now(timezone.utc).strftime("%H:00"), "count": 0}]

            return {
                "metrics": {
                    "total": total,
                    "active": active,
                    "resolved": resolved,
                    "avgTime": avg_time_str,
                },
                "throughputData": throughput_data,
                "statusData": status_data
            }
        except Exception as e:
            logger.error(f"❌ FATAL ERROR IN DASHBOARD STATS: {str(e)}", exc_info=True)
            return {
                "metrics": {"total": 0, "active": 0, "resolved": 0, "avgTime": "0h"},
                "throughputData": [{"time": datetime.now(timezone.utc).strftime("%H:00"), "count": 0}],
                "statusData": []
            }
        
# ==============================================================================
# GRIEVANCE MANAGEMENT & HITL RESUMPTION
# ==============================================================================

@admin_router.get("/grievances")
async def get_paginated_grievances(
    page: int = Query(1, ge=1),
    pageSize: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    severity: Optional[str] = None,
    search: Optional[str] = None,
):
    try:
        where_clause = {}
        if status: where_clause["status"] = status
        if severity: where_clause["severity"] = severity
        if search:
            where_clause["OR"] = [
                {"trackingId": {"contains": search, "mode": "insensitive"}},
                {"threadId": {"contains": search, "mode": "insensitive"}},
                {"issueCategory": {"contains": search, "mode": "insensitive"}}
            ]

        total_items = await prisma.grievancecase.count(where=where_clause)
        
        items = await prisma.grievancecase.find_many(
            where=where_clause,
            skip=(page - 1) * pageSize,
            take=pageSize,
            order={"createdAt": "desc"}
        )

        # 🚨 RESTORED FIX: Safe serialization loop to prevent FastAPI 500 errors on the table
        safe_items = []
        for item in items:
            item_dict = item.model_dump() if hasattr(item, "model_dump") else item.dict()
            
            item_dict["createdAt"] = item.createdAt.isoformat() + "Z" if item.createdAt else None
            item_dict["updatedAt"] = item.updatedAt.isoformat() + "Z" if item.updatedAt else None
            
            if isinstance(item_dict.get("rawInputPayload"), str):
                try: item_dict["rawInputPayload"] = json.loads(item_dict["rawInputPayload"])
                except: pass
            if isinstance(item_dict.get("systemMetadata"), str):
                try: item_dict["systemMetadata"] = json.loads(item_dict["systemMetadata"])
                except: pass
                
            safe_items.append(item_dict)

        return {
            "items": safe_items,
            "total": total_items,
            "page": page,
            "pageSize": pageSize,
            "totalPages": math.ceil(total_items / pageSize) if total_items > 0 else 0
        }
    except Exception as e:
        logger.exception("Database error fetching grievances")
        return {"items": [], "total": 0, "page": 1, "pageSize": pageSize, "totalPages": 0}

async def resume_graph_bg(app, thread_id: str):
    """Background task to resume the LangGraph workflow after HITL."""
    try:
        graph = app.state.graph
        config = {"configurable": {"thread_id": thread_id}}
        logger.info(f"▶️ Resuming LangGraph workflow for {thread_id} post-HITL...")
        async for _ in graph.astream(None, config=config):
            pass
    except Exception as e:
        logger.error(f"Failed to resume graph for {thread_id}: {e}")

@admin_router.post("/grievances/{thread_id}/review")
async def process_human_review(
    thread_id: str, 
    payload: AdminReviewPayload, 
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin=Depends(verify_frontend_auth)
):
    """
    🚨 HITL ENDPOINT: Updates the database, writes an Audit Log, and unfreezes the LangGraph thread.
    """
    try:
        await prisma.grievancecase.update(
            where={"threadId": thread_id},
            data={
                "reviewDecision": payload.decision,
                "reviewNotes": payload.notes,
                "reviewedById": current_admin.id,
                "reviewedAt": datetime.now(timezone.utc)
            }
        )

        client_ip = request.client.host if request.client else "unknown"
        await create_audit_entry(
            actor=current_admin.name, 
            role=current_admin.role,
            action=f"REVIEW_{payload.decision}", 
            severity="SUCCESS" if payload.decision == "APPROVED" else "WARNING",
            target=f"Thread:{thread_id}",
            details=payload.notes or "Processed via Admin Node Inspector",
            ip=client_ip
        )

        graph = request.app.state.graph
        config = {"configurable": {"thread_id": thread_id}}
        await graph.aupdate_state(config, {"human_review_decision": payload.decision}, as_node="human_review")
        
        background_tasks.add_task(resume_graph_bg, request.app, thread_id)

        return {"status": "success", "message": "Graph resumed successfully"}
    except Exception as e:
        logger.exception("Failed to process HITL review")
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# SYSTEM SETTINGS
# ==============================================================================

DEFAULT_SETTINGS = {
    "system": {"apiBaseUrl": "http://localhost:8000", "requestTimeout": 15, "maxRetries": 3, "dataRetentionDays": 90},
    "ai": {"vlmPriority": ["groq", "gemini", "vllm"], "authScoreThreshold": 0.75, "autoEscalationSeverity": "CRITICAL", "fallbackToMock": True},
    "features": {"mockMode": False, "hitlBypassLowSeverity": False, "autoRetryScrapeFailures": True, "realtimePollIntervalMs": 5000},
    "security": {"sessionTimeoutMin": 120, "enforce2FA": True, "ipWhitelist": "", "auditLogRetentionDays": 365}
}

@admin_router.get("/settings")
async def get_settings():
    try:
        setting = await prisma.systemsetting.find_unique(where={"id": "global"})
        if not setting:
            setting = await prisma.systemsetting.create(
                data={"id": "global", "config": json.dumps(DEFAULT_SETTINGS)}
            )
        
        return json.loads(setting.config) if isinstance(setting.config, str) else setting.config
    except Exception as e:
        logger.exception("Failed to fetch settings")
        raise HTTPException(status_code=500, detail=str(e))

@admin_router.put("/settings")
async def update_settings(
    payload: SystemSettingsUpdate, 
    request: Request,
    current_admin=Depends(verify_frontend_auth)
):
    try:
        new_settings = payload.dict()
        await prisma.systemsetting.upsert(
            where={"id": "global"},
            data={
                "create": {"id": "global", "config": json.dumps(new_settings)},
                "update": {"config": json.dumps(new_settings)}
            }
        )
        
        client_ip = request.client.host if request.client else "unknown"
        await create_audit_entry(
            actor=current_admin.name, 
            role=current_admin.role,
            action="UPDATE_SETTINGS", 
            severity="WARNING",
            target="SystemSettings",
            details="Global system configuration modified.",
            ip=client_ip
        )
        
        return {"status": "success"}
    except Exception as e:
        logger.exception("Failed to update settings")
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# USER & CITIZEN MANAGEMENT
# ==============================================================================

@admin_router.get("/users")
async def get_users():
    try:
        users = await prisma.adminuser.find_many(order={"createdAt": "desc"})
        return [
            {
                "id": u.id, "name": u.name, "email": u.email, "role": u.role, 
                "status": u.status, "actionsCount": u.actionsCount,
                "lastLogin": u.lastLoginAt.isoformat() + "Z" if u.lastLoginAt else None
            } for u in users
        ]
    except Exception as e:
        logger.exception("Failed to fetch users")
        raise HTTPException(status_code=500, detail=str(e))

@admin_router.get("/citizens")
async def get_citizens():
    try:
        citizens = await prisma.citizen.find_many(
            include={"grievances": True},
            order={"createdAt": "desc"}
        )
        return [
            {
                "id": c.id,
                "username": c.username or "Anonymous Citizen",
                "phoneHash": c.phoneHash,
                "trustScore": c.trustScore,
                "isBanned": c.isBanned,
                "workflowCount": len(c.grievances) if c.grievances else 0,
                "lastActive": c.lastWebLoginAt.isoformat() + "Z" if c.lastWebLoginAt else c.createdAt.isoformat() + "Z",
                "createdAt": c.createdAt.isoformat() + "Z"
            } for c in citizens
        ]
    except Exception as e:
        logger.exception("Failed to fetch citizens")
        raise HTTPException(status_code=500, detail=str(e))

@admin_router.post("/users")
async def create_user(
    payload: AdminUserCreate,
    request: Request,
    current_admin=Depends(verify_frontend_auth)
):
    try:
        salt = bcrypt.gensalt()
        secure_password_hash = bcrypt.hashpw(payload.password.encode('utf-8'), salt).decode('utf-8')

        new_user = await prisma.adminuser.create(
            data={
                "name": payload.name,
                "email": payload.email,
                "passwordHash": secure_password_hash,
                "role": payload.role,
                "status": payload.status
            }
        )
        
        client_ip = request.client.host if request.client else "unknown"
        await create_audit_entry(
            actor=current_admin.name, 
            role=current_admin.role,
            action="CREATE_USER", 
            severity="WARNING",
            target=f"AdminUser:{new_user.email}",
            details=f"New admin created with role {payload.role}.",
            ip=client_ip
        )
        
        return {"status": "success", "id": new_user.id}
    except Exception as e:
        logger.exception("Failed to create user")
        raise HTTPException(status_code=500, detail="Could not create user. Email may already exist.")

@admin_router.delete("/citizens/{citizen_id}")
async def terminate_citizen_identity(
    citizen_id: str,
    request: Request,
    current_admin=Depends(verify_frontend_auth)
):
    """Scrambles PII but preserves the Citizen node so Grievance stats survive."""
    try:
        dead_hash = f"ANONYMIZED_{os.urandom(8).hex()}"
        
        await prisma.citizen.update(
            where={"id": citizen_id},
            data={
                "username": dead_hash,
                "phoneHash": dead_hash,
                "encryptedPhone": "PURGED_GDPR",
                "encryptedName": "PURGED_GDPR",
                "isBanned": True,
                "anonymizedAt": datetime.now(timezone.utc),
                "passwordHash": None 
            }
        )
        
        await prisma.citizensession.update_many(
            where={"citizenId": citizen_id, "isRevoked": False},
            data={"isRevoked": True}
        )
        
        client_ip = request.client.host if request.client else "unknown"
        await create_audit_entry(
            actor=current_admin.name, 
            role=current_admin.role,
            action="ANONYMIZE_CITIZEN", 
            severity="CRITICAL",
            target=f"Citizen:{citizen_id}",
            details="Citizen identity cryptographically purged and anonymized. Sessions revoked.",
            ip=client_ip
        )
        
        return {"status": "success", "message": "Identity cryptographically purged."}
    except Exception as e:
        logger.exception("Failed to anonymize citizen")
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# IMMUTABLE AUDIT LOGS
# ==============================================================================

@admin_router.get("/audit")
async def get_audit_logs():
    try:
        logs = await prisma.systemauditlog.find_many(
            take=500,
            order={"timestamp": "desc"}
        )
        return [
            {**log.dict(), "timestamp": log.timestamp.isoformat() + "Z"} 
            for log in logs
        ]
    except Exception as e:
        logger.exception("Failed to fetch audit logs")
        raise HTTPException(status_code=500, detail=str(e))

async def create_audit_entry(actor: str, role: str, action: str, severity: str, target: str, details: str, ip: str):
    """Cryptographically sealed audit logger."""
    timestamp = datetime.now(timezone.utc).isoformat()
    raw_string = f"{timestamp}|{actor}|{action}|{target}|{details}"
    immutable_hash = hashlib.sha256(raw_string.encode()).hexdigest()
    
    try:
        await prisma.systemauditlog.create(
            data={
                "timestamp": datetime.now(timezone.utc),
                "actor": actor,
                "actorRole": role,
                "action": action,
                "severity": severity,
                "target": target,
                "details": details,
                "ip": ip,
                "userAgent": "CivicLink Admin API",
                "immutableHash": f"0x{immutable_hash}"
            }
        )
    except Exception as e:
        logger.error(f"FATAL: Failed to write audit log! {e}")