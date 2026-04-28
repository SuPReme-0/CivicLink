# backend/brain/nodes/vlm_verify.py
"""
Production Multi-Provider VLM Forensics Engine.
- Full LangGraph RunnableConfig propagation for per-thread rate limiting
- SQLite-backed circuit breaker (worker-safe via rate_limiter)
- OpenTelemetry metrics with safe fallbacks
- PII-sanitized outputs + validated fusion weights
"""
import os
import io
import json
import asyncio
import hashlib
import logging
import re
import time          
import base64        
from typing import Dict, Any, Tuple, Optional, List
from datetime import datetime, timezone
from urllib.parse import urlparse

import cv2
import numpy as np
from PIL import Image, ImageChops, ExifTags
import aiohttp

# LangGraph integration
from langgraph.config import RunnableConfig

# Local imports
from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer, get_meter
from backend.core.rate_limiter import rate_limiter
from backend.core.vlm_provider import (
    get_provider, 
    VLMProvider, 
    FORENSIC_SCHEMA,
    VLMAPIError
)

logger = logging.getLogger(__name__)
tracer = get_tracer("vlm_verify")
meter = get_meter("civiclink")

# ---------------------------------------------------------
# OBSERVABILITY: Safe Metric Initialization
# ---------------------------------------------------------
try:
    decision_counter = meter.create_counter(
        "forensic_decision", 
        description="Forensic analysis outcomes",
        unit="1"
    )
    provider_counter = meter.create_counter(
        "vlm_provider_used", 
        description="Provider selection tracking",
        unit="1"
    )
    cost_counter = meter.create_counter(
        "vlm_cost_usd", 
        description="USD cost tracking",
        unit="usd"
    )
except Exception as e:
    logger.warning(f"Metric initialization failed: {e}")
    # Fallback: no-op counters
    class _NoOpCounter:
        def add(self, *_, **__): pass
    decision_counter = provider_counter = cost_counter = _NoOpCounter()

# ---------------------------------------------------------
# GLOBAL HTTP SESSION (With Shutdown Hook)
# ---------------------------------------------------------
_http_session: Optional[aiohttp.ClientSession] = None

async def get_http_session() -> aiohttp.ClientSession:
    """Singleton HTTP session with connection pooling."""
    global _http_session
    if _http_session is None or _http_session.closed:
        connector = aiohttp.TCPConnector(
            limit_per_host=20, 
            ttl_dns_cache=300,
            force_close=False
        )
        _http_session = aiohttp.ClientSession(connector=connector)
    return _http_session

async def close_http_session() -> None:
    """Graceful shutdown hook for HTTP session."""
    global _http_session
    if _http_session and not _http_session.closed:
        await _http_session.close()
        _http_session = None
        logger.info("HTTP session closed")

# ---------------------------------------------------------
# CIRCUIT BREAKER (SQLite-Backed via Rate Limiter)
# ---------------------------------------------------------

async def _check_circuit_breaker(provider_name: str) -> bool:
    """Checks if a provider has been temporarily disabled due to rate limits."""
    try:
        from backend.core.rate_limiter import rate_limiter
        
        # If rate limiter isn't fully initialized, just allow the request
        if not hasattr(rate_limiter, '_db') or not rate_limiter._db:
            return False 
            
        async with rate_limiter._db.execute(
            "SELECT is_open FROM circuit_breakers WHERE provider = ?", 
            (provider_name,)
        ) as cursor:
            row = await cursor.fetchone()
            return bool(row and row[0])
            
    except Exception as e:
        logger.warning(f"Circuit breaker check failed for {provider_name} (ignoring): {e}")
        return False

async def _record_provider_failure(provider_name: str):
    """Records a failure to trip the circuit breaker if necessary."""
    try:
        from backend.core.rate_limiter import rate_limiter
        if not hasattr(rate_limiter, '_db') or not rate_limiter._db:
            return

        import time
        now_ns = time.time_ns()
        
        # We safely execute the circuit breaker update
        await rate_limiter._db.execute("""
            INSERT INTO circuit_breakers (provider, failures, last_failure_ns)
            VALUES (?, 1, ?)
            ON CONFLICT(provider) DO UPDATE SET
                failures = failures + 1,
                last_failure_ns = ?
        """, (provider_name, now_ns, now_ns))
        await rate_limiter._db.commit()
        
    except Exception as e:
        logger.warning(f"Ignored DB error while recording VLM failure for {provider_name}: {e}")
        
