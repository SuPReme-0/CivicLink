"""
Agentic OSINT Seeder Node.

Triggered when the RAG engine encounters a blind spot. 
Uses the 70B Model via Pydantic Structured Outputs to hypothesize the municipal structure.

FEATURES:
- Context Awareness: Reads the full compiled_summary.
- Strict Python Validation: Restored the Iron Gate to prevent cross-state hallucinations.
- Agentic Self-Correction: Argues with the 70B model if it hallucinates invalid geography.
"""
import logging
import uuid
from typing import Dict, Any, List
from datetime import datetime, timezone
from langgraph.config import RunnableConfig

from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage

from backend.brain.state import CivicLinkState
from backend.core.observability import get_tracer
from backend.core.db import prisma
from backend.core.llm import get_llm  
from backend.brain.nodes.jurisdiction import _generate_embedding

logger = logging.getLogger(__name__)
tracer = get_tracer("osint_seeder")

# ---------------------------------------------------------
# STRICT VALIDATION HELPERS
# ---------------------------------------------------------
def _is_valid_geo(val: Any) -> bool:
    if not val: return False
    return str(val).strip().lower() not in ["unknown", "null", "none", "n/a", "undefined", ""]

VALID_INDIAN_STATES = [
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
    "delhi", "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand",
    "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur",
    "meghalaya", "mizoram", "nagaland", "odisha", "punjab", "rajasthan",
    "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh",
    "uttarakhand", "west bengal", "andaman and nicobar islands",
    "chandigarh", "dadra and nagar haveli and daman and diu",
    "lakshadweep", "puducherry", "jammu and kashmir", "ladakh"
]

def _is_indian_state(state_val: Any) -> bool:
    if not _is_valid_geo(state_val): return False
    return str(state_val).strip().lower() in VALID_INDIAN_STATES

# ---------------------------------------------------------
# 1. PYDANTIC SCHEMAS FOR 70B STRUCTURED OUTPUT
# ---------------------------------------------------------
class RoutingCandidate(BaseModel):
    district: str = Field(description="Exact valid Indian District Name.")
    state: str = Field(description="Exact valid Indian State Name.")
    municipality: str = Field(description="Municipal Corporation, Panchayat, or Development Authority Name.")
    issueCategory: str = Field(description="Category of the issue.")
    officialDesignation: str = Field(description="Title of the official.")

class SeederHypotheses(BaseModel):
    candidates: List[RoutingCandidate] = Field(
        description="Provide EXACTLY 3 candidates: 1. Primary Municipal Body, 2. State Level Department, 3. Fallback Authority."
    )

SEEDER_PROMPT = """
You are an elite Indian Geography and Municipal Governance AI.
Your task is to hypothesize the 3 most likely government bodies responsible for an issue.

CRITICAL INSTRUCTION: You MUST use the EXACT State and District provided in the prompt context. 
Do NOT invent them. Do NOT output "Unknown". Do NOT deduce a different location.
"""

