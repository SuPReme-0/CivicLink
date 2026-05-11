"""
Production RAG Engine for Jurisdiction Resolution.

FEATURES:
- Non-blocking Threaded Model Instantiation
- 8B LLM-Powered Address Extraction with Strict Conversational Filtering
- 70B Omniscient Geo-Resolver (Replaces brittle external Geocoding & Web Scraping)
- Strict Ambiguity Gating: Halts and asks the user if location is too vague
- Cascading Deterministic SQL (Ward -> Municipality -> District)
- Data Starvation Fix: Passes strict hierarchy to OSINT Seeder
"""
import asyncio
import logging
import json
import re
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
from langgraph.config import RunnableConfig
from pydantic import BaseModel, Field

from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer
from backend.core.db import prisma  
from backend.core.llm import get_llm, get_fast_llm

logger = logging.getLogger(__name__)
tracer = get_tracer("jurisdiction")

# ---------------------------------------------------------
# STRICT LOCATION VALIDATOR
# ---------------------------------------------------------
def _is_valid_geo(val: Any) -> bool:
    if not val:
        return False
    clean_val = str(val).strip().lower()
    if clean_val in ["unknown", "null", "none", "n/a", "undefined", ""]:
        return False
    return True

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
# 8B & 70B GEOGRAPHIC INTELLIGENCE
# ---------------------------------------------------------
geolocator = Nominatim(user_agent="civiclink_production_router_v11")

class GeographicContext(BaseModel):
    """8B Extractor Schema: Filters out conversational junk."""
    ward_or_street: Optional[str] = Field(description="Specific neighborhood, ward, street, or landmark. Null if absent.")
    city_or_district: Optional[str] = Field(description="City, town, or district name. Null if absent.")
    state: Optional[str] = Field(description="Indian State name. Null if absent.")
    has_actionable_geography: bool = Field(description="True ONLY if a specific city, district, or state is explicitly named. False if the text only contains vague terms like 'my house' or 'outside the gate'.")

class GeographicResolution(BaseModel):
    """70B Resolver Schema: Maps clues to strict administrative layers."""
    state: str = Field(description="Exact valid Indian State or UT name.")
    district: str = Field(description="Exact official District name.")
    municipality: Optional[str] = Field(description="Municipal Corporation, Development Authority, or City name.")
    ward: Optional[str] = Field(description="Specific ward, sector, or locality name.")

async def _analyze_location_context(text: str) -> Optional[GeographicContext]:
    """Uses the 8B LLM to filter out conversational junk and extract pure addresses."""
    llm = get_fast_llm()
    try:
        structured = llm.with_structured_output(GeographicContext)
        res = await structured.ainvoke(
            f"Analyze the following text. Extract formal geographic entities. Ignore conversational filler (e.g. 'outside my gate').\nTEXT: {text}"
        )
        return res
    except Exception as e:
        logger.warning(f"8B Address extraction failed: {e}")
        return None

async def _ai_geographic_resolution(location_clues: str) -> Dict[str, str]:
    """
    🚨 THE UPGRADE: Uses 70B LLM as an omniscient gazetteer to map addresses/coordinates 
    directly to Indian Districts and States without web scraping.
    """
    llm = get_llm() # 70B Model
    structured = llm.with_structured_output(GeographicResolution)
    
    prompt = f"""
    You are an elite Indian Geography mapping engine.
    Convert the following location clues into a strict Indian administrative hierarchy.
    
    RULES:
    1. MUST be within India. If it maps to a foreign location (e.g., Iowa, USA), return "Unknown" for state and district.
    2. Resolve local landmarks or neighborhoods (e.g., "Action Area 1, New Town") to their correct official District (e.g., "North 24 Parganas") and State (e.g., "West Bengal").
    3. Do NOT hallucinate. If the clues are completely insufficient to determine a district, return "Unknown".
    
    CLUES:
    {location_clues}
    """
    try:
        res = await structured.ainvoke(prompt)
        logger.info(f"🧠 70B Geo-Resolver output: {res.model_dump()}")
        return res.model_dump()
    except Exception as e:
        logger.error(f"70B Geo-Resolution failed: {e}")
        return {"state": "Unknown", "district": "Unknown", "municipality": "", "ward": ""}

async def _reverse_geocode_to_string(lat: float, lon: float) -> Optional[str]:
    """Uses Nominatim ONLY to convert raw GPS into a base string for the 70B model to read."""
    def _geocode():
        try: 
            loc = geolocator.reverse((lat, lon), exactly_one=True, language="en", timeout=5)
            return loc.address if loc else None
        except: 
            return None
    return await asyncio.to_thread(_geocode)

# ---------------------------------------------------------
# EMBEDDINGS & DB
# ---------------------------------------------------------
_embedding_model: Optional[SentenceTransformer] = None
_embedding_lock = asyncio.Lock()

def _load_model_sync(model_name: str, device: str, cache_dir: Path) -> SentenceTransformer:
    model = SentenceTransformer(model_name, device=device, cache_folder=str(cache_dir))
    model.eval()
    return model

