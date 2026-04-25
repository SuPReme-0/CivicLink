# backend/brain/routing.py
"""
Production Conditional Edge Logic for CivicLink LangGraph.

ARCHITECTURAL PRINCIPLES:
- Pure functions: Read state -> return Literal NextNode string.
- Zero State Mutation: Edges NEVER update state.
- Fail-Closed: Unrecognized or missing critical state routes to __end__ or human_review.
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
    
    if state.get("image_url"):
        return "vlm_verify"
    
    return "resolve_jurisdiction"


def route_after_vlm_verify(state: CivicLinkState) -> NextNode:
    auth_score = state.get("image_authenticity_score")
    severity = state.get("severity_level", "MEDIUM")
    
    if auth_score is None:
        return "__end__"
    
    if severity == "CRITICAL":
        return "verification_gate" 
    
    if auth_score < settings.SEVERITY_THRESHOLDS.get("LOW", 0.6):
        return "human_review"
    
    if auth_score < settings.SEVERITY_THRESHOLDS.get("HIGH", 0.8) and severity == "HIGH":
        return "verification_gate"
    
    return "resolve_jurisdiction"


def route_after_jurisdiction(state: CivicLinkState) -> NextNode:
    hierarchy = state.get("jurisdiction_hierarchy", {})
    confidence = state.get("confidence_metrics", {}).get("jurisdiction", 0.0)
    
    if not hierarchy or not hierarchy.get("district"):
        return "human_review"
    
    if confidence < 0.7:
        return "human_review"
    
    return "discover_contact"


def route_after_contact_discovery(state: CivicLinkState) -> NextNode:
    contacts = state.get("discovered_contacts", [])
    primary = state.get("primary_contact")
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    
    if primary and primary.get("verification_status") == "VERIFIED":
        return "draft_letter"
    
    if contacts and retry_count < max_retries:
        return "discover_contact" 
    
    if state.get("fallback_portal_url") or state.get("dispatch_channel") == "PORTAL_FORM":
        return "draft_letter" 
    
    return "human_review"


def route_after_draft_letter(state: CivicLinkState) -> NextNode:
    """
    Route drafted letters to verification gate.
    Ensures no unverified dispatch occurs.
    """
    drafted = state.get("drafted_letter")

    if not drafted or not drafted.get("subject"):
        return "human_review"
    
    # All drafts must pass verification gate before dispatch
    return "verification_gate"


def route_after_verification_gate(state: CivicLinkState) -> NextNode:
    auth_score = state.get("image_authenticity_score", 0.0)
    severity = state.get("severity_level", "MEDIUM")
    confidence = state.get("confidence_metrics", {}).get("overall", 0.0)
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
    
    if dispatch_status in ("SENT", "DELIVERED"):
        return "__end__"
    
    if dispatch_status in ("QUEUED", "RETRYING") and retry_count < max_retries:
        return "dispatch"
    
    return "__end__"


def route_after_human_review(state: CivicLinkState) -> NextNode:
    decision = state.get("human_review_decision")
    
    if decision is None:
        return "__end__" 
    
    if decision == "APPROVED":
        return "dispatch"
    
    return "__end__"

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