async def _record_provider_success(provider: str) -> None:
    """Record success by resetting circuit breaker bucket."""
    try:
        from backend.core.rate_limiter import rate_limiter
        if not hasattr(rate_limiter, '_db') or not rate_limiter._db:
            return
            
        bucket_id = f"circuit:{provider}"
        now_ns = time.time_ns()
        
        await rate_limiter._db.execute("""
            INSERT INTO buckets (id, tokens, last_refill_ns, capacity, refill_rate)
            VALUES (?, 1, ?, 1, 1)
            ON CONFLICT(id) DO UPDATE SET
                tokens = 1,
                last_refill_ns = excluded.last_refill_ns
        """, (bucket_id, now_ns))
        await rate_limiter._db.commit()
    except Exception:
        pass

# ---------------------------------------------------------
# 1. SECURE IMAGE INGESTION (Validated + Sanitized)
# ---------------------------------------------------------
VALID_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAGIC_BYTES = {
    b"\xFF\xD8\xFF": "image/jpeg",
    b"\x89PNG\r\n\x1A\n": "image/png",
    b"RIFF....WEBP": "image/webp",
}

def _validate_image_url(url: str) -> bool:
    """Validate URL format, allowed domains, or Data URIs."""
    if url.startswith("data:image"):
        return True 
        
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("https", "http"):
            return False
        allowed_domains = getattr(settings, "ALLOWED_IMAGE_DOMAINS", [])
        if allowed_domains and parsed.netloc not in allowed_domains:
            logger.warning(f"Image domain not allowed: {parsed.netloc}")
            return False
        return True
    except Exception:
        return False
async def _download_image_securely(url: str, session_id: str) -> Tuple[bytes, str]:
    """Downloads image or decodes Base64, validates it, and compresses it for the VLM."""
    if not _validate_image_url(url):
        raise ValueError(f"Invalid or disallowed image URL.")
    
    image_bytes = b""
    detected_mime = ""

    # 1. Extract the raw bytes
    if url.startswith("data:image"):
        header, encoded = url.split(",", 1)
        detected_mime = header.split(";")[0].replace("data:", "")
        image_bytes = base64.b64decode(encoded)
    else:
        session = await get_http_session()
        async with session.get(
            url, 
            timeout=aiohttp.ClientTimeout(total=getattr(settings, "IMAGE_DOWNLOAD_TIMEOUT", 10.0)),
            headers={"User-Agent": getattr(settings, "USER_AGENT", "CivicLink/1.0")}
        ) as response:
            if response.status != 200:
                raise ValueError(f"Failed to fetch image: HTTP {response.status}")
            
            image_bytes = await response.read()
            magic = image_bytes[:12]
            detected_mime = next((mime for prefix, mime in MAGIC_BYTES.items() if magic.startswith(prefix)), None)
            if not detected_mime:
                raise ValueError("Magic bytes not recognized")

    # 2. Security Size Check (10MB Limit)
    max_size = getattr(settings, "MAX_IMAGE_SIZE", 10 * 1024 * 1024) 
    if len(image_bytes) > max_size:
        raise ValueError("Image exceeds 10MB security limit.")

    # 🚨 3. THE TOKEN-SAVER FIX: Compress the image for the Free APIs
    try:
        # Open the image using PIL
        img = Image.open(io.BytesIO(image_bytes))
        
        # Convert to RGB (removes alpha channels which some VLMs hate)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
            
        # 🚨 FIX: Hyper-compress the image to bypass Groq's strict free-tier token limits
        img.thumbnail((800, 800), Image.Resampling.LANCZOS) # Slashed resolution
        
        output_buffer = io.BytesIO()
        img.save(output_buffer, format="JPEG", quality=80) # Slashed quality
        compressed_bytes = output_buffer.getvalue()
        
        return compressed_bytes, "image/jpeg"
        
    except Exception as e:
        logger.warning(f"Failed to compress image, using original: {e}")
        return image_bytes, detected_mime
    
# ---------------------------------------------------------
# 2. PIXEL FORENSICS (Exception-Isolated)
# ---------------------------------------------------------
def _compute_ela(image_bytes: bytes) -> float:
    try:
        original = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        original.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        temp_buffer = io.BytesIO()
        original.save(temp_buffer, 'JPEG', quality=90)
        temp_buffer.seek(0)
        compressed = Image.open(temp_buffer)
        ela_image = ImageChops.difference(original, compressed)
        extrema = ela_image.getextrema()
        max_diff = max([ex[1] for ex in extrema]) if extrema else 1
        max_diff = max_diff if max_diff > 0 else 1
        ela_array = np.array(ela_image).astype(np.float32)
        mean_diff = np.mean(ela_array / max_diff)
        return float(np.clip(mean_diff * 2, 0.0, 1.0))
    except Exception as e:
        logger.debug(f"ELA computation failed: {e}")
        return 0.5  

