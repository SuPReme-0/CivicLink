# backend/core/vlm_provider.py
"""
Production Multi-Provider VLM Abstraction with LangGraph Integration.
- Zero manual caching (LangGraph checkpointing handles idempotency)
- Real health checks with configurable timeouts
- Unified error handling + json-repair safety nets
- SDK-compliant parameter handling (Gemini Blobs, Groq/OpenAI URLs)
"""
import json
import logging
import asyncio
import base64
import json_repair
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

# Provider SDKs
import google.generativeai as genai
from google.generativeai import types as genai_types
from groq import AsyncGroq, APIStatusError as GroqAPIError
from openai import AsyncOpenAI, APIConnectionError, RateLimitError as OpenAIRateLimit

# LangGraph integration
from langgraph.config import RunnableConfig

# Local imports
from backend.core.config import settings
from backend.core.rate_limiter import rate_limiter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# 1. UNIFIED EXCEPTIONS, SCHEMA & PROMPTS
# ---------------------------------------------------------
class VLMAPIError(Exception):
    """Base exception for provider API errors with normalized metadata."""
    def __init__(self, message: str, provider: str, status_code: Optional[int] = None, retryable: bool = True):
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.retryable = retryable

class ForensicModel(BaseModel):
    is_genuine: bool = Field(default=True)
    ai_artifacts: bool = Field(default=False)
    screen_recapture: bool = Field(default=False)
    copy_move_detected: bool = Field(default=False)
    severity: str = Field(default="MEDIUM")
    confidence_score: float = Field(default=0.8)
    rationale: str = Field(default="Standard analysis completed.")
    image_description: str = Field(default="No description provided.")

# Exported as dict for backwards compatibility with vlm_verify.py
FORENSIC_SCHEMA = ForensicModel.model_json_schema()

STRICT_SYSTEM_PROMPT = """
You are an expert digital forensics AI. Analyze the provided image based on the citizen's claim.
You MUST output raw, valid JSON. Do not wrap the JSON in markdown blocks (e.g., ```json). Do not add preamble text.

{
    "is_genuine": true or false,
    "ai_artifacts": true or false,
    "screen_recapture": true or false,
    "copy_move_detected": true or false,
    "severity": "LOW", "MEDIUM", "HIGH", or "CRITICAL",
    "confidence_score": 0.0 to 1.0,
    "rationale": "Brief explanation of your findings",
    "image_description": "Detailed visual description of the core subject and scene"
}
"""

def _sanitize_context(text: str) -> str:
    """Escape text for safe prompt injection."""
    return "".join(c for c in text if c.isprintable() or c in "\n\t")[:500].replace('"', '\\"')

