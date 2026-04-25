# backend/brain/nodes/ingest_node.py
import re
import html
import unicodedata
import hashlib
import logging
from urllib.parse import urlparse
from typing import Dict, Any, Tuple, List
from datetime import datetime, timezone
from pydantic import BaseModel, ValidationError, Field, ConfigDict, HttpUrl
from langgraph.config import RunnableConfig
from backend.brain.state import CivicLinkState

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# 1. STRICT PAYLOAD VALIDATION (Webhook Shield)
# ---------------------------------------------------------
class WhatsAppPayload(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        str_strip_whitespace=True,
        validate_default=True,
    )
    text_body: str = Field(default="", max_length=4000)
    image_url: HttpUrl | None = Field(default=None)  # Pydantic enforces valid URI format
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    language_code: str = Field(default="en", min_length=2, max_length=5)

# ---------------------------------------------------------
# 2. DETERMINISTIC INPUT SANITIZATION
# ---------------------------------------------------------
PII_PATTERNS = {
    "AADHAAR": re.compile(r"(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)", re.ASCII),
    "PAN_CARD": re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b", re.ASCII | re.IGNORECASE),
    "PHONE_IN": re.compile(r"(?:\+?91[\s\-]?)?[6-9][0-9]{9}(?!\d)", re.ASCII),
}

# Word boundaries prevent false positives on natural language
INJECTION_PATTERNS = [
    re.compile(r"\b(ignore previous|system prompt|developer mode|forget all|jailbreak|you are now)\b", re.I),
    re.compile(r"<script|<iframe|onload=|onerror=", re.I),
    re.compile(r"[\x00-\x08\x0E-\x1F\x7F-\x9F]"),  # Control chars
]

def _sanitize_input(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw)
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text)
    return text[:2000]  # Hard context limit

def _scrub_pii(text: str) -> Tuple[str, List[str]]:
    found_types = []
    sanitized = text
    for pii_type, pattern in PII_PATTERNS.items():
        matches = pattern.findall(sanitized)
        if matches:
            found_types.append(pii_type)
            sanitized = pattern.sub(f"[REDACTED_{pii_type}]", sanitized)
    return sanitized, found_types

def _detect_injection(text: str) -> bool:
    return any(pat.search(text) for pat in INJECTION_PATTERNS)

# ---------------------------------------------------------
# 3. THE NODE EXECUTION (Zero-Trust Bouncer)
# ---------------------------------------------------------
async def ingest_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    """
    Extracts, validates, and sanitizes incoming payload.
    Returns ONLY state updates. Routing is handled natively by conditional edges.
    """
    configurable = config.get("configurable", {})
    raw_payload = configurable.get("raw_payload")
    
    if not raw_payload:
        return {
            "error_log": [{"node": "ingest", "action": "missing_configurable_payload", "ts": datetime.now(timezone.utc).isoformat()}],
        }

    try:
        # 1. Pydantic Validation (fails fast on malformed structure or invalid URLs)
        validated = WhatsAppPayload(**raw_payload)
        
        # 2. Sanitize Input
        safe_text = _sanitize_input(validated.text_body)
        
        # 3. Reject completely empty payloads
        if not safe_text.strip() and not validated.image_url:
            return {
                "error_log": [{"node": "ingest", "action": "empty_payload", "ts": datetime.now(timezone.utc).isoformat()}],
                "status_updates": [{"node": "ingest", "action": "rejected_empty"}],
            }

        # 4. Prompt Injection & XSS Check
        if _detect_injection(safe_text):
            return {
                "error_log": [{"node": "ingest", "action": "injection_detected", "ts": datetime.now(timezone.utc).isoformat()}],
                "status_updates": [{"node": "ingest", "action": "flagged_malicious"}],
            }

        # 5. PII Scrubbing (Pre-LLM)
        scrubbed_text, redacted_types = _scrub_pii(safe_text)
        
        # 6. Early Image Hash (Deduplication fingerprint)
        image_hash = None
        if validated.image_url:
            image_hash = hashlib.sha256(str(validated.image_url).encode("utf-8")).hexdigest()

        # 7. Location Extraction & Edge Cases
        location_raw = {}
        if validated.latitude is not None and validated.longitude is not None:
            location_raw = {"lat": validated.latitude, "lon": validated.longitude, "type": "gps"}
        elif not safe_text.strip() and validated.image_url:
            location_raw = {"type": "metadata_only", "source": "image_exif_pending"}
        else:
            location_raw = {"type": "text_inference", "source": safe_text}

        # 8. Return SAFE state updates only (Decoupled from routing)
        return {
            "extracted_text": scrubbed_text,
            "language_metadata": {"original": validated.language_code},
            "image_url": str(validated.image_url) if validated.image_url else None,
            "image_hash": image_hash,
            "location_raw": location_raw,
            "status_updates": [{
                "node": "ingest", 
                "action": "payload_sanitized", 
                "redacted_types": redacted_types,
                "ts": datetime.now(timezone.utc).isoformat()
            }]
        }

    except ValidationError as e:
        # Safe logging: convert complex validation errors to string to prevent logger crashes
        return {
            "error_log": [{"node": "ingest", "action": "schema_validation_failed", "details": str(e.errors()), "ts": datetime.now(timezone.utc).isoformat()}],
            "status_updates": [{"node": "ingest", "action": "rejected_invalid_payload"}],
        }
    except Exception as e:
        logger.exception("Unhandled ingest error")
        return {
            "error_log": [{"node": "ingest", "action": "critical_failure", "details": "system_error", "ts": datetime.now(timezone.utc).isoformat()}],
            "status_updates": [{"node": "ingest", "action": "failed_safe"}],
        }