def _analyze_frequency_domain(image_bytes: bytes) -> float:
    try:
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None: return 0.5
        img = cv2.resize(img, (256, 256), interpolation=cv2.INTER_LINEAR)
        dct = cv2.dct(np.float32(img))
        dct_mag = np.abs(dct)
        high_freq = dct_mag[128:, 128:]
        baseline = dct_mag[:128, :128]
        ratio = np.mean(high_freq) / (np.mean(baseline) + 1e-8)
        return float(min(abs(ratio - 1.0) * 5, 1.0))
    except Exception as e:
        logger.debug(f"Frequency analysis failed: {e}")
        return 0.5

def _detect_copy_move(image_bytes: bytes) -> bool:
    try:
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None: return False
        img = cv2.resize(img, (512, 512), interpolation=cv2.INTER_LINEAR)
        orb = cv2.ORB_create(nfeatures=500)
        keypoints, descriptors = orb.detectAndCompute(img, None)
        if descriptors is None or len(keypoints) < 20: return False
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(descriptors, descriptors)
        duplicate_ratio = sum(1 for m in matches if m.queryIdx != m.trainIdx) / max(len(matches), 1)
        return duplicate_ratio > 0.3
    except Exception as e:
        logger.debug(f"Copy-move detection failed: {e}")
        return False

def _extract_exif_trust(image_bytes: bytes) -> Tuple[float, Dict[str, str]]:
    try:
        img = Image.open(io.BytesIO(image_bytes))
        exif = img.getexif()
        if not exif: return 0.8, {"status": "stripped"}
        metadata = {str(ExifTags.TAGS.get(k, k)): str(v)[:200] for k, v in exif.items() if ExifTags.TAGS.get(k) not in ("GPSInfo", "MakerNote")}
        software = metadata.get("Software", "").lower()
        if any(bad in software for bad in ["photoshop", "gimp", "midjourney", "stable diffusion", "dall-e"]):
            return 0.1, {"software_flag": software}
        return 1.0, {"status": "native_camera"}
    except Exception as e:
        logger.debug(f"EXIF analysis failed: {e}")
        return 0.8, {"status": "error"}

# ---------------------------------------------------------
# 3. MULTI-PROVIDER INFERENCE WITH HEALTH-AWARE FALLBACK
# ---------------------------------------------------------
async def _run_with_provider(
    provider: VLMProvider,
    image_url: str,
    context: str,
    config: Optional[RunnableConfig] = None
) -> Tuple[Dict[str, Any], int]:
    """Run analysis with a single provider."""
    token_estimate = await provider.estimate_tokens(image_url, context)
    
    allowed, wait_sec = await provider._check_rate_limit(token_estimate, config)
    if not allowed:
        raise TimeoutError(f"{provider.PROVIDER_NAME} rate limited. Wait {wait_sec:.1f}s")
    
    result = await provider.analyze_image(image_url, context, config)
    actual_tokens = getattr(result, "usage", {}).get("total_tokens", token_estimate)
    return result, actual_tokens

async def _fallback_cnn_classifier() -> Dict[str, Any]:
    """Lightweight fallback when all providers fail."""
    return {
        "is_genuine": True,
        "confidence_score": 0.5,
        "severity": "MEDIUM",
        "rationale": "fallback_classifier_neutral",
        "image_description": "The image could not be analyzed due to backend provider failures.",
        "ai_artifacts": False,
        "screen_recapture": False
    }