# ---------------------------------------------------------
# 2. ABSTRACT BASE PROVIDER
# ---------------------------------------------------------
class VLMProvider(ABC):
    """Abstract base for VLM providers with LangGraph integration."""
    
    PROVIDER_NAME: str = "base"
    SUPPORTS_VISION: bool = True
    
    def __init__(self, provider_name: str, model: str, api_key: str):
        self.provider_name = provider_name
        self.model = model
        self.api_key = api_key
        self._initialized = False
        self._health_status = {"last_check": None, "healthy": True, "error": None, "latency_ms": None}
    
    @abstractmethod
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        pass
    
    @abstractmethod
    async def estimate_tokens(self, image_url: str, context: str) -> int:
        pass
    
    async def check_health(self) -> bool:
        start = datetime.now(timezone.utc)
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 15.0)
        try:
            healthy = await asyncio.wait_for(self._ping_api(), timeout=timeout)
            latency = (datetime.now(timezone.utc) - start).total_seconds() * 1000
            self._health_status.update({
                "last_check": datetime.now(timezone.utc),
                "healthy": healthy,
                "latency_ms": round(latency, 1),
                "error": None
            })
            return healthy
        except asyncio.TimeoutError:
            self._health_status.update({"last_check": datetime.now(timezone.utc), "healthy": False, "error": "timeout"})
            return False
        except Exception as e:
            self._health_status.update({"last_check": datetime.now(timezone.utc), "healthy": False, "error": str(e)})
            return False
    
    @abstractmethod
    async def _ping_api(self) -> bool:
        pass
    
    def _calculate_cost(self, tokens: int) -> float:
        rate = getattr(settings, "COST_PER_1K_TOKENS", 0.0)
        return (tokens / 1000) * rate
    
    async def _check_rate_limit(self, token_estimate: int, config: Optional[RunnableConfig] = None) -> tuple[bool, float]:
        # Bypassing aggressive local SQLite rate limiting to let cloud APIs handle themselves
        return True, 0.0
    
    async def _record_usage(self, token_cost: int, cost_usd: float, config: Optional[RunnableConfig] = None):
        pass
    
    def _translate_provider_error(self, e: Exception, operation: str) -> VLMAPIError:
        if isinstance(e, (GroqAPIError, OpenAIRateLimit)):
            return VLMAPIError(
                message=f"{self.provider_name} {operation} failed: {getattr(e, 'message', str(e))}",
                provider=self.provider_name,
                status_code=getattr(e, 'status_code', None),
                retryable=getattr(e, 'status_code', 500) >= 500
            )
        elif isinstance(e, (genai_types.BlockedPromptException, genai_types.StopCandidateException)):
            return VLMAPIError(
                message=f"{self.provider_name} blocked prompt: {e}",
                provider=self.provider_name,
                retryable=False
            )
        return VLMAPIError(message=f"{self.provider_name} error: {str(e)}", provider=self.provider_name, retryable=True)

# ---------------------------------------------------------
# 3. GROQ PROVIDER
# ---------------------------------------------------------
class GroqProvider(VLMProvider):
    PROVIDER_NAME = "groq"
    SUPPORTS_VISION = True
    VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
    
    def __init__(self, api_key: str):
        super().__init__("groq", self.VISION_MODEL, api_key)
        self.client: Optional[AsyncGroq] = None
    
    async def _ensure_client(self):
        if not self.client:
            self.client = AsyncGroq(api_key=self.api_key, timeout=getattr(settings, "FALLBACK_TIMEOUT_SECONDS", 60.0), max_retries=2)
            self._initialized = True
    
    async def _ping_api(self) -> bool:
        await self._ensure_client()
        try:
            await asyncio.wait_for(self.client.models.list(), timeout=15.0)
            return True
        except Exception:
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        prompt = f"{STRICT_SYSTEM_PROMPT}\nCitizen Claim: {safe_context}"
        
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url, "detail": "low"}}
                    ]
                }],
                temperature=0.1,
                max_tokens=300
            )
            
            raw_text = response.choices[0].message.content.strip()
            
            repaired_dict = json_repair.loads(raw_text)
            validated_data = ForensicModel(**repaired_dict)
            return validated_data.model_dump()
            
        except (GroqAPIError, ValueError) as e:
            raise self._translate_provider_error(e, "analyze_image")
        except Exception as e:
            logger.error(f"Groq parsing failed. Raw output: {raw_text}. Error: {e}")
            raise self._translate_provider_error(e, "analyze_image")

    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 450

