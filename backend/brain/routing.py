"""
Production Conditional Edge Logic for CivicLink LangGraph.

ARCHITECTURAL PRINCIPLES:
- Pure functions: Read state -> return Literal NextNode string.
- Zero State Mutation: Edges NEVER update state.
- Circuit Breaker: If ANY downstream node fails or exhausts retries, we return "__end__".
  This physically halts the graph, prevents infinite loops, and protects API quotas.
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
    "ingest", "vlm_verify", "resolve_jurisdiction", "osint_seeder", "discover_contact",
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
        return "ingest"

    auth_score = state.get("image_authenticity_score")
    severity = state.get("severity_level", "MEDIUM")
    thresholds = getattr(settings, "SEVERITY_THRESHOLDS", {"LOW": 0.6, "HIGH": 0.8})
    
    # 🚨 CIRCUIT BREAKER: Halt if VLM fails criteria
    if auth_score is None or auth_score == 0.0 or auth_score < thresholds.get("LOW", 0.6):
        logger.warning("Router: VLM rejected image. Halting graph.")
        return "__end__"
        
    if auth_score < thresholds.get("HIGH", 0.8) and severity in ("HIGH", "CRITICAL"):
        logger.warning("Router: High severity but low image confidence. Halting graph.")
        return "__end__"
    
    return "resolve_jurisdiction"


def route_after_jurisdiction(state: CivicLinkState) -> NextNode:
    status = state.get("current_status")
    
    # 🚨 CIRCUIT BREAKER: Halt on Ambiguity or Failure
    if status in ["FAILED", "PENDING_DETAILS", "AWAITING_USER_INPUT"]:
        logger.info("Router: Location ambiguous or RAG failed. Halting graph.")
        return "__end__"

    hierarchy = state.get("jurisdiction_hierarchy") or {}
    metrics = state.get("confidence_metrics") or {}
    confidence = metrics.get("jurisdiction", 0.0)
    seeder_retries = state.get("seeder_retry_count", 0)
    
    if not hierarchy or not hierarchy.get("district") or confidence < 0.7:
        if seeder_retries < 3:
            logger.info(f"Router: Jurisdiction low confidence. Launching OSINT Seeder (Attempt {seeder_retries + 1}/3)")
            return "osint_seeder"
        else:
            logger.warning("Router: OSINT Seeder exhausted 3 attempts. Halting graph.")
            return "__end__"

    return "discover_contact"


def route_after_osint_seeder(state: CivicLinkState) -> NextNode:
    status = state.get("current_status")
    
    # 🚨 CIRCUIT BREAKER
    if status in ["FAILED", "LLM_RECOVERY_NEEDED", "AWAITING_REVIEW"]:
        logger.warning(f"Router: Seeder failed with status {status}. Halting graph.")
        return "__end__"
    
    return "discover_contact"


def route_after_contact_discovery(state: CivicLinkState) -> NextNode:
    status = state.get("current_status")
    
    # 🚨 CIRCUIT BREAKER
    if status in ["FAILED", "AWAITING_REVIEW", "LLM_RECOVERY_NEEDED"]:
        logger.warning(f"Router: Spider failed with status {status}. Halting graph.")
        return "__end__"

    primary = state.get("primary_contact") or {}
    if primary and primary.get("officialEmail"):
        return "draft_letter"
    
    if status == "SEEDER_RETRY":
        seeder_retries = state.get("seeder_retry_count", 0)
        if seeder_retries < 3:
            logger.warning(f"Router: Spider found no emails. Looping back to Seeder (Attempt {seeder_retries}/3)")
            return "osint_seeder"
        else:
            logger.warning("Router: Seeder retries exhausted. Halting graph.")
            return "__end__"
            
    spider_retries = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    
    if status == "RETRYING" and spider_retries < max_retries:
        logger.warning(f"Router: Spider execution failed. Retrying scrape (Attempt {spider_retries + 1}/{max_retries})")
        return "discover_contact"
    
    logger.warning(f"Router: Unhandled spider state '{status}'. Halting graph.")
    return "__end__"


def route_after_draft_letter(state: CivicLinkState) -> NextNode:
    # 🚨 CIRCUIT BREAKER
    if state.get("current_status") == "FAILED":
        logger.warning("Router: Drafting failed (API Limits/Error). Halting graph.")
        return "__end__"

    drafted = state.get("drafted_letter") or {}
    if not drafted or not drafted.get("subject"):
        logger.warning("Router: Drafting completed but letter is empty. Halting graph.")
        return "__end__"
    
    return "verification_gate"

def route_after_verification_gate(state: CivicLinkState) -> NextNode:
    # 1. Check for hard node failures first
    if state.get("current_status") == "FAILED":
        logger.warning("Router: Verification Gate node crashed. Halting graph.")
        return "__end__"

    # 2. 🚨 THE FIX: Read the hard boolean, ignore the volatile string
    requires_human = state.get("requires_human_review", False)
    
    if not requires_human:
        logger.info("Router: Gate approved (requires_human=False). Routing to Dispatch.")
        return "dispatch"
        
    # If requires_human is True (or if something else went wrong)
    logger.warning(f"Router: Verification Gate flagged pipeline (requires_human={requires_human}). Halting graph.")
    return "__end__"

def route_after_dispatch(state: CivicLinkState) -> NextNode:
    dispatch_status = state.get("dispatch_status")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    
    if dispatch_status in ("SENT", "DELIVERED", "PORTAL_SUBMITTED"):
        return "__end__"
    
    if dispatch_status in ("QUEUED", "RETRYING") and retry_count < max_retries:
        return "dispatch"
        
    # 🚨 CIRCUIT BREAKER
    logger.warning("Router: Dispatch completely failed or exhausted retries. Halting graph.")
    return "__end__"


def route_after_human_review(state: CivicLinkState) -> NextNode:
    """Dummy node strictly to satisfy `workflow.py` hardcoded edges."""
    return "ingest"

# ---------------------------------------------------------
# CENTRAL REGISTRY 
# ---------------------------------------------------------
ROUTING_EDGES = {
    "ingest": route_after_ingest,
    "vlm_verify": route_after_vlm_verify,
    "resolve_jurisdiction": route_after_jurisdiction,
    "osint_seeder": route_after_osint_seeder,
    "discover_contact": route_after_contact_discovery,
    "draft_letter": route_after_draft_letter,
    "verification_gate": route_after_verification_gate,
    "dispatch": route_after_dispatch,
    "human_review": route_after_human_review,
}