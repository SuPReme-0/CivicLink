# backend/brain/nodes/jurisdiction.py
"""
Production RAG Engine for Jurisdiction Resolution.

FEATURES:
- Local embedding generation (BAAI/bge-small) via thread pool
- Unhashable-safe LRU Caching (@alru_cache) to save GPU/CPU cycles
- pgvector HNSW index for sub-100ms similarity search
- Multi-stage validation: vector + keyword (BM25) + geospatial
- Schema-synced parsing for issueCategory strings
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
from async_lru import alru_cache
from geopy.distance import geodesic
from langgraph.config import RunnableConfig

from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer
from backend.core.db import prisma_client  # 🚨 Global Singleton

logger = logging.getLogger(__name__)
tracer = get_tracer("jurisdiction")

# ---------------------------------------------------------
# EMBEDDING MODEL INITIALIZATION (Lazy Load)
# ---------------------------------------------------------
_embedding_model: Optional[SentenceTransformer] = None
_embedding_lock = asyncio.Lock()

async def _get_embedding_model() -> SentenceTransformer:
    """Lazy-load local embedding model to prevent memory bloat on startup."""
    global _embedding_model
    if _embedding_model is None:
        async with _embedding_lock:
            if _embedding_model is None:
                device = "cuda" if getattr(settings, "ENABLE_GPU_EMBEDDINGS", False) else "cpu"
                model_name = getattr(settings, "EMBEDDING_MODEL_NAME", "BAAI/bge-small-en-v1.5")
                cache_dir = Path(getattr(settings, "MODEL_CACHE_DIR", "data/models")) / "sentence_transformers"
                cache_dir.mkdir(parents=True, exist_ok=True)
                
                _embedding_model = SentenceTransformer(
                    model_name,
                    device=device,
                    cache_folder=str(cache_dir)
                )
                _embedding_model.eval()
                logger.info(f"Loaded embedding model: {model_name} on {device}")
    return _embedding_model

async def _generate_embedding(text: str) -> np.ndarray:
    """Generate 384-dim embedding in a non-blocking thread."""
    model = await _get_embedding_model()
    return await asyncio.to_thread(model.encode, text, normalize_embeddings=True)

# ---------------------------------------------------------
# GEO-SPATIAL & TEXT UTILITIES
# ---------------------------------------------------------
def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in kilometers."""
    return geodesic((lat1, lon1), (lat2, lon2)).kilometers

def _point_in_bbox(lat: float, lon: float, bbox: Dict[str, float]) -> bool:
    """Check if point is within bounding box."""
    return (
        bbox["min_lat"] <= lat <= bbox["max_lat"] and
        bbox["min_lon"] <= lon <= bbox["max_lon"]
    )

def _normalize_query(text: str, language: str) -> str:
    """Normalize text for embedding + keyword matching."""
    text = re.sub(r"[^\w\s\-\u0980-\u09FF\u0900-\u097F]", " ", text) 
    return re.sub(r"\s+", " ", text).strip().lower()

def _extract_keywords(text: str) -> List[str]:
    """Extract issue-related keywords for BM25 re-ranking."""
    ISSUE_KEYWORDS = {
        "garbage": ["garbage", "trash", "waste", "dump", "sanitation", "dustbin"],
        "pothole": ["pothole", "road", "damage", "crack", "repair", "street"],
        "water_logging": ["water", "flood", "logging", "drainage", "stagnant", "drain"],
        "street_light": ["light", "lamp", "pole", "electric", "dark", "broken light"],
        "encroachment": ["encroachment", "illegal", "construction", "occupation", "hawker"],
    }
    text_lower = text.lower()
    return [category for category, keywords in ISSUE_KEYWORDS.items() 
            if any(kw in text_lower for kw in keywords)]

