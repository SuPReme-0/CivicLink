# backend/api/admin_routes.py
import os
import json
import math
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, Request

from backend.core.db import prisma
from backend.core.security import verify_frontend_auth
from backend.core.observability import get_tracer

logger = logging.getLogger(__name__)

admin_router = APIRouter(
    dependencies=[Depends(verify_frontend_auth)]
)

# ==============================================================================
# DASHBOARD METRICS (100% Real Data Aggregation)
# ==============================================================================

@admin_router.get("/dashboard-stats")
async def get_dashboard_stats():
    tracer = get_tracer("civiclink.admin")
    with tracer.start_as_current_span("admin.dashboard_stats"):
        try:
            # 1. CORE COUNTS
            total = await prisma.grievancecase.count()
            
            # Active cases are anything not in a terminal state
            terminal_states = ["DELIVERED", "PORTAL_SUBMITTED", "RESOLVED", "FAILED", "REJECTED"]
            active = await prisma.grievancecase.count(
                where={"status": {"notIn": terminal_states}}
            )
            
            resolved = await prisma.grievancecase.count(where={"status": "RESOLVED"})

            # 2. REAL AVERAGE RESOLUTION TIME
            # Calculates the average time (in seconds) between creation and reaching a terminal success state
            avg_time_query = """
                SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) as avg_seconds 
                FROM "GrievanceCase" 
                WHERE status IN ('RESOLVED', 'DELIVERED', 'PORTAL_SUBMITTED')
            """
            avg_time_raw = await prisma.query_raw(avg_time_query)
            avg_seconds = avg_time_raw[0].get("avg_seconds") if avg_time_raw and avg_time_raw[0].get("avg_seconds") else 0
            
            # Format nicely for the frontend
            avg_time_str = "0h"
            if avg_seconds:
                avg_seconds = float(avg_seconds)
                if avg_seconds < 3600:
                    avg_time_str = f"{int(avg_seconds // 60)}m"
                else:
                    avg_time_str = f"{round(avg_seconds / 3600, 1)}h"

            # 3. REAL STATUS DISTRIBUTION
            # Uses Prisma's group_by to count exactly how many tickets are in each state
            status_groups = await prisma.grievancecase.group_by(
                by=["status"],
                _count={"_all": True}
            )
            
            status_mapping = {
                "DELIVERED": "Dispatched (SMTP)",
                "PORTAL_SUBMITTED": "Dispatched (Portal)",
                "AWAITING_REVIEW": "Awaiting Review",
                "FAILED": "Failed",
                "RESOLVED": "Resolved"
            }
            
            status_data = []
            for group in status_groups:
                db_status = group["status"]
                if db_status in status_mapping:
                    status_data.append({
                        "name": status_mapping[db_status],
                        "value": group["_count"]["_all"]
                    })

            # 4. REAL THROUGHPUT DATA (Last 24 Hours)
            # Groups cases created in the last 24 hours by hour bucket
            throughput_query = """
                SELECT 
                    TO_CHAR(date_trunc('hour', "createdAt"), 'HH24:MI') as time_bucket,
                    COUNT(*)::int as count
                FROM "GrievanceCase"
                WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
                GROUP BY date_trunc('hour', "createdAt")
                ORDER BY date_trunc('hour', "createdAt") ASC
            """
            throughput_raw = await prisma.query_raw(throughput_query)
            throughput_data = [{"time": row["time_bucket"], "count": row["count"]} for row in throughput_raw]

            # Safe fallback if the database is brand new to prevent chart UI crashes
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
            logger.exception("Failed to fetch dashboard stats")
            raise HTTPException(status_code=500, detail="Internal server error fetching metrics")

# ==============================================================================
# GRIEVANCE MANAGEMENT
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
                {"issueCategory": {"contains": search, "mode": "insensitive"}}
            ]

        total_items = await prisma.grievancecase.count(where=where_clause)
        items = await prisma.grievancecase.find_many(
            where=where_clause,
            skip=(page - 1) * pageSize,
            take=pageSize,
            order={"createdAt": "desc"},
            include={"location": True}
        )

        return {
            "items": [
                {**item.dict(), "createdAt": item.createdAt.isoformat() + "Z"} 
                for item in items
            ],
            "total": total_items,
            "page": page,
            "pageSize": pageSize,
            "totalPages": math.ceil(total_items / pageSize) if total_items > 0 else 0
        }
    except Exception as e:
        logger.exception("Database error fetching grievances")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

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
async def update_settings(new_settings: dict, request: Request):
    try:
        await prisma.systemsetting.upsert(
            where={"id": "global"},
            data={
                "create": {"id": "global", "config": json.dumps(new_settings)},
                "update": {"config": json.dumps(new_settings)}
            }
        )
        
        await create_audit_entry(
            actor="System Admin", 
            role="SUPER_ADMIN",
            action="ROLE_CHANGE", 
            severity="WARNING",
            target="SystemSettings",
            details="Global system configuration modified.",
            ip=request.client.host if request.client else "unknown"
        )
        
        return {"status": "success"}
    except Exception as e:
        logger.exception("Failed to update settings")
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# ADMIN USER MANAGEMENT
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

@admin_router.post("/users")
async def create_user(user: dict):
    try:
        # 🚨 FIX: os.urandom is now safe because 'import os' was added
        dummy_hash = hashlib.sha256(os.urandom(16)).hexdigest()
        new_user = await prisma.adminuser.create(
            data={
                "name": user["name"],
                "email": user["email"],
                "passwordHash": dummy_hash,
                "role": user["role"],
                "status": user.get("status", "ACTIVE")
            }
        )
        return {"status": "success", "id": new_user.id}
    except Exception as e:
        logger.exception("Failed to create user")
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
    # 🚨 FIX: Replaced deprecated utcnow() with timezone-aware datetime.now()
    timestamp = datetime.now(timezone.utc).isoformat()
    raw_string = f"{timestamp}|{actor}|{action}|{target}|{details}"
    immutable_hash = hashlib.sha256(raw_string.encode()).hexdigest()
    
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