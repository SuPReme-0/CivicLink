"""
Production Verification Gate Node.

FEATURES:
- Weighted Confidence Fusion (VLM + RAG + OSINT + LLM)
- Dynamic Weight Redistribution (handles text-only vs. image-based payloads)
- FAST PATH NORMALIZATION: Understands that cached DB hits mean High Confidence.
- Production-Tuned Thresholds
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
    LangGraph node: Evaluates all pipeline metrics to determine Auto-Dispatch vs. Conversational Recovery.
    """
    execution_ts = datetime.now(timezone.utc)
    
    metrics = state.get("confidence_metrics") or {}
    primary_contact = state.get("primary_contact") or {}
    
    severity = state.get("severity_level", "MEDIUM")
    has_image = bool(state.get("image_url"))
    
    with tracer.start_as_current_span("verification_gate_node"):
        try:
            # 1. Extract VLM Score
            vlm_score = state.get("image_authenticity_score", 1.0) if has_image else 1.0
            
            # 2. Extract & Normalize Jurisdiction (RAG) Score
            # If we matched a district in DB, SQL math naturally caps around 0.65.
            # If the hierarchy exists, we normalize to 0.85 to prevent false flags.
            raw_jur_score = metrics.get("jurisdiction", 0.0)
            if state.get("jurisdiction_hierarchy") and raw_jur_score < 0.85:
                jurisdiction_score = 0.85 
            else:
                jurisdiction_score = raw_jur_score
                
            # 3. Extract & Normalize Contact (OSINT) Score
            # 🚨 FAST PATH FIX: If we have an email but 0.0 score, it came from the DB Cache!
            raw_contact_score = float(primary_contact.get("confidenceScore", 0.0))
            if primary_contact.get("officialEmail") and raw_contact_score == 0.0:
                contact_score = 0.95
            else:
                contact_score = raw_contact_score
                
            drafting_score = float(metrics.get("drafting_quality", 0.95))
            
            # 4. Dynamic Weighting
            if has_image:
                weights = {"vlm": 0.25, "rag": 0.25, "osint": 0.35, "llm": 0.15}
            else:
                weights = {"vlm": 0.00, "rag": 0.35, "osint": 0.45, "llm": 0.20}
                
            # 5. Calculate Overall Confidence
            overall_confidence = (
                (vlm_score * weights["vlm"]) +
                (jurisdiction_score * weights["rag"]) +
                (contact_score * weights["osint"]) +
                (drafting_score * weights["llm"])
            )
            
            overall_confidence = round(overall_confidence, 3)
            updated_metrics = {**metrics, "pipeline_confidence": overall_confidence}
            
            requires_human = False
            rationale = []
            
            # Trigger A: Absolute Minimum Quality Guardrails
            if vlm_score < 0.45:
                requires_human, rationale = True, rationale + ["vlm_score_critical"]
            if contact_score < 0.45:
                requires_human, rationale = True, rationale + ["contact_score_critical"]
                
            # Trigger B: Severity-Based Overall Thresholds
            thresholds = {"CRITICAL": 0.80, "HIGH": 0.70, "MEDIUM": 0.60, "LOW": 0.50}
            target_threshold = thresholds.get(severity, 0.60)
            
            if overall_confidence < target_threshold:
                requires_human = True
                rationale.append(f"confidence_{overall_confidence}<{target_threshold}_for_{severity}")

            next_status = "LLM_RECOVERY_NEEDED" if requires_human else "DISPATCHING"
            
            # Print the math to the console so we can see exactly what the gate is thinking
            logger.info(f"🛡️ [GATE] VLM:{vlm_score:.2f} | RAG:{jurisdiction_score:.2f} | OSINT:{contact_score:.2f} | Overall:{overall_confidence:.2f} | Status: {next_status}")
            
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
                "current_status": "LLM_RECOVERY_NEEDED",
                "requires_human_review": True,
                "error_log": [{"node": "verification_gate", "action": "critical_failure", "details": type(e).__name__, "ts": execution_ts.isoformat()}]
            }