async def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        async with _embedding_lock:
            if _embedding_model is None:
                device = "cuda" if getattr(settings, "ENABLE_GPU_EMBEDDINGS", False) else "cpu"
                model_name = getattr(settings, "EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
                cache_dir = Path(getattr(settings, "MODEL_CACHE_DIR", "data/models")) / "sentence_transformers"
                cache_dir.mkdir(parents=True, exist_ok=True)
                _embedding_model = await asyncio.to_thread(_load_model_sync, model_name, device, cache_dir)
    return _embedding_model

async def _generate_embedding(text: str) -> np.ndarray:
    model = await _get_embedding_model()
    return await asyncio.to_thread(model.encode, text, normalize_embeddings=True)

async def _ensure_db_connection():
    if not prisma.is_connected(): await prisma.connect()
    try: await asyncio.wait_for(prisma.query_raw("SELECT 1"), timeout=3.0)
    except:
        await prisma.disconnect()
        await prisma.connect()

async def _search_jurisdiction_cascading(embedding: np.ndarray, geo_data: Dict[str, str]) -> List[Tuple[Dict[str, Any], float]]:
    await _ensure_db_connection()
    embedding_str = f"[{','.join(map(str, embedding.tolist()))}]"
    vector_threshold = getattr(settings, "JURISDICTION_VECTOR_THRESHOLD", 0.60)
    
    district = geo_data.get("district")
    municipality = geo_data.get("municipality")
    ward = geo_data.get("ward")
    state = geo_data.get("state")

    state_filter = "OR \"state\" ILIKE $6" if state else ""

    query = f"""
        SELECT id, ward, municipality, district, state, 
               "issueCategory", "officialDesignation",
               (embedding <=> $1::vector) AS semantic_distance,
               CASE
                   WHEN "ward" ILIKE $4 THEN 1.0       
                   WHEN "municipality" ILIKE $3 THEN 0.8 
                   WHEN "district" ILIKE $2 THEN 0.5   
                   ELSE 0.1                            
               END as geo_score
        FROM administrative_hierarchy
        WHERE (embedding <=> $1::vector) < $5 
          AND ("district" ILIKE $2 OR "municipality" ILIKE $3 {state_filter})
        ORDER BY geo_score DESC, semantic_distance ASC
        LIMIT 10
    """
    
    params = [
        embedding_str, 
        f"%{district}%" if _is_valid_geo(district) else "UNKNOWN_DB_FLAG", 
        f"%{municipality}%" if _is_valid_geo(municipality) else "UNKNOWN_DB_FLAG",
        f"%{ward}%" if _is_valid_geo(ward) else "UNKNOWN_DB_FLAG",
        vector_threshold
    ]
    if state: params.append(f"%{state}%")

    try: results = await asyncio.wait_for(prisma.query_raw(query, *params), timeout=10.0)
    except Exception as e: return []
    
    if not results: return []

    scored_results = []
    for row in results:
        vector_score = max(0.0, 1.0 - float(row.get("semantic_distance", 1.0)))
        geo_score = float(row.get("geo_score", 0.1))
        final_score = (geo_score * 0.7) + (vector_score * 0.3)
        scored_results.append((row, final_score))
        
    scored_results.sort(key=lambda x: x[1], reverse=True)
    return scored_results

# ---------------------------------------------------------
# THE GRAPH NODE
# ---------------------------------------------------------
async def resolve_jurisdiction_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    extracted_text = state.get("extracted_text", "")
    compiled_summary = state.get("compiled_summary", "")
    location_raw = state.get("location_raw", {})
    issue_category = state.get("issue_category", "GENERAL")
    
    execution_ts = datetime.now(timezone.utc)
    existing_metrics = state.get("confidence_metrics", {})
    
    with tracer.start_as_current_span("jurisdiction_node") as span:
        try:
            geo_data = {}
            location_clues = []
            
            # 1. Gather GPS Clues
            if location_raw and location_raw.get("type") == "gps":
                lat, lon = location_raw.get("lat"), location_raw.get("lon")
                if lat and lon:
                    gps_string = await _reverse_geocode_to_string(lat, lon)
                    if gps_string:
                        location_clues.append(f"GPS Reverse Geocode: {gps_string}")
                    
            # 2. Gather Text Clues
            if compiled_summary or extracted_text:
                search_context = f"Latest Input: {extracted_text}. History: {compiled_summary}"
                geo_extracted = await _analyze_location_context(search_context)
                
                if geo_extracted and geo_extracted.has_actionable_geography:
                    clean_parts = [p for p in [geo_extracted.ward_or_street, geo_extracted.city_or_district, geo_extracted.state] if p]
                    search_string = ", ".join(clean_parts)
                    location_clues.append(f"User Text: {search_string}")

            # 3. Omniscient 70B Resolution
            if not location_clues:
                logger.warning("No actionable geography found in text context or GPS. Bypassing 70B Resolver.")
            else:
                combined_clues = " | ".join(location_clues)
                logger.info(f"🌐 70B Geographic Resolution processing clues: {combined_clues}")
                geo_data = await _ai_geographic_resolution(combined_clues)

            # 🚨 THE IRON AMBIGUITY GATE
            state_val = geo_data.get("state") if geo_data else None
            district_val = geo_data.get("district") if geo_data else None
            
            if not _is_indian_state(state_val) or not _is_valid_geo(district_val):
                logger.warning(f"Ambiguity Gate Triggered (Invalid Indian Geography). State: {state_val}, District: {district_val}")
                return {
                    "current_status": "PENDING_DETAILS", 
                    "status_updates": [{
                        "node": "jurisdiction",
                        "action": "halted_ambiguous_location",
                        "ts": execution_ts.isoformat()
                    }],
                    "conversational_reply": "I understand the issue, but I cannot accurately map that location within India. Could you please share your exact GPS location (via map pin) or provide the specific city and state name?"
                }

            normalized_text = re.sub(r"[^\w\s]", " ", extracted_text).strip().lower()
            embedding = await _generate_embedding(f"{issue_category} {normalized_text}")
            
            candidates = await _search_jurisdiction_cascading(embedding=embedding, geo_data=geo_data)
            
            jurisdiction = None
            confidence = 0.0
            rationale = "no_candidates_found"
            
            if candidates:
                best_row, best_score = candidates[0]
                confidence = round(best_score, 3)
                
                if best_score >= 0.50: 
                    jurisdiction = {
                        "id": best_row.get("id"),
                        "ward": best_row.get("ward"),
                        "municipality": best_row.get("municipality"),
                        "district": best_row.get("district"),
                        "state": best_row.get("state"),
                        "issueCategory": best_row.get("issueCategory"),
                        "officialDesignation": best_row.get("officialDesignation")
                    }
                    rationale = f"strict_geo_cascade:{best_score:.3f}"
                else:
                    rationale = f"insufficient_geographic_granularity:{best_score:.3f}"

            status_update = {
                "node": "jurisdiction",
                "action": "resolved" if jurisdiction else "unresolved",
                "confidence": confidence,
                "rationale": rationale,
                "candidates_count": len(candidates),
                "ts": execution_ts.isoformat()
            }
            updated_metrics = {**existing_metrics, "jurisdiction": confidence}

            if jurisdiction:
                official_title = jurisdiction.get('officialDesignation', 'the relevant official')
                local_area = jurisdiction.get('ward') or jurisdiction.get('municipality') or jurisdiction.get('district')
                dept = jurisdiction.get('issueCategory', 'department')
                
                return {
                    "current_status": "DISCOVERING_CONTACT", 
                    "jurisdiction_hierarchy": jurisdiction, 
                    "confidence_metrics": updated_metrics,
                    "status_updates": [status_update],
                    "conversational_reply": f"Perfect. I've pinpointed your location in {local_area}, {state_val} and mapped it to the {dept}. I am now pinging the database to get the direct contact for {official_title}. Stand by."
                }
            else:
                seed_jurisdiction = {
                    "ward": geo_data.get("ward") or "",
                    "municipality": geo_data.get("municipality") or "",
                    "district": geo_data.get("district") or "",
                    "state": geo_data.get("state") or "",
                    "issueCategory": issue_category,
                    "officialDesignation": "Concerned Authority"
                }
                
                missing_location = []
                if geo_data.get('ward'): missing_location.append(f"Ward {geo_data['ward']}")
                if geo_data.get('municipality'): missing_location.append(geo_data['municipality'])
                if geo_data.get('district'): missing_location.append(geo_data['district'])
                if geo_data.get('state'): missing_location.append(geo_data['state'])
                
                search_target = ", ".join(missing_location) if missing_location else "your specific area"
                
                return {
                    "current_status": "AUTONOMOUS_SEEDING", 
                    "jurisdiction_hierarchy": seed_jurisdiction,
                    "location_raw": {**location_raw, "resolved_hierarchy": geo_data}, 
                    "confidence_metrics": updated_metrics,
                    "status_updates": [status_update],
                    "error_log": [{
                        "node": "jurisdiction",
                        "action": "no_confident_match_initiating_seeder",
                        "rationale": rationale,
                        "ts": execution_ts.isoformat()
                    }],
                    "conversational_reply": f"I don't have the exact administrative routing for {search_target} in my current memory. Give me a moment—I am deploying a web-spider to autonomously research the local government structure and build a new database entry for this exact location..."
                }
                
        except Exception as e:
            logger.exception(f"Jurisdiction node critical failure: {e}")
            span.record_exception(e)
            return {
                "current_status": "FAILED",
                "confidence_metrics": {**existing_metrics, "jurisdiction": 0.0},
                "error_log": [{
                    "node": "jurisdiction",
                    "action": "critical_failure",
                    "details": type(e).__name__,
                    "ts": execution_ts.isoformat()
                }],
                "status_updates": [{
                    "node": "jurisdiction",
                    "action": "failed_closed",
                    "ts": execution_ts.isoformat()
                }],
                "conversational_reply": "I encountered a critical error while trying to map your location. The engineering team has been notified."
            }