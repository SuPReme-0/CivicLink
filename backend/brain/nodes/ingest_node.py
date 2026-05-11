# backend/brain/nodes/ingest_node.py
import re
import html
import unicodedata
import hashlib
import logging
import json
from urllib.parse import urlparse
from typing import Dict, Any, Tuple, List
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict, HttpUrl
from langgraph.config import RunnableConfig

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

from backend.core.config import settings
from backend.brain.state import CivicLinkState
from backend.core.observability import get_tracer

logger = logging.getLogger(__name__)
tracer = get_tracer("ingest_node")

# ---------------------------------------------------------
# 1. STRICT PAYLOAD VALIDATION & LLM INIT
# ---------------------------------------------------------
class WhatsAppPayload(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        str_strip_whitespace=True,
        validate_default=True,
    )
    text_body: str = Field(default="", max_length=4000)
    image_url: str | None = Field(default=None)
    audio_url: HttpUrl | None = Field(default=None)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    language_code: str = Field(default="en", min_length=2, max_length=5)

# Initialize Groq for the Gatekeeper logic
gatekeeper_llm = ChatGroq(
    api_key=settings.GROQ_API_KEY, 
    model_name=settings.GROQ_MODEL,
    temperature=0.3, # Slightly higher for more natural empathy
    max_retries=3
)

# 🚨 UPGRADED PROMPT FOR MAXIMUM HUMANISM & EMPATHY
GATEKEEPER_PROMPT = """
You are the CivicLink Intake Concierge. You are a highly empathetic, professional human dispatcher. 
Your job is to safely gather details about a municipal issue and prepare it for official dispatch.

CONVERSATIONAL DIRECTIVES:
1. EMPATHY FIRST: Always validate the user's frustration or danger immediately. (e.g., "I'm so sorry you're dealing with that flooded street, that sounds incredibly unsafe.")
2. NO AMNESIA: Read the "PREVIOUS CONTEXT". If you already acknowledged a photo or GPS location, DO NOT say "I see you attached a photo" again. Move the conversation forward.
3. THE 4 PILLARS: You must discreetly gather:
   - The Incident (What is wrong?)
   - The Impact (How is it affecting them?)
   - The Sensors (Encourage a photo or GPS pin if they haven't provided one, but don't force it).
   - The Authorization (Ask: "Are you ready for me to formally file this report?")
4. CONCISE PROFESSIONALISM: Do not output massive walls of text. Be brief, warm, and clear.

WHEN THE USER AUTHORIZES DISPATCH (e.g., "Yes, send it", "Proceed", "File it"):
- Set "is_complete": true.
- Reply with a definitive hand-off message: "Understood. I am locking in your coordinates and compiling the legal directive now. I will cryptographically sign this and route it to the correct municipal authority. You can monitor the live pipeline status on your screen."

CRITICAL INSTRUCTION: Output ONLY a raw JSON object. Do not use markdown tags like ```json. 

{
    "is_complete": true/false,
    "reply_message": "Your empathetic, state-aware response to the user.",
    "compiled_summary": "A highly detailed, professional summary of the facts gathered so far (for the database).",
    "issue_category": "ROADS" | "SANITATION" | "WATER" | "ELECTRICITY" | "OTHER" | null,
    "severity_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null
}
"""

# ---------------------------------------------------------
# 2. DETERMINISTIC INPUT SANITIZATION
# ---------------------------------------------------------
PII_PATTERNS = {
    "AADHAAR": re.compile(r"(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)", re.ASCII),
    "PAN_CARD": re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b", re.ASCII | re.IGNORECASE),
    "PHONE_IN": re.compile(r"(?:\+?91[\s\-]?)?[6-9][0-9]{9}(?!\d)", re.ASCII),
}

INJECTION_PATTERNS = [
    re.compile(r"\b(ignore previous|system prompt|developer mode|forget all|jailbreak|you are now)\b", re.I),
    re.compile(r"<script|<iframe|onload=|onerror=", re.I),
    re.compile(r"[\x00-\x08\x0E-\x1F\x7F-\x9F]"),
]

def _sanitize_input(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw)
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text)
    return text[:2000]

def _scrub_pii(text: str) -> Tuple[str, List[str]]:
    found_types = []
    sanitized = text
    for pii_type, pattern in PII_PATTERNS.items():
        matches = pattern.findall(sanitized)
        if matches:
            found_types.append(pii_type)
            sanitized = pattern.sub(f"[REDACTED_{pii_type}]", sanitized)
    return sanitized, found_types

