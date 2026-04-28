# backend/brain/routing.py
"""
Production Conditional Edge Logic for CivicLink LangGraph.

ARCHITECTURAL PRINCIPLES:
- Pure functions: Read state -> return Literal NextNode string.
- Zero State Mutation: Edges NEVER update state.
- Conversational Pausing: If the AI gatekeeper needs more info, we halt (__end__).
- Fail-Closed: Unrecognized or missing critical state routes to human_review, NOT __end__.
"""
import logging
from typing import Literal

from backend.brain.state import CivicLinkState
from backend.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# TYPE ALIASES FOR STRICT ROUTING
# ---------------------------------------------------------
NextNode = Literal[
    "ingest", "vlm_verify", "resolve_jurisdiction", "discover_contact",
    "draft_letter", "verification_gate", "dispatch", "human_review", "__end__"
]

def route_after_ingest(state: CivicLinkState) -> NextNode:
    if not state.get("session_id"):
        return "__end__"
        
    if state.get("image_url") and not state.get("vlm_output"):
        logger.info("Router: Unprocessed image detected. Routing to VLM Verify.")
        return "vlm_verify"
        
    if not state.get("is_grievance_complete", False):
        logger.info("Router: Grievance incomplete. Pausing graph for user input.")
        return "__end__"
    
    logger.info("Router: Grievance complete. Proceeding to pipeline.")
    return "resolve_jurisdiction"


def route_after_vlm_verify(state: CivicLinkState) -> NextNode:
    if state.get("current_status") == "FAILED":
        return "__end__"

    if not state.get("is_grievance_complete", False):
        logger.info("Router: Forensics complete. Looping back to Ingest for conversation.")
        return "ingest"

    auth_score = state.get("image_authenticity_score")
    severity = state.get("severity_level", "MEDIUM")
    
    # 🚨 FIX: Safe dictionary fallback for thresholds to prevent AttributeError
    thresholds = getattr(settings, "SEVERITY_THRESHOLDS", {"LOW": 0.6, "HIGH": 0.8})
    
    if auth_score is None or auth_score == 0.0:
        logger.warning("Router: Suspicious or missing auth score. Routing to Human Review.")
        return "human_review"
    
    # Standard threshold check for normal grievances
    if auth_score < thresholds.get("LOW", 0.6):
        logger.info(f"Router: Low auth score ({auth_score}). Routing to Human Review.")
        return "human_review"
        
    # 🚨 FIX: Strict gate for high-severity claims. If it's critical but the image looks 
    # slightly manipulated (score < 0.8), force a human to look at it immediately.
    if auth_score < thresholds.get("HIGH", 0.8) and severity in ("HIGH", "CRITICAL"):
        logger.info(f"Router: High severity claim with mediocre auth score ({auth_score}). Routing to Human Review.")
        return "human_review"
    
    # All verified images now properly continue down the pipeline
    return "resolve_jurisdiction"


def route_after_jurisdiction(state: CivicLinkState) -> NextNode:
    if state.get("current_status") == "FAILED":
        return "__end__"

    hierarchy = state.get("jurisdiction_hierarchy", {})
    confidence = state.get("confidence_metrics", {}).get("jurisdiction", 0.0)
    
    if not hierarchy or not hierarchy.get("district"):
        logger.warning("Router: Jurisdiction mapping failed. Routing to Human Review.")
        return "human_review"
    
    if confidence < 0.7:
        return "human_review"
    
    return "discover_contact"


def route_after_contact_discovery(state: CivicLinkState) -> NextNode:
    if state.get("current_status") == "FAILED":
        return "__end__"

    contacts = state.get("discovered_contacts", [])
    primary = state.get("primary_contact")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    
    if primary and primary.get("verification_status") == "VERIFIED":
        return "draft_letter"
    
    # Relies on contact.py properly incrementing the retry_count in the state
    if contacts and retry_count < max_retries:
        return "discover_contact" 
    
    if state.get("fallback_portal_url") or state.get("dispatch_channel") == "PORTAL_FORM":
        return "draft_letter" 
    
    logger.warning("Router: Contact discovery exhausted. Routing to Human Review.")
    return "human_review"


def route_after_draft_letter(state: CivicLinkState) -> NextNode:
    if state.get("current_status") == "FAILED":
        return "__end__"

    drafted = state.get("drafted_letter")

    if not drafted or not drafted.get("subject"):
        return "human_review"
    
    return "verification_gate"


def route_after_verification_gate(state: CivicLinkState) -> NextNode:
    if state.get("current_status") == "FAILED":
        return "__end__"

    auth_score = state.get("image_authenticity_score", 1.0)
    severity = state.get("severity_level", "MEDIUM")
    confidence = state.get("confidence_metrics", {}).get("pipeline_confidence", 1.0)
    
    requires_human = state.get("requires_human_review", False)
    retry_count = state.get("retry_count", 0)
    
    if requires_human:
        return "human_review"
    
    if severity == "CRITICAL" and confidence >= 0.9:
        return "dispatch" 
    
    if auth_score < 0.7 or confidence < 0.7:
        return "human_review"
    
    if severity in ("HIGH", "CRITICAL") and confidence < 0.9:
        return "human_review"
    
    if retry_count >= state.get("max_retries", 3):
        return "human_review"
    
    return "dispatch"


def route_after_dispatch(state: CivicLinkState) -> NextNode:
    dispatch_status = state.get("dispatch_status")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    
    if dispatch_status in ("SENT", "DELIVERED", "PORTAL_SUBMITTED"):
        return "__end__"
    
    if dispatch_status in ("QUEUED", "RETRYING") and retry_count < max_retries:
        return "dispatch"
    
    return "__end__"


def route_after_human_review(state: CivicLinkState) -> NextNode:
    decision = state.get("human_review_decision")
    
    if decision != "APPROVED":
        return "__end__" 
    
    # 🚨 SMART RESUMPTION: Figure out where the pipeline was interrupted 
    # and resume at the earliest missing step.
    
    # 1. If Jurisdiction is missing, resume there
    if not state.get("jurisdiction_hierarchy", {}).get("district"):
        return "resolve_jurisdiction"
        
    # 2. If Jurisdiction exists but Contact is missing, resume Contact Discovery
    if not state.get("primary_contact", {}).get("officialEmail"):
        return "discover_contact"
        
    # 3. If Contact exists but Letter is missing, resume Drafting
    if not state.get("drafted_letter", {}).get("subject"):
        return "draft_letter"
        
    # 4. If everything is present (e.g. paused purely due to Verification Gate severity)
    return "dispatch"

# Central registry for workflow.py wiring
ROUTING_EDGES = {
    "ingest": route_after_ingest,
    "vlm_verify": route_after_vlm_verify,
    "resolve_jurisdiction": route_after_jurisdiction,
    "discover_contact": route_after_contact_discovery,
    "draft_letter": route_after_draft_letter,
    "verification_gate": route_after_verification_gate,
    "dispatch": route_after_dispatch,
    "human_review": route_after_human_review,
}