# ---------------------------------------------------------
# 2. THE NODE EXECUTION
# ---------------------------------------------------------
async def osint_seeder_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    execution_ts = datetime.now(timezone.utc)
    
    # 🚨 BUG FIX: Use compiled_summary so the LLM knows what the issue actually is!
    issue_desc = state.get("compiled_summary") or state.get("extracted_text", "Unknown Issue")
    
    jurisdiction_seed = state.get("jurisdiction_hierarchy", {})
    target_state = jurisdiction_seed.get("state", "")
    target_district = jurisdiction_seed.get("district", "")
    target_category = jurisdiction_seed.get("issueCategory", state.get("issue_category", "GENERAL"))
    
    with tracer.start_as_current_span("osint_seeder_node") as span:
        logger.info("\n🌱 [SEEDER NODE] Initiating Autonomous Database Expansion with 70B...")
        
        try:
            # 🚨 BUG FIX: The Pre-Execution Gate (Restored)
            if not _is_indian_state(target_state) or not _is_valid_geo(target_district):
                raise ValueError(f"Seeder aborted: Upstream node passed invalid geography (State: {target_state}, District: {target_district})")

            # 1. Build the Conversational Context
            human_prompt = f"Issue: {target_category} - {issue_desc}\nREQUIRED STATE: {target_state}\nREQUIRED DISTRICT: {target_district}\nGenerate the routing schema using ONLY this exact state and district."
            
            messages = [
                SystemMessage(content=SEEDER_PROMPT),
                HumanMessage(content=human_prompt)
            ]
            
            llm = get_llm()
            structured_llm = llm.with_structured_output(SeederHypotheses)
            
            final_candidates = []
            max_llm_attempts = 3
            
            logger.info("🧠 [SEEDER] Consulting 70B Model for geographic deduction and structured routing...")
            
            for attempt in range(max_llm_attempts):
                try:
                    response: SeederHypotheses = await structured_llm.ainvoke(messages)
                    candidates = response.candidates
                    
                    if not candidates:
                        raise ValueError("Output must contain at least one routing candidate.")

                    # 🚨 BUG FIX: The Iron Wall (Restored)
                    for idx, candidate in enumerate(candidates):
                        if candidate.state.lower().strip() != target_state.lower().strip():
                            raise ValueError(f"State mismatch at index {idx}. Expected '{target_state}', got '{candidate.state}'.")
                        if candidate.district.lower().strip() != target_district.lower().strip():
                            raise ValueError(f"District mismatch at index {idx}. Expected '{target_district}', got '{candidate.district}'.")
                    
                    final_candidates = candidates
                    logger.info(f"✅ [SEEDER] Deduced and validated {len(final_candidates)} structural candidates on attempt {attempt + 1}.")
                    break 
                    
                except Exception as e:
                    logger.warning(f"⚠️ [SEEDER] Validation failed on attempt {attempt + 1}: {str(e)}. Forcing 70B to self-correct...")
                    messages.append(HumanMessage(content=f"Validation Error: {str(e)}\nPlease correct the output. You MUST strictly use '{target_state}' for the state and '{target_district}' for the district."))
                    
                    if attempt == max_llm_attempts - 1:
                        raise RuntimeError("70B Model exhausted all self-correction attempts and failed to comply with requested geography.")

            # 3. Connect to DB and Inject Validated Data
            if not prisma.is_connected():
                await prisma.connect()

            seeded_records = []
            
            for candidate in final_candidates:
                semantic_text = f"{candidate.issueCategory} {candidate.district} {candidate.state} {candidate.municipality}"
                
                logger.info(f"🧬 [SEEDER] Generating vector for: {semantic_text}")
                vector = await _generate_embedding(semantic_text)
                vector_str = f"[{','.join(map(str, vector.tolist()))}]"
                
                new_id = str(uuid.uuid4())
                
                result = await prisma.query_raw(
                    """
                    INSERT INTO administrative_hierarchy 
                    ("id", "district", "state", "municipality", "issueCategory", "officialDesignation", "embedding") 
                    VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
                    RETURNING id
                    """,
                    new_id,
                    candidate.district,
                    candidate.state,
                    candidate.municipality,
                    candidate.issueCategory,
                    candidate.officialDesignation,
                    vector_str
                )
                
                if result:
                    record_dict = candidate.model_dump()
                    record_dict["id"] = result[0]['id']
                    seeded_records.append(record_dict)

            logger.info(f"🎉 [SEEDER] Successfully injected {len(seeded_records)} new routing pathways into Postgres.")

            best_candidate = seeded_records[0]
            
            return {
                "current_status": "DISCOVERING_CONTACT",
                "jurisdiction_hierarchy": {
                    "id": best_candidate["id"],
                    "district": best_candidate["district"],
                    "state": best_candidate["state"],
                    "municipality": best_candidate["municipality"],
                    "issueCategory": best_candidate["issueCategory"],
                    "officialDesignation": best_candidate["officialDesignation"]
                },
                "status_updates": [{
                    "node": "osint_seeder",
                    "action": "database_expanded",
                    "candidates_added": len(seeded_records),
                    "ts": execution_ts.isoformat()
                }]
            }

        except Exception as e:
            logger.error(f"❌ [SEEDER] Autonomous expansion failed: {str(e)}", exc_info=True)
            span.record_exception(e)
            
            return {
                "current_status": "LLM_RECOVERY_NEEDED", 
                "error_log": [{
                    "node": "osint_seeder",
                    "action": "seeding_failure",
                    "details": str(e),
                    "ts": execution_ts.isoformat()
                }]
            }