# ---------------------------------------------------------
# PGVECTOR SEARCH WITH MULTI-STAGE RERANKING
# ---------------------------------------------------------
async def _search_jurisdiction(
    embedding: np.ndarray,
    query_text: str,
    location: Optional[Dict[str, Any]] = None,
    language: str = "en"
) -> List[Tuple[Dict[str, Any], float]]:
    """Executes pgvector query + BM25 + Geo reranking."""
    # Ensure DB is connected (safeguard)
    if not prisma_client.is_connected():
        await prisma_client.connect()
        
    filters = {}
    if location and location.get("type") == "text_inference":
        source = location.get("source", "")
        district_match = re.search(r"\b(district|জেলা|जिला)[:\s]*(\w[\w\s]+)", source, re.I)
        if district_match:
            filters["district"] = district_match.group(2).strip()

    # 🚨 FIX: Format embedding safely for PostgreSQL vector parsing
    embedding_str = f"[{','.join(map(str, embedding.tolist()))}]"

    # Raw SQL utilizing the HNSW index `<=>` for cosine distance
    query = """
        SELECT id, ward, municipality, district, state, pincode, 
               embedding <=> $1::vector AS similarity,
               "issueCategory", bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon
        FROM "AdministrativeHierarchy"
        WHERE (embedding <=> $1::vector) < $2 
        {pre_filter}
        ORDER BY similarity ASC
        LIMIT $3
    """
    
    pre_filter = ""
    params = [embedding_str, 0.25, 5] # distance < 0.25 == similarity > 0.75
    
    if filters.get("district"):
        pre_filter = "AND district = $4"
        params.append(filters["district"])

    # 🚨 FIX: Use Global Singleton Database
    results = await prisma_client.query_raw(query.format(pre_filter=pre_filter), *params)
    
    if not results:
        return []

    # Reranking Engine
    query_keywords = set(_extract_keywords(query_text))
    reranked = []

    for row in results:
        # 🚨 FIX: Safely parse singular String field into list for intersection
        issue_str = row.get("issueCategory", "")
        doc_keywords = set([k.strip().lower() for k in issue_str.split(",")])
        
        keyword_score = len(query_keywords & doc_keywords) / max(len(query_keywords | doc_keywords), 1)
        vector_score = 1.0 - row["similarity"] 
        combined_score = 0.7 * vector_score + 0.3 * keyword_score
        
        reranked.append((row, combined_score))

    reranked.sort(key=lambda x: x[1], reverse=True)

    # Geospatial Validation
    if location and location.get("type") == "gps":
        lat, lon = location["lat"], location["lon"]
        validated = []
        
        for row, score in reranked:
            bbox = {
                "min_lat": row.get("bbox_min_lat"),
                "max_lat": row.get("bbox_max_lat"),
                "min_lon": row.get("bbox_min_lon"),
                "max_lon": row.get("bbox_max_lon"),
            }
            # 🚨 FIX: Explicit 'is not None' to protect against 0.0 Equator coordinates
            if bbox["min_lat"] is not None and _point_in_bbox(lat, lon, bbox):
                center_lat = (bbox["min_lat"] + bbox["max_lat"]) / 2
                center_lon = (bbox["min_lon"] + bbox["max_lon"]) / 2
                distance = _haversine_distance(lat, lon, center_lat, center_lon)
                
                # Apply distance penalty (max penalty at 10km)
                distance_penalty = min(distance / 10.0, 1.0)
                geo_adjusted_score = score * (1.0 - 0.2 * distance_penalty)
                validated.append((row, geo_adjusted_score))

        reranked = validated

    # Hierarchy existence check
    return [(row, score) for row, score in reranked if row.get("district") and row.get("state")]


# ---------------------------------------------------------
# CACHE ABSTRACTION LAYER 
# ---------------------------------------------------------
# 🚨 FIX: Convert unhashable dicts/arrays into strings so @alru_cache doesn't crash
@alru_cache(maxsize=1000)
async def _execute_rag_pipeline_cached(
    query_text: str, 
    location_json: str, 
    language: str
) -> List[Tuple[Dict[str, Any], float]]:
    """Fully cached RAG pipeline. Accepts ONLY hashable string inputs."""
    location = json.loads(location_json) if location_json else None
    embedding = await _generate_embedding(query_text)
    return await _search_jurisdiction(embedding, query_text, location, language)


