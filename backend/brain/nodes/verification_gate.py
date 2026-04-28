# backend/brain/nodes/verification_gate.py
"""
Production Verification Gate Node.

FEATURES:
- Weighted Confidence Fusion (VLM + RAG + OSINT + LLM)
- Dynamic Weight Redistribution (handles text-only vs. image-based payloads)
- Severity-based Thresholding (CRITICAL requires 90%+ confidence)
- Strict Fail-Safe: Single-metric failures trigger mandatory human review
"""
import logging
from datetime import datetime, timezone
from langgraph.config import RunnableConfig

from backend.brain.state import CivicLinkState
from backend.core.observability import get_tracer

logger = logging.getLogger(__name__)
tracer = get_tracer("verification_gate")

async def verification_gate_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    """
    LangGraph node: Evaluates all pipeline metrics to determine Auto-Dispatch vs. Human Review.
    """
    execution_ts = datetime.now(timezone.utc)
    
    # 🚨 FIX: Safe extraction to prevent NoneType attribute errors
    metrics = state.get("confidence_metrics") or {}
    primary_contact = state.get("primary_contact") or {}
    
    severity = state.get("severity_level", "MEDIUM")
    has_image = bool(state.get("image_url"))
    
    with tracer.start_as_current_span("verification_gate_node"):
        try:
            # 1. Extract Individual Component Scores
            vlm_score = metrics.get("vlm_verification", 1.0) if has_image else 1.0
            jurisdiction_score = metrics.get("jurisdiction", 0.0)
            contact_score = primary_contact.get("confidenceScore", 0.0)
            drafting_score = metrics.get("drafting_quality", 0.95)
            
            # 2. Dynamic Weighting (Redistribute VLM weight if no image was provided)
            if has_image:
                weights = {"vlm": 0.30, "rag": 0.30, "osint": 0.30, "llm": 0.10}
            else:
                weights = {"vlm": 0.00, "rag": 0.45, "osint": 0.45, "llm": 0.10}
                
            # 3. Calculate Overall Confidence
            overall_confidence = (
                (vlm_score * weights["vlm"]) +
                (jurisdiction_score * weights["rag"]) +
                (contact_score * weights["osint"]) +
                (drafting_score * weights["llm"])
            )
            
            overall_confidence = round(overall_confidence, 3)
            
            # 🚨 FIX: Renamed key to prevent clobbering the VLM's 'overall' image score
            updated_metrics = {**metrics, "pipeline_confidence": overall_confidence}
            
            # 4. Mandatory Human Review Triggers
            requires_human = False
            rationale = []
            
            # Trigger A: Single-Component Failure (Weakest Link Rule)
            if vlm_score < 0.6:
                requires_human, rationale = True, rationale + ["vlm_score_critical"]
            if jurisdiction_score < 0.6:
                requires_human, rationale = True, rationale + ["jurisdiction_score_critical"]
            if contact_score < 0.6:
                requires_human, rationale = True, rationale + ["contact_score_critical"]
                
            # Trigger B: Severity-Based Overall Thresholds
            thresholds = {"CRITICAL": 0.90, "HIGH": 0.85, "MEDIUM": 0.75, "LOW": 0.70}
            target_threshold = thresholds.get(severity, 0.75)
            
            if overall_confidence < target_threshold:
                requires_human = True
                rationale.append(f"confidence_{overall_confidence}<{target_threshold}_for_{severity}")

            # 5. Route State
            next_status = "AWAITING_REVIEW" if requires_human else "DISPATCHING"
            
            return {
                "current_status": next_status, 
                "confidence_metrics": updated_metrics,
                "requires_human_review": requires_human,
                "status_updates": [{
                    "node": "verification_gate",
                    "action": "gate_evaluated",
                    "overall_confidence": overall_confidence,
                    "requires_human": requires_human,
                    "rationale": ",".join(rationale) if rationale else "auto_approved",
                    "ts": execution_ts.isoformat()
                }]
            }
            
        except Exception as e:
            logger.exception(f"Verification Gate critical failure: {e}")
            return {
                "current_status": "AWAITING_REVIEW",
                "requires_human_review": True,
                "error_log": [{"node": "verification_gate", "action": "critical_failure", "details": type(e).__name__, "ts": execution_ts.isoformat()}]
            }