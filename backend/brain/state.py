# backend/brain/state.py
"""
Production-Hardened LangGraph State Definition for CivicLink.

ARCHITECTURAL PRINCIPLES:
- total=False: Enables partial state updates from nodes. LangGraph merges returned keys safely.
- Custom Reducers: Guarantee append-only behavior and prevent NoneType crashes during async execution.
- PII Isolation: `raw_payload` and sensitive config MUST be passed via config["configurable"].
                 They are NEVER stored in this state to prevent PostgresSaver JSONB serialization leaks.
- Routing Decoupling: `next_node_hint` is AUDIT-ONLY. Actual routing is handled by conditional edge functions.
- JSON Safety: All Dict/List values must contain only JSON-serializable primitives (str, int, float, bool, None).
"""

from typing import TypedDict, List, Dict, Optional, Literal, Any, Annotated

# --- CUSTOM SAFE REDUCER ---
# Replaces `operator.add`. Guarantees safe merging even if nodes return None
# or if the key wasn't initialized in the starting state.
def reduce_list(existing: Optional[List[Any]], update: Optional[List[Any]]) -> List[Any]:
    return (existing or []) + (update or [])


class CivicLinkState(TypedDict, total=False):
    """
    The strict, stateful clipboard for the CivicLink LangGraph architecture.
    All fields are designed for async, checkpoint-safe, zero-trust execution.
    """
    # ---------------------------------------------------------
    # 1. CORE ROUTING & SESSION IDENTITY
    # ---------------------------------------------------------
    session_id: str               # Citizen ID (hashed or e.164)
    thread_id: str                # LangGraph checkpoint namespace
    tracking_id: str
        
    # AUDIT-ONLY: Does NOT drive routing. Evaluated natively by edge functions.
    current_node: Optional[str]
    next_node_hint: Optional[Literal[
        "ingest", "vlm_verify", "resolve_jurisdiction", "discover_contact",
        "draft_letter", "verification_gate", "dispatch", "human_review", "__end__"
    ]]
    
    retry_count: int
    max_retries: int
    requires_human_review: bool   # Explicit interrupt flag for Gatekeeper

    # 🚨 NEW: Conversational Memory Fields
    is_grievance_complete: bool
    conversational_reply: Optional[str]
    
    # ---------------------------------------------------------
    # 2. THE INGESTION & ZERO-TRUST VAULT
    # ---------------------------------------------------------
    # ⚠️ raw_payload is intentionally OMITTED here.
    # Pass it via config["configurable"]["raw_payload"] to bypass PostgresSaver JSONB serialization.
    
    extracted_text: str      
    language_metadata: Dict[str, str]  # e.g., {"original": "bn", "translated_en": "..."}
    
    image_url: Optional[str]
    image_hash: Optional[str]          # SHA-256 for deduplication
    vlm_output: Optional[Dict[str, Any]]
    image_authenticity_score: Optional[float]  # Safe default (0.0-1.0)

    # ---------------------------------------------------------
    # 3. JURISDICTION & SEVERITY MAPPING
    # ---------------------------------------------------------
    location_raw: Dict[str, Any]
    jurisdiction_hierarchy: Dict[str, str]  # {ward, municipality, district, state, pincode}
    
    severity_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    issue_category: str
    confidence_metrics: Dict[str, float]    # e.g., {"jurisdiction": 0.95, "vlm": 0.88}

    # ---------------------------------------------------------
    # 4. DISPATCH PREPARATION
    # ---------------------------------------------------------
    # Annotated with reduce_list enforces APPEND-ONLY behavior.
    # Nodes can only add to these lists; they can never overwrite previous data.
    discovered_contacts: Annotated[List[Dict[str, Any]], reduce_list]
    primary_contact: Optional[Dict[str, Any]]
    fallback_portal_url: Optional[str]
    
    visited_urls: Annotated[List[str], reduce_list]
    
    drafted_letter: Dict[str, str]  # {subject, body, legal_citations, language}
    dispatch_channel: Optional[Literal["SMTP", "PORTAL_FORM", "ESCALATION_EMAIL"]]

    # ---------------------------------------------------------
    # 5. WORKFLOW OUTCOMES (Used heavily by routing.py)
    # ---------------------------------------------------------
    dispatch_status: Optional[Literal["QUEUED", "SENT", "DELIVERED", "RETRYING", "FAILED"]]
    human_review_decision: Optional[Literal["APPROVED", "REJECTED", "ESCALATED"]]

    # ---------------------------------------------------------
    # 6. IMMUTABLE AUDIT TRAIL (Reducer-Protected)
    # ---------------------------------------------------------
    # These logs sync directly to the 'audit_events' table via db_sync.py
    error_log: Annotated[List[Dict[str, Any]], reduce_list]
    status_updates: Annotated[List[Dict[str, Any]], reduce_list]
    # Example entry: {"node": "ingest", "action": "payload_sanitized", "ts": "2024-01-01T12:00:00Z", "details": {...}}