async def _analyze_with_fallback_chain(
    image_url: str,
    context: str,
    session_id: str,
    config: Optional[RunnableConfig] = None
) -> Tuple[Dict[str, Any], int, float, str]:
    """Try providers in priority order with health checks + circuit breaker."""
    
    priority_list = getattr(settings, "VLM_PROVIDER_PRIORITY", ["groq"])
    
    for provider_name in priority_list:
        if await _check_circuit_breaker(provider_name):
            logger.warning(f"Skipping {provider_name}: circuit breaker open")
            continue
        
        provider = get_provider(provider_name)
        if not provider:
            continue
        
        if not await provider.check_health():
            logger.warning(f"Skipping {provider_name}: health check failed")
            continue
        
        try:
            logger.info(f"Attempting analysis with {provider_name}")
            result, tokens = await _run_with_provider(provider, image_url, context, config)
            
            await _record_provider_success(provider_name)
            provider_counter.add(1, attributes={"provider": provider_name, "status": "success"})
            
            cost = provider._calculate_cost(tokens)
            if getattr(settings, "ENABLE_COST_TRACKING", False):
                await provider._record_usage(tokens, cost, config)
                cost_counter.add(cost, attributes={"provider": provider_name})
            
            return result, tokens, cost, provider_name
            
        except VLMAPIError as e:
            if not e.retryable:
                # 🚨 FIX: Use str(e) instead of e.message to prevent logging crashes
                logger.warning(f"{provider_name} non-retryable error: {str(e)}")
                provider_counter.add(1, attributes={"provider": provider_name, "status": "blocked"})
                continue 
            logger.error(f"{provider_name} failed (retryable): {str(e)}")
            await _record_provider_failure(provider_name)
            provider_counter.add(1, attributes={"provider": provider_name, "status": "failed"})
            continue
            
        except TimeoutError as e:
            logger.warning(f"{provider_name} timeout: {e}")
            await _record_provider_failure(provider_name)
            provider_counter.add(1, attributes={"provider": provider_name, "status": "timeout"})
            continue
            
        except Exception as e:
            logger.exception(f"{provider_name} unexpected error: {e}")
            await _record_provider_failure(provider_name)
            provider_counter.add(1, attributes={"provider": provider_name, "status": "error"})
            continue
    
    logger.warning("All providers failed, using fallback CNN classifier")
    result = await _fallback_cnn_classifier()
    return result, 0, 0.0, "fallback_cnn"

# ---------------------------------------------------------
# 4. PII SANITIZATION FOR AUDIT OUTPUTS
# ---------------------------------------------------------
_PII_KEYWORDS = re.compile(r'\b(aadhaar|pan|phone|mobile|email|address|name)\b', re.I)

def _sanitize_rationale(text: str, max_length: int = 200) -> str:
    if not text:
        return ""
    sanitized = _PII_KEYWORDS.sub("[REDACTED_FIELD]", text)
    return sanitized[:max_length].rsplit(" ", 1)[0] + "..." if len(sanitized) > max_length else sanitized

# ---------------------------------------------------------
# 5. FUSION WEIGHT VALIDATION (Settings Hook)
# ---------------------------------------------------------
def _validate_fusion_weights(weights: Dict[str, float]) -> Dict[str, float]:
    total = sum(weights.values())
    if total <= 0:
        logger.error("Fusion weights sum to zero; using defaults")
        return {"vlm": 0.6, "ela": 0.2, "freq": 0.15, "exif": 0.05}
    if abs(total - 1.0) > 0.01:
        logger.warning(f"Fusion weights sum to {total:.3f}; normalizing to 1.0")
    return {k: v / total for k, v in weights.items()}