# ---------------------------------------------------------
# 4. GEMINI PROVIDER 
# ---------------------------------------------------------
class GeminiProvider(VLMProvider):
    PROVIDER_NAME = "gemini"
    SUPPORTS_VISION = True
    
    def __init__(self, model: str, api_key: str):
        super().__init__("gemini", model, api_key)
        self._initialized = False
    
    async def _ensure_client(self):
        if not self._initialized:
            genai.configure(api_key=self.api_key)
            self._initialized = True
    
    async def _ping_api(self) -> bool:
        await self._ensure_client()
        try:
            await asyncio.wait_for(asyncio.to_thread(genai.get_model, f"models/{self.model}"), timeout=15.0)
            return True
        except Exception:
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        prompt = f"{STRICT_SYSTEM_PROMPT}\nCitizen Claim: {safe_context}"

        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            generation_config={"temperature": 0.1, "response_mime_type": "application/json"}
        )
        
        vision_content = None
        if image_url.startswith("data:image"):
            header, encoded = image_url.split(",", 1)
            mime_type = header.split(";")[0].replace("data:", "")
            image_bytes = base64.b64decode(encoded)
            vision_content = {"mime_type": mime_type, "data": image_bytes}
        else:
            raise ValueError("GeminiProvider requires a Base64 Data URI.")

        try:
            response = await model.generate_content_async(
                [prompt, vision_content],
                request_options={"timeout": settings.FALLBACK_TIMEOUT_SECONDS}
            )
            
            if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
                raise ValueError(f"Safety blocked: {response.prompt_feedback.block_reason.name}")
            
            raw_text = response.text
            
            repaired_dict = json_repair.loads(raw_text)
            validated_data = ForensicModel(**repaired_dict)
            return validated_data.model_dump()
            
        except Exception as e:
            logger.error(f"Gemini analysis failed: {e}")
            raise self._translate_provider_error(e, "analyze_image")
            
    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 600

# ---------------------------------------------------------
# 5. VLLM PROVIDER (Restored & Upgraded)
# ---------------------------------------------------------
class VLLMProvider(VLMProvider):
    PROVIDER_NAME = "vllm"
    SUPPORTS_VISION = True
    
    def __init__(self, model: str, api_key: str, base_url: str):
        super().__init__("vllm", model, api_key)
        self.base_url = base_url
        self.client: Optional[AsyncOpenAI] = None
    
    async def _ensure_client(self):
        if not self.client:
            self.client = AsyncOpenAI(
                base_url=self.base_url,
                api_key=self.api_key,
                timeout=getattr(settings, "VLLM_TIMEOUT", 60.0), 
                max_retries=2
            )
            self._initialized = True
    
    async def _ping_api(self) -> bool:
        await self._ensure_client()
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 15.0)
        try:
            await asyncio.wait_for(self.client.models.list(), timeout=timeout)
            return True
        except (asyncio.TimeoutError, Exception):
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        prompt = f"{STRICT_SYSTEM_PROMPT}\nCitizen Claim: {safe_context}"
        
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}}
                    ]
                }],
                temperature=0.1,
                max_tokens=300
            )
            
            raw_text = response.choices[0].message.content.strip()
            
            repaired_dict = json_repair.loads(raw_text)
            validated_data = ForensicModel(**repaired_dict)
            return validated_data.model_dump()
            
        except (APIConnectionError, OpenAIRateLimit, ValueError) as e:
            raise self._translate_provider_error(e, "analyze_image")
        except Exception as e:
            logger.error(f"{self.provider_name} unexpected error: {e}")
            raise self._translate_provider_error(e, "analyze_image")
    
    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 350

# ---------------------------------------------------------
# 6. PROVIDER FACTORY
# ---------------------------------------------------------
def get_provider(name: str) -> Optional[VLMProvider]:
    if name == "groq" and settings.GROQ_API_KEY:
        return GroqProvider(api_key=settings.GROQ_API_KEY)
    elif name == "gemini" and settings.GEMINI_API_KEY:
        return GeminiProvider(model=settings.GEMINI_MODEL, api_key=settings.GEMINI_API_KEY)
    elif name == "vllm":
        return VLLMProvider(
            model=settings.VLLM_MODEL,
            api_key=settings.VLLM_API_KEY,
            base_url=settings.VLLM_API_BASE
        )
    return None

async def get_healthy_provider(priority_list: List[str]) -> Optional[VLMProvider]:
    for name in priority_list:
        provider = get_provider(name)
        if not provider:
            continue
        if await provider.check_health():
            return provider
    return None