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
    temperature=0.2, 
    max_retries=2
)

GATEKEEPER_PROMPT = """
You are the CivicLink Community Support Agent. 
Your tone is warm, deeply empathetic, yet professional and efficient. You are a helpful human dispatcher, NOT a robotic form.

CONVERSATIONAL RULES (CRITICAL):
1. NO AMNESIA: Look at the "PREVIOUS CONTEXT". Do NOT repeat acknowledgments. If you already said "I have your photo" or "I have your location" previously, NEVER say it again. Just answer their current question naturally.
2. POST-FILING CHATTER: If the user asks a follow-up question after authorizing the report (e.g., "Is it done already?", "How long will it take?"), DO NOT try to gather more details or ask if they want to start a new report. Simply reassure them naturally: "Yes, your report is officially in our system and is currently being routed to the dispatch team."

INTAKE GOAL (Only if the report is not yet filed):
Gather these 4 pillars. If a pillar is already mentioned in 'Grievance details', DO NOT ask about it.
1. THE INCIDENT: What is happening?
2. THE HUMAN IMPACT: Acknowledge the danger/frustration. (e.g., "That sounds incredibly dangerous.")
3. THE SENSORS: GPS and Photos.
4. FINAL CONSENT: Formal authorization to file.

WHEN USER AUTHORIZES ("Proceed", "Submit", "Send it", "File it"):
- Set "is_complete": true.
- Reply with a final confirmation: "Understood. I am cryptographically signing your report now and dispatching it to the relevant department. We'll get this sorted out."

CRITICAL INSTRUCTION: Respond ONLY with a raw JSON object. Do not include markdown formatting or conversational preamble.

{
    "is_complete": true/false,
    "reply_message": "Warm, natural, state-aware response",
    "compiled_summary": "Detailed summary of facts for the official record.",
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
# Inside backend/brain/nodes/ingest_node.py

async def ingest_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    execution_ts = datetime.now(timezone.utc)
    thread_id = state.get("thread_id", config.get("configurable", {}).get("thread_id", "unknown"))
    
    with tracer.start_as_current_span("ingest_node") as span:
        logger.info(f"\n🟢 [INGEST NODE] Starting processing for thread: {thread_id}")

        # 🚨 FIX 2: BYPASS THE DB MEMORY. Read directly from the HTTP Payload!
        configurable = config.get("configurable", {})
        raw_payload = configurable.get("raw_payload", {})
        
        user_input = raw_payload.get("text_message", state.get("user_input", ""))
        image_url = raw_payload.get("image_url", state.get("image_url"))
        location_raw = raw_payload.get("location", state.get("location_raw", {}))
        
        vlm_output = state.get("vlm_output")

        # The VLM Skip check
        if image_url and not vlm_output:
            logger.info("Ingest: Unverified image detected. Deferring to VLM Forensics.")
            return {"current_status": "VERIFYING_IMAGE"}
            
        try:
            # 2. Validation & Sanitization
            validated = WhatsAppPayload(
                text_body=user_input,
                image_url=image_url,
                latitude=location_raw.get("lat"),
                longitude=location_raw.get("lon"),
                language_code="en"
            )
            
            safe_text = _sanitize_input(validated.text_body)
            if any(pat.search(safe_text) for pat in INJECTION_PATTERNS):
                return {"is_grievance_complete": False, "conversational_reply": "I am unable to process that request. Let's start over—what is the issue you're facing?"}

            scrubbed_text, _ = _scrub_pii(safe_text)
            has_gps = validated.latitude is not None and validated.longitude is not None
            
            # 3. VLM Context Injection
            vlm_context = ""
            if vlm_output:
                img_desc = vlm_output.get("image_description", "No description provided.")
                vlm_context = f"\n[SYSTEM: VLM analyzed attached image. Description: {img_desc}]\n"

            # 4. Prompt Construction
            previous_reply = state.get("conversational_reply", "None (First contact)")
            previous_summary = state.get("extracted_text", "None")

            ai_context = f"""
            --- PREVIOUS CONTEXT ---
            What you just asked the user: "{previous_reply}"
            Grievance details gathered so far: "{previous_summary}"
            
            --- CURRENT INPUT ---
            User's New Message: "{scrubbed_text}"
            Has GPS Coords: {str(has_gps).lower()}
            Image Attached: {str(bool(validated.image_url)).lower()}
            {vlm_context}
            """
            
            logger.info(f"🧠 [THINKING LAYER] Sending prompt to Groq...\n{ai_context}")
            
            # 5. Groq Execution
            response = await gatekeeper_llm.ainvoke([
                SystemMessage(content=GATEKEEPER_PROMPT),
                HumanMessage(content=ai_context)
            ])
            
            logger.info(f"🤖 [THINKING LAYER] Groq Raw Response: {response.content}")
            
            # 6. JSON Extraction
            raw_content = response.content.strip()
            start_idx = raw_content.find('{')
            end_idx = raw_content.rfind('}')
            
            if start_idx != -1 and end_idx != -1:
                raw_content = raw_content[start_idx:end_idx+1]
                
            parsed_intent = json.loads(raw_content)
            logger.info(f"✅ [THINKING LAYER] Parsed Successfully: {parsed_intent}")

            image_hash = hashlib.sha256(str(validated.image_url).encode("utf-8")).hexdigest() if validated.image_url else None

            # 7. State Updates
            return {
                "extracted_text": parsed_intent.get("compiled_summary", scrubbed_text),
                "image_hash": image_hash,
                "is_grievance_complete": parsed_intent.get("is_complete", False),
                "conversational_reply": parsed_intent.get("reply_message", "Processing..."),
                "issue_category": parsed_intent.get("issue_category"),
                "severity_level": parsed_intent.get("severity_level"),
                "current_status": "PENDING_DETAILS",
                "status_updates": [{
                    "node": "ingest", 
                    "action": "payload_processed", 
                    "is_complete": parsed_intent.get("is_complete", False),
                    "ts": execution_ts.isoformat()
                }]
            }

        except Exception as e:
            logger.error(f"❌ [CRITICAL ERROR] Ingest Node Failure: {str(e)}", exc_info=True)
            span.record_exception(e)
            return {
                "is_grievance_complete": False,
                "conversational_reply": "I'm so sorry, my system had a minor hiccup trying to process that. Could you please say that one more time?"
            }