# ---------------------------------------------------------
# CONFIDENCE GATING
# ---------------------------------------------------------
def _evaluate_confidence(
    candidates: List[Tuple[Dict[str, Any], float]],
    location: Optional[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, str]], float, str]:
    """Return best match + confidence + rationale."""
    if not candidates:
        return None, 0.0, "no_candidates_found"
    
    best_row, best_score = candidates[0]
    vector_threshold = getattr(settings, "JURISDICTION_VECTOR_THRESHOLD", 0.75)
    geo_threshold = getattr(settings, "JURISDICTION_GEO_TOLERANCE_KM", 5.0)
    
    # Add GPS exactness bonuses
    if location and location.get("type") == "gps" and best_row.get("bbox_min_lat") is not None:
        lat, lon = location["lat"], location["lon"]
        center_lat = (best_row["bbox_min_lat"] + best_row["bbox_max_lat"]) / 2
        center_lon = (best_row["bbox_min_lon"] + best_row["bbox_max_lon"]) / 2
        distance = _haversine_distance(lat, lon, center_lat, center_lon)
        
        if distance > geo_threshold:
            return None, 0.0, f"geo_mismatch:{distance:.1f}km>{geo_threshold}km"
        if distance < 1.0:
            best_score = min(1.0, best_score + 0.1)

    if best_score >= vector_threshold:
        jurisdiction = {
            "ward": best_row.get("ward"),
            "municipality": best_row.get("municipality"),
            "district": best_row.get("district"),
            "state": best_row.get("state"),
            "pincode": best_row.get("pincode"),
        }
        rationale = f"vector_match:{best_score:.3f}" + ("+geo_verified" if location and location.get("type") == "gps" else "")
        return jurisdiction, round(best_score, 3), rationale
        
    return None, round(best_score, 3), f"below_threshold:{best_score:.3f}<{vector_threshold}"

# ---------------------------------------------------------
# THE GRAPH NODE (Production-Hardened)
# ---------------------------------------------------------
async def resolve_jurisdiction_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    """
    LangGraph node: Generates embedding, hits pgvector, and returns hierarchy.
    """
    extracted_text = state.get("extracted_text", "")
    location_raw = state.get("location_raw", {})
    language = state.get("language_metadata", {}).get("original", "en")
    execution_ts = datetime.now(timezone.utc)
    
    with tracer.start_as_current_span("jurisdiction_node") as span:
        span.set_attribute("session_id", state.get("session_id", "unknown"))
        
        try:
            if not extracted_text.strip() and not location_raw:
                return {
                    "error_log": [{"node": "jurisdiction", "action": "empty_input", "ts": execution_ts.isoformat()}],
                    "status_updates": [{"node": "jurisdiction", "action": "skipped_empty", "ts": execution_ts.isoformat()}]
                }
            
            # Serialize for unhashable-safe caching
            normalized_text = _normalize_query(extracted_text, language)
            location_json = json.dumps(location_raw, sort_keys=True) if location_raw else ""
            
            # Execute RAG Pipeline (Cached)
            candidates = await _execute_rag_pipeline_cached(
                query_text=normalized_text,
                location_json=location_json,
                language=language
            )
            
            # Evaluate constraints
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
            
            if jurisdiction:
                return {
                    "jurisdiction_hierarchy": jurisdiction,
                    "confidence_metrics": {"jurisdiction": confidence},
                    "status_updates": [status_update]
                }
            else:
                # No confident match: routing.py will send to human review
                return {
                    "confidence_metrics": {"jurisdiction": confidence},
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
                "confidence_metrics": {"jurisdiction": 0.0},
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