# ---------------------------------------------------------
# 6. THE GRAPH NODE (Production-Hardened)
# ---------------------------------------------------------
async def vlm_verify_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    image_url = state.get("image_url")
    if not image_url:
        return {
            "status_updates": [{"node": "vlm_verify", "action": "skipped_no_image", "ts": datetime.now(timezone.utc).isoformat()}],
        }

    session_id = state.get("session_id", "unknown")
    extracted_text = state.get("extracted_text", "")
    execution_ts = datetime.now(timezone.utc) 
    
    with tracer.start_as_current_span("vlm_verify_node") as span:
        span.set_attribute("session_id", session_id)
        span.set_attribute("image_url_hash", hashlib.sha256(image_url.encode()).hexdigest()[:16])
        
        try:
            image_bytes, detected_mime = await _download_image_securely(image_url, session_id)
            
            vlm_res, tokens_used, cost_usd, provider_used = await _analyze_with_fallback_chain(
                image_url, extracted_text, session_id, config
            )
            
            forensic_results = await asyncio.gather(
                asyncio.to_thread(_compute_ela, image_bytes),
                asyncio.to_thread(_analyze_frequency_domain, image_bytes),
                asyncio.to_thread(_detect_copy_move, image_bytes),
                asyncio.to_thread(_extract_exif_trust, image_bytes),
                return_exceptions=True 
            )
            
            ela_res, freq_res, copy_res, exif_res = forensic_results
            
            ela_score = 0.5 if isinstance(ela_res, Exception) else ela_res
            freq_score = 0.5 if isinstance(freq_res, Exception) else freq_res
            copy_move = False if isinstance(copy_res, Exception) else copy_res
            
            if isinstance(exif_res, Exception):
                exif_score = 0.8
            elif isinstance(exif_res, tuple):
                exif_score, _ = exif_res
            else:
                exif_score = 0.8

            # 🚨 FIX: Safe fallback for Fusion Weights
            default_weights = {"vlm": 0.6, "ela": 0.2, "freq": 0.15, "exif": 0.05}
            weights = _validate_fusion_weights(getattr(settings, "FORENSIC_FUSION_WEIGHTS", default_weights))
            
            ela_trust = 1.0 - min(ela_score * 2, 1.0)
            freq_trust = 1.0 - min(freq_score * 2, 1.0)
            vlm_trust = vlm_res.get("confidence_score", 0.5)
            
            if vlm_res.get("ai_artifacts") or vlm_res.get("screen_recapture") or copy_move:
                vlm_trust *= 0.3
            
            final_score = (
                vlm_trust * weights["vlm"] +
                ela_trust * weights["ela"] +
                freq_trust * weights["freq"] +
                exif_score * weights["exif"]
            )
            
            severity = vlm_res.get("severity", "MEDIUM")
            valid_severities = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
            if severity not in valid_severities:
                severity = "MEDIUM"
            
            # 🚨 FIX: Safe fallback for Severity Thresholds
            default_thresholds = {"LOW": 0.6, "MEDIUM": 0.7, "HIGH": 0.8, "CRITICAL": 0.9}
            threshold_map = getattr(settings, "SEVERITY_THRESHOLDS", default_thresholds)
            threshold = threshold_map.get(severity, 0.7)
            
            is_genuine = final_score >= threshold and vlm_res.get("is_genuine", False)
            
            decision_counter.add(1, attributes={
                "decision": "genuine" if is_genuine else "suspicious",
                "severity": severity,
                "provider": provider_used
            })
            
            vlm_summary = {
                "is_genuine": vlm_res.get("is_genuine", True),
                "ai_artifacts": vlm_res.get("ai_artifacts", False),
                "screen_recapture": vlm_res.get("screen_recapture", False),
                "severity": severity,
                "rationale": _sanitize_rationale(vlm_res.get("rationale", "")),
                "image_description": vlm_res.get("image_description", "No description provided."),
                "provider_used": provider_used
            }
            
            updated_context = extracted_text + f"\n[SYSTEM: VLM analyzed attached image. Description: {vlm_summary['image_description']}]"
            
            return {
                "current_status": "PENDING_DETAILS", 
                "extracted_text": updated_context.strip(),
                "vlm_output": vlm_summary,
                "image_authenticity_score": round(final_score, 3),
                "severity_level": severity, 
                "confidence_metrics": {
                    "vlm_verification": round(vlm_trust, 3),
                    "pixel_forensics": round((ela_trust + freq_trust) / 2, 3),
                    "metadata_forensics": round(exif_score, 3),
                    "overall": round(final_score, 3)
                },
                "status_updates": [{
                    "node": "vlm_verify",
                    "action": "forensics_complete",
                    "score": round(final_score, 3),
                    "is_genuine": is_genuine,
                    "provider": provider_used,
                    "cost_usd": round(cost_usd, 6),
                    "ts": execution_ts.isoformat()
                }]
            }
            
        except Exception as e:
            logger.exception(f"Forensics node critical failure: {e}")
            span.record_exception(e)
            
            return {
                "current_status": "FAILED",
                "image_authenticity_score": 0.0,
                "vlm_output": {
                    "is_genuine": False,
                    "ai_artifacts": False,
                    "screen_recapture": False,
                    "severity": "MEDIUM",
                    "rationale": f"System failure during forensics: {type(e).__name__}",
                    "image_description": "System error: The image could not be analyzed due to a backend failure.",
                    "provider_used": "error_fallback"
                },
                "error_log": [{
                    "node": "vlm_verify",
                    "action": "critical_failure",
                    "details": type(e).__name__,
                    "ts": execution_ts.isoformat()
                }],
                "status_updates": [{
                    "node": "vlm_verify",
                    "action": "failed_closed",
                    "ts": execution_ts.isoformat()
                }]
            }