# backend/core/db_sync.py
"""
LangGraph to Prisma State Synchronizer.
Translates the in-memory CivicLinkState into persistent relational data.
Strictly adheres to PostgreSQL Foreign Key constraints (Citizen -> Thread -> Case).
"""
import logging
import hashlib
from typing import Dict, Any

from envs.ml.Lib import json

from backend.brain.state import CivicLinkState
from backend.core.db import prisma_client

logger = logging.getLogger(__name__)

async def sync_state_to_db(state: CivicLinkState) -> None:
    """
    Idempotent sync function. Called by the FastAPI background task 
    after LangGraph pauses or completes an execution step.
    """
    if not prisma_client.is_connected():
        await prisma_client.connect()

    session_id = state.get("session_id")
    thread_id = state.get("thread_id")
    tracking_id = state.get("tracking_id")

    if not session_id or not thread_id:
        logger.debug("Insufficient state to sync to Prisma (missing session/thread).")
        return

    try:
        # ---------------------------------------------------------
        # 1. DETERMINE DATABASE STATUS
        # ---------------------------------------------------------
        dispatch_status = state.get("dispatch_status")
        requires_human = state.get("requires_human_review", False)
        
        if requires_human or state.get("next_node_hint") == "human_review":
            db_status = "AWAITING_REVIEW"
        elif dispatch_status in ("DELIVERED", "PORTAL_SUBMITTED", "SENT"):
            db_status = "DISPATCHED"
        elif dispatch_status == "FAILED":
            db_status = "FAILED"
        elif state.get("primary_contact"):
            db_status = "DRAFTING_LETTER"
        elif state.get("jurisdiction_hierarchy"):
            db_status = "ROUTING_JURISDICTION"
        elif state.get("vlm_output"):
            db_status = "VERIFYING_IMAGE"
        else:
            db_status = "RECEIVED"

        # ---------------------------------------------------------
        # 2. FOREIGN KEY WATERFALL UPSERTS (Citizen -> Thread -> Case)
        # ---------------------------------------------------------
        
        # A. Upsert Citizen (Using session_id as a hashed identifier)
        phone_hash = hashlib.sha256(session_id.encode()).hexdigest()
        citizen = await prisma_client.citizen.upsert(
            where={"whatsappId": session_id},
            data={
                "create": {
                    "whatsappId": session_id,
                    "phoneHash": phone_hash,
                    "encryptedPhone": "ENCRYPTED_AT_EDGE", # Handled by ingest edge
                    "languagePref": state.get("language_metadata", {}).get("original", "en")
                },
                "update": {} # Don't overwrite existing citizen data
            }
        )

        # B. Upsert Grievance Thread (LangGraph Namespace)
        thread = await prisma_client.grievancethread.upsert(
            where={"threadId": thread_id},
            data={
                "create": {
                    "threadId": thread_id,
                    "citizenId": citizen.id,
                    "status": db_status,
                    "retryCount": state.get("retry_count", 0),
                    "maxRetries": state.get("max_retries", 3)
                },
                "update": {
                    "status": db_status,
                    "retryCount": state.get("retry_count", 0)
                }
            }
        )

        # C. Upsert Grievance Case
        if tracking_id:
            await prisma_client.grievancecase.upsert(
                where={"trackingId": tracking_id},
                data={
                    "create": {
                        "trackingId": tracking_id,
                        "citizenId": citizen.id,
                        "threadId": thread.threadId,
                        "issueCategory": state.get("issue_category", "UNKNOWN"),
                        "descriptionText": state.get("extracted_text", "No description provided"),
                        "severity": state.get("severity_level", "MEDIUM"),
                        "status": db_status,
                        "rawInputPayload": {"source": "whatsapp"}, 
                        "systemMetadata": {
                            "confidence_metrics": state.get("confidence_metrics", {}),
                            "auth_score": state.get("image_authenticity_score")
                        }
                    },
                    "update": {
                        "issueCategory": state.get("issue_category", "UNKNOWN"),
                        "severity": state.get("severity_level", "MEDIUM"),
                        "status": db_status,
                        "systemMetadata": {
                            "confidence_metrics": state.get("confidence_metrics", {}),
                            "auth_score": state.get("image_authenticity_score")
                        }
                    }
                }
            )

        # ---------------------------------------------------------
        # 3. UPDATE SCRAPER CACHE (Administrative Hierarchy)
        # ---------------------------------------------------------
        primary_contact = state.get("primary_contact")
        jurisdiction = state.get("jurisdiction_hierarchy", {})
        
        if primary_contact and jurisdiction.get("district") and jurisdiction.get("state"):
            # Update the contact info if we found it via scraping
            email = primary_contact.get("officialEmail")
            if email:
                # Find the jurisdiction row to update
                existing_jurisdiction = await prisma_client.administrativehierarchy.find_first(
                    where={
                        "district": jurisdiction.get("district"),
                        "state": jurisdiction.get("state"),
                        "issueCategory": state.get("issue_category", "UNKNOWN")
                    }
                )
                if existing_jurisdiction:
                    await prisma_client.administrativehierarchy.update(
                        where={"id": existing_jurisdiction.id},
                        data={
                            "officialEmail": email,
                            "status": primary_contact.get("status", "PENDING"),
                            "portalUrl": primary_contact.get("portalUrl")
                        }
                    )

        # ---------------------------------------------------------
        # 4. APPEND IMMUTABLE AUDIT LOGS
        # ---------------------------------------------------------
        status_updates = state.get("status_updates", [])
        error_logs = state.get("error_log", [])
        all_logs = status_updates + error_logs

        for log in all_logs:
            log_id = f"{thread_id}_{log.get('node')}_{log.get('action')}_{log.get('ts')}"
            
            # Fire-and-forget raw SQL insert to easily handle ON CONFLICT DO NOTHING
            await prisma_client.execute_raw(
                """
                INSERT INTO audit_events (id, "threadId", node, action, status, payload, "timestamp")
                VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp)
                ON CONFLICT (id) DO NOTHING
                """,
                log_id, thread_id, log.get("node"), log.get("action", ""), 
                db_status, json.dumps(log), log.get("ts")
            )

    except Exception as e:
        logger.error(f"Failed to sync LangGraph state to Prisma: {e}")