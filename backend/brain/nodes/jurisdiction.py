# backend/brain/nodes/jurisdiction.py
"""
Production RAG Engine for Jurisdiction Resolution.

FEATURES:
- Non-blocking Threaded Model Instantiation (Zero event-loop freezes)
- Multilingual Vector Space (BAAI/bge-m3)
- True "Edge-Distance" Geo-Spatial Validation
- pgvector HNSW index for sub-100ms similarity search
- Schema-synced output for the OSINT Spider Graph
- Zero-Cache execution to guarantee sync with Contact Spider updates
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
from geopy.distance import geodesic
from langgraph.config import RunnableConfig

from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer
from backend.core.db import prisma  

logger = logging.getLogger(__name__)
tracer = get_tracer("jurisdiction")

# ---------------------------------------------------------
# EMBEDDING MODEL INITIALIZATION (Thread-Safe Lazy Load)
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
                
                logger.info(f"Loading embedding model in background thread: {model_name} on {device}")
                _embedding_model = await asyncio.to_thread(_load_model_sync, model_name, device, cache_dir)
                
    return _embedding_model

async def _generate_embedding(text: str) -> np.ndarray:
    model = await _get_embedding_model()
    return await asyncio.to_thread(model.encode, text, normalize_embeddings=True)

# ---------------------------------------------------------
# GEO-SPATIAL & TEXT UTILITIES
# ---------------------------------------------------------
def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return geodesic((lat1, lon1), (lat2, lon2)).kilometers

def _point_in_bbox(lat: float, lon: float, bbox: Dict[str, float]) -> bool:
    return (
        bbox["min_lat"] <= lat <= bbox["max_lat"] and
        bbox["min_lon"] <= lon <= bbox["max_lon"]
    )

def _distance_to_bbox(lat: float, lon: float, bbox: Dict[str, float]) -> float:
    if _point_in_bbox(lat, lon, bbox):
        return 0.0
    
    closest_lat = max(bbox["min_lat"], min(lat, bbox["max_lat"]))
    closest_lon = max(bbox["min_lon"], min(lon, bbox["max_lon"]))
    
    return _haversine_distance(lat, lon, closest_lat, closest_lon)

def _normalize_query(text: str) -> str:
    # 🚨 FIX: Strip punctuation cleanly while preserving multilingual characters
    text = re.sub(r"[^\w\s]", " ", text) 
    return re.sub(r"\s+", " ", text).strip().lower()

async def _ensure_db_connection():
    """🚨 FIX: Active health-check rather than trusting the passive is_connected() flag."""
    if not prisma.is_connected():
        await prisma.connect()
    try:
        await asyncio.wait_for(prisma.query_raw("SELECT 1"), timeout=3.0)
    except Exception:
        logger.warning("DB connection stale. Reconnecting...")
        await prisma.disconnect()
        await prisma.connect()

# ---------------------------------------------------------
# PGVECTOR SEARCH WITH MULTI-STAGE RERANKING
# ---------------------------------------------------------
async def _search_jurisdiction(
    embedding: np.ndarray,
    query_text: str,
    location: Optional[Dict[str, Any]] = None
) -> List[Tuple[Dict[str, Any], float]]:
    
    await _ensure_db_connection()
        
    district_filter = None
    if location and location.get("type") == "text_inference":
        source = location.get("source", "")
        district_match = re.search(r"\b(district|জেলা|जिला)[:\s]*(\w[\w\s]+)", source, re.I)
        if district_match:
            district_filter = district_match.group(2).strip()

    embedding_str = f"[{','.join(map(str, embedding.tolist()))}]"
    
    # 🚨 FIX: Dynamic parameter settings
    vector_threshold = getattr(settings, "JURISDICTION_VECTOR_THRESHOLD", 0.45)
    rerank_limit = getattr(settings, "JURISDICTION_RERANK_LIMIT", 30) # Increased for better reranking pool

    query = """
        SELECT id, ward, municipality, district, state, 
               "issueCategory", "officialDesignation",
               "bboxMinLat", "bboxMaxLat", "bboxMinLon", "bboxMaxLon",
               (embedding <=> $1::vector) AS distance
        FROM administrative_hierarchy
        WHERE (embedding <=> $1::vector) < $2 
        {pre_filter}
        ORDER BY distance ASC
        LIMIT $3
    """
    
    pre_filter = ""
    params = [embedding_str, vector_threshold, rerank_limit]
    
    # 🚨 FIX: Safe positional parameter injection
    if district_filter:
        pre_filter = 'AND "district" ILIKE $4'
        params.append(f"%{district_filter}%")

    try:
        # 🚨 FIX: Added timeout to prevent event loop blocks on heavy DB load
        results = await asyncio.wait_for(
            prisma.query_raw(query.format(pre_filter=pre_filter), *params),
            timeout=10.0
        )
    except asyncio.TimeoutError:
        logger.error("RAG Database query timed out.")
        return []
    except Exception as e:
        logger.error(f"SQL Execution Failed: {e}")
        return []
    
    if not results:
        return []

    # 🚨 FIX: Hardened Lexical Reranking using Set Intersection
    query_words = set(re.findall(r'\w+', query_text))
    reranked = []

    for row in results:
        issue_str = row.get("issueCategory", "").lower()
        doc_words = set(re.findall(r'\w+', issue_str))
        
        # Calculate true word overlap
        overlap = len(query_words.intersection(doc_words))
        keyword_score = overlap / max(len(query_words), len(doc_words), 1)
        
        # Vector Similarity
        vector_distance = row.get("distance", 1.0)
        vector_score = max(0.0, 1.0 - float(vector_distance)) 
        
        combined_score = 0.7 * vector_score + 0.3 * keyword_score
        reranked.append((row, combined_score))

    reranked.sort(key=lambda x: x[1], reverse=True)

    # 🚨 FIX: Guarded GPS dictionary extraction
    if location and location.get("type") == "gps":
        lat = location.get("lat")
        lon = location.get("lon")
        
        if lat is not None and lon is not None:
            validated = []
            for row, score in reranked:
                if row.get("bboxMinLat") is not None:
                    bbox = {
                        "min_lat": float(row["bboxMinLat"]),
                        "max_lat": float(row["bboxMaxLat"]),
                        "min_lon": float(row["bboxMinLon"]),
                        "max_lon": float(row["bboxMaxLon"]),
                    }
                    
                    distance = _distance_to_bbox(lat, lon, bbox)
                    
                    if distance > 0:
                        distance_penalty = min(distance / 15.0, 1.0) 
                        score = score * (1.0 - 0.3 * distance_penalty)
                    else:
                        score = min(1.0, score + 0.05)
                        
                validated.append((row, score))
            reranked = validated

    return [(row, score) for row, score in reranked if row.get("district") and row.get("state")]


# ---------------------------------------------------------
# CONFIDENCE GATING & OSINT PAYLOAD BUILDER
# ---------------------------------------------------------
def _evaluate_confidence(
    candidates: List[Tuple[Dict[str, Any], float]],
    location: Optional[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, Any]], float, str]:
    if not candidates:
        return None, 0.0, "no_candidates_found"
    
    best_row, best_score = candidates[0]
    vector_threshold = getattr(settings, "JURISDICTION_CONFIDENCE_GATE", 0.40)
    
    if best_score >= vector_threshold:
        jurisdiction = {
            "id": best_row.get("id"),
            "ward": best_row.get("ward"),
            "municipality": best_row.get("municipality"),
            "district": best_row.get("district"),
            "state": best_row.get("state"),
            "issueCategory": best_row.get("issueCategory"),
            "officialDesignation": best_row.get("officialDesignation")
        }
        rationale = f"hybrid_match:{best_score:.3f}" + ("+geo_verified" if location and location.get("type") == "gps" else "")
        return jurisdiction, round(best_score, 3), rationale
        
    return None, round(best_score, 3), f"below_threshold:{best_score:.3f}<{vector_threshold}"

# ---------------------------------------------------------
# THE GRAPH NODE
# ---------------------------------------------------------
async def resolve_jurisdiction_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    extracted_text = state.get("extracted_text", "")
    location_raw = state.get("location_raw", {})
    language = state.get("language_metadata", {}).get("original", "en")
    execution_ts = datetime.now(timezone.utc)
    existing_metrics = state.get("confidence_metrics", {})
    
    with tracer.start_as_current_span("jurisdiction_node") as span:
        span.set_attribute("session_id", state.get("session_id", "unknown"))
        
        try:
            if not extracted_text.strip() and not location_raw:
                return {
                    "current_status": "AWAITING_REVIEW", 
                    "error_log": [{"node": "jurisdiction", "action": "empty_input", "ts": execution_ts.isoformat()}],
                    "status_updates": [{"node": "jurisdiction", "action": "skipped_empty", "ts": execution_ts.isoformat()}]
                }
            
            # 🚨 FIX: Dropped the cache entirely to ensure synchronization with dynamic Spider updates
            normalized_text = _normalize_query(extracted_text)
            embedding = await _generate_embedding(normalized_text)
            
            candidates = await _search_jurisdiction(
                embedding=embedding,
                query_text=normalized_text,
                location=location_raw
            )
            
            jurisdiction, confidence, rationale = _evaluate_confidence(
                candidates, 
                location_raw if location_raw.get("type") == "gps" else None
            )
            
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
                return {
                    "current_status": "DISCOVERING_CONTACT", 
                    "jurisdiction_hierarchy": jurisdiction, 
                    "confidence_metrics": updated_metrics,
                    "status_updates": [status_update]
                }
            else:
                return {
                    "current_status": "AWAITING_REVIEW", 
                    "confidence_metrics": updated_metrics,
                    "status_updates": [status_update],
                    "error_log": [{
                        "node": "jurisdiction",
                        "action": "no_confident_match",
                        "rationale": rationale,
                        "ts": execution_ts.isoformat()
                    }]
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
                }]
            }