# ---------------------------------------------------------
# 3. THE NODE EXECUTION
# ---------------------------------------------------------
async def ingest_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    execution_ts = datetime.now(timezone.utc)
    thread_id = state.get("thread_id", config.get("configurable", {}).get("thread_id", "unknown"))
    
    with tracer.start_as_current_span("ingest_node") as span:
        logger.info(f"\n🟢 [INGEST NODE] Starting processing for thread: {thread_id}")

        configurable = config.get("configurable", {})
        raw_payload = configurable.get("raw_payload", {})
        
        user_input = raw_payload.get("text_message", state.get("user_input", ""))
        image_url = raw_payload.get("image_url", state.get("image_url"))
        location_raw = raw_payload.get("location", state.get("location_raw", {}))
        
        vlm_output = state.get("vlm_output")

        # The VLM Skip check (If image exists but hasn't been analyzed)
        if image_url and not vlm_output:
            logger.info("Ingest: Unverified image detected. Deferring to VLM Forensics.")
            return {"current_status": "VERIFYING_IMAGE"}
            
        try:
            # Validation & Sanitization
            validated = WhatsAppPayload(
                text_body=user_input,
                image_url=image_url,
                latitude=location_raw.get("lat"),
                longitude=location_raw.get("lon"),
                language_code="en"
            )
            
            safe_text = _sanitize_input(validated.text_body)
            if any(pat.search(safe_text) for pat in INJECTION_PATTERNS):
                return {"is_grievance_complete": False, "conversational_reply": "I am unable to process that request due to security constraints. Let's start over—what is the municipal issue you're facing?"}

            scrubbed_text, _ = _scrub_pii(safe_text)
            has_gps = validated.latitude is not None and validated.longitude is not None
            
            # VLM Context Injection
            vlm_context = ""
            if vlm_output:
                img_desc = vlm_output.get("image_description", "No description provided.")
                vlm_context = f"\n[SYSTEM MEMORY: You have already analyzed the user's photo. Description: {img_desc}]\n"

            # Prompt Construction
            previous_reply = state.get("conversational_reply", "None (First contact)")
            previous_summary = state.get("extracted_text", "None")

            ai_context = f"""
            --- PREVIOUS CONTEXT ---
            What you just said to the user: "{previous_reply}"
            Grievance facts gathered so far: "{previous_summary}"
            
            --- CURRENT INPUT ---
            User's New Message: "{scrubbed_text}"
            Has GPS Coords: {str(has_gps).lower()}
            Image Attached: {str(bool(validated.image_url)).lower()}
            {vlm_context}
            """
            
            logger.info(f"🧠 [THINKING LAYER] Sending prompt to Groq...\n{ai_context}")
            
            response = await gatekeeper_llm.ainvoke([
                SystemMessage(content=GATEKEEPER_PROMPT),
                HumanMessage(content=ai_context)
            ])
            
            # 🚨 HARDENED JSON EXTRACTION
            raw_content = response.content.strip()
            
            # Strip markdown formatting if the LLM disobeys the instruction
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            if raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
                
            start_idx = raw_content.find('{')
            end_idx = raw_content.rfind('}')
            
            if start_idx != -1 and end_idx != -1:
                raw_content = raw_content[start_idx:end_idx+1]
                
            parsed_intent = json.loads(raw_content)
            logger.info(f"✅ [THINKING LAYER] Parsed Successfully: {parsed_intent}")

            image_hash = hashlib.sha256(str(validated.image_url).encode("utf-8")).hexdigest() if validated.image_url else None

            # State Updates
            return {
                "extracted_text": parsed_intent.get("compiled_summary", scrubbed_text),
                "image_hash": image_hash,
                "is_grievance_complete": parsed_intent.get("is_complete", False),
                "conversational_reply": parsed_intent.get("reply_message", "Processing..."),
                "issue_category": parsed_intent.get("issue_category", "OTHER"),
                "severity_level": parsed_intent.get("severity_level", "LOW"),
                "current_status": "PENDING_DETAILS",
                "status_updates": [{
                    "node": "ingest", 
                    "action": "payload_processed", 
                    "is_complete": parsed_intent.get("is_complete", False),
                    "ts": execution_ts.isoformat()
                }]
            }

        except json.JSONDecodeError as je:
            logger.error(f"❌ [JSON PARSE ERROR] LLM output was not valid JSON: {response.content}")
            return {
                "is_grievance_complete": False,
                "conversational_reply": "I'm sorry, I encountered a brief system error parsing that. Could you confirm if you are ready to file this report?"
            }
        except Exception as e:
            logger.error(f"❌ [CRITICAL ERROR] Ingest Node Failure: {str(e)}", exc_info=True)
            span.record_exception(e)
            return {
                "is_grievance_complete": False,
                "conversational_reply": "I'm so sorry, my system had a minor hiccup trying to process that. Could you please say that one more time?"
            }