# backend/core/vlm_provider.py
"""
Production Multi-Provider VLM Abstraction with LangGraph Integration.
- Zero manual caching (LangGraph checkpointing handles idempotency)
- Real health checks with configurable timeouts
- Unified error handling + safety filter support
- Per-thread rate limiting via RunnableConfig propagation
- SDK-compliant parameter handling (Gemini GenerationConfig, Groq vision format)
"""
import json
import logging
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone, timedelta
from abc import ABC, abstractmethod

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
# 1. UNIFIED EXCEPTIONS & SCHEMA
# ---------------------------------------------------------
class VLMAPIError(Exception):
    """Base exception for provider API errors with normalized metadata."""
    def __init__(self, message: str, provider: str, status_code: Optional[int] = None, retryable: bool = True):
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.retryable = retryable

# Shared forensic analysis schema (enforced by all providers)
FORENSIC_SCHEMA = {
    "type": "object",
    "properties": {
        "is_genuine": {"type": "boolean"},
        "ai_artifacts": {"type": "boolean"},
        "screen_recapture": {"type": "boolean"},
        "copy_move_detected": {"type": "boolean"},
        "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
        "confidence_score": {"type": "number", "minimum": 0.0, "maximum": 1.0},
        "rationale": {"type": "string"}
    },
    "required": ["is_genuine", "confidence_score", "severity", "rationale"],
    "additionalProperties": False
}

def _sanitize_context(text: str) -> str:
    """Escape text for safe prompt injection."""
    return "".join(c for c in text if c.isprintable() or c in "\n\t")[:500].replace('"', '\\"')

# ---------------------------------------------------------
# 2. ABSTRACT BASE PROVIDER (Fixed Signature)
# ---------------------------------------------------------
class VLMProvider(ABC):
    """Abstract base for VLM providers with LangGraph integration."""
    
    PROVIDER_NAME: str = "base"
    SUPPORTS_VISION: bool = True
    
    def __init__(self, provider_name: str, model: str, api_key: str):
        """
        Initialize provider with explicit name propagation.
        Fixes Bug #3: Ensures provider_name is always set correctly.
        """
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
        """Real lightweight health check via API ping with configurable timeout."""
        start = datetime.now(timezone.utc)
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 3.0)  # Fix #5: Use settings
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
            self._health_status.update({
                "last_check": datetime.now(timezone.utc),
                "healthy": False,
                "error": "timeout"
            })
            return False
        except Exception as e:
            self._health_status.update({
                "last_check": datetime.now(timezone.utc),
                "healthy": False,
                "error": str(e)
            })
            logger.warning(f"Health check failed for {self.provider_name}: {e}")
            return False
    
    @abstractmethod
    async def _ping_api(self) -> bool:
        """Provider-specific lightweight ping implementation."""
        pass
    
    def _calculate_cost(self, tokens: int) -> float:
        key = f"{self.provider_name}/{self.model}"
        rate = settings.COST_PER_1K_TOKENS.get(key, 0.0)
        return (tokens / 1000) * rate
    
    async def _check_rate_limit(self, token_estimate: int, config: Optional[RunnableConfig] = None) -> tuple[bool, float]:
        configurable = config.get("configurable", {}) if config else {}
        thread_id = configurable.get("thread_id", "default")
        api_key_hash = f"{self.provider_name}_{hash(self.api_key + thread_id) % 10000}"
        
        return await rate_limiter.allow_request(
            provider=self.provider_name,
            api_key_hash=api_key_hash,
            token_cost=token_estimate,
            model=self.model
        )
    
    async def _record_usage(self, token_cost: int, cost_usd: float, config: Optional[RunnableConfig] = None):
        if not settings.ENABLE_COST_TRACKING:
            return
        configurable = config.get("configurable", {}) if config else {}
        thread_id = configurable.get("thread_id", "default")
        api_key_hash = f"{self.provider_name}_{hash(self.api_key + thread_id) % 10000}"
        
        await rate_limiter.record_usage(
            provider=self.provider_name,
            api_key_hash=api_key_hash,
            token_cost=token_cost,
            model=self.model,
            cost_usd=cost_usd
        )
    
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
        return VLMAPIError(
            message=f"{self.provider_name} {operation} error: {str(e)}",
            provider=self.provider_name,
            retryable=True
        )

# ---------------------------------------------------------
# 3. GROQ PROVIDER (Vision-Capable, Fixed Format)
# ---------------------------------------------------------
class GroqProvider(VLMProvider):
    PROVIDER_NAME = "groq"
    SUPPORTS_VISION = True
    VISION_MODEL = "llama-3.2-90b-vision-preview"
    
    def __init__(self, api_key: str):
        # Fix #3: Explicit provider_name propagation
        super().__init__("groq", self.VISION_MODEL, api_key)
        self.client: Optional[AsyncGroq] = None
    
    async def _ensure_client(self):
        if not self.client:
            self.client = AsyncGroq(
                api_key=self.api_key,
                timeout=settings.FALLBACK_TIMEOUT_SECONDS,
                max_retries=2
            )
            self._initialized = True
    
    async def _ping_api(self) -> bool:
        await self._ensure_client()
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 3.0)
        try:
            await asyncio.wait_for(self.client.models.list(), timeout=timeout)
            return True
        except (asyncio.TimeoutError, Exception):
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        
        # Fix #2: JSON enforced via prompt ONLY (no response_format with vision)
        prompt = f"""
        Forensic image analysis. Citizen claim: "{safe_context}"
        Analyze the linked image for authenticity.
        Respond STRICTLY in valid JSON format matching this schema:
        {json.dumps(FORENSIC_SCHEMA)}
        Do not include markdown, explanations, or any text outside the JSON object.
        """
        
        token_estimate = await self.estimate_tokens(image_url, safe_context)
        allowed, wait_sec = await self._check_rate_limit(token_estimate, config)
        if not allowed:
            raise TimeoutError(f"{self.provider_name} rate limited. Wait {wait_sec:.1f}s")
        
        try:
            # Fix #2: Add detail parameter + remove response_format for vision compatibility
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}}
                    ]
                }],
                # response_format REMOVED for vision model compatibility
                temperature=0.1,
                max_tokens=300
            )
            
            content = response.choices[0].message.content.strip()
            # Defensive markdown stripping
            if content.startswith("```json"):
                content = content[7:-3].strip()
            elif content.startswith("```"):
                content = content[3:-3].strip()
            
            result = json.loads(content)
            
            # Validate schema compliance
            for field in FORENSIC_SCHEMA["required"]:
                if field not in result:
                    raise ValueError(f"Missing required field: {field}")
            
            actual_tokens = getattr(response.usage, "total_tokens", token_estimate)
            cost = self._calculate_cost(actual_tokens)
            await self._record_usage(actual_tokens, cost, config)
            
            return result
            
        except (GroqAPIError, json.JSONDecodeError, ValueError) as e:
            raise self._translate_provider_error(e, "analyze_image")
        except Exception as e:
            logger.error(f"{self.provider_name} unexpected error: {e}")
            raise self._translate_provider_error(e, "analyze_image")

    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 450

# ---------------------------------------------------------
# 4. GEMINI PROVIDER (Fixed GenerationConfig + Safety)
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
        # Fix #1: Use simple model listing instead of generation call
        await self._ensure_client()
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 3.0)
        try:
            await asyncio.wait_for(
                asyncio.to_thread(genai.get_model, f"models/{self.model}"),
                timeout=timeout
            )
            return True
        except (asyncio.TimeoutError, Exception):
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        
        # Fix #1: Use explicit GenerationConfig object instead of raw dict
        generation_config = genai_types.GenerationConfig(
            temperature=0.1,
            max_output_tokens=300,
            response_mime_type="application/json",
            response_schema=FORENSIC_SCHEMA,
        )
        
        model = genai.GenerativeModel(
            model_name=self.model,
            generation_config=generation_config,
            safety_settings=settings.GEMINI_SAFETY_SETTINGS
        )
        
        prompt = f"Forensic analysis. Claim: {safe_context}. Output JSON only."
        
        token_estimate = await self.estimate_tokens(image_url, safe_context)
        allowed, wait_sec = await self._check_rate_limit(token_estimate, config)
        if not allowed:
            raise TimeoutError(f"{self.provider_name} rate limited. Wait {wait_sec:.1f}s")
        
        try:
            response = await model.generate_content_async(
                [prompt, {"image_url": image_url}],
                request_options={"timeout": settings.FALLBACK_TIMEOUT_SECONDS}
            )
            
            # Handle safety-blocked responses
            if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
                logger.warning(f"Gemini safety blocked: {response.prompt_feedback.block_reason}")
                return {
                    "is_genuine": False,
                    "ai_artifacts": False,
                    "screen_recapture": False,
                    "copy_move_detected": False,
                    "severity": "MEDIUM",
                    "confidence_score": 0.0,
                    "rationale": f"safety_blocked:{response.prompt_feedback.block_reason.name}"
                }
            
            # Parse JSON response
            if hasattr(response, 'parsed') and isinstance(response.parsed, dict):
                result = response.parsed
            elif response.text:
                result = json.loads(response.text)
            else:
                raise ValueError("Empty response from Gemini")
            
            for field in FORENSIC_SCHEMA["required"]:
                if field not in result:
                    raise ValueError(f"Missing required field: {field}")
            
            usage = getattr(response, 'usage_metadata', {})
            tokens = usage.get('total_token_count', token_estimate)
            cost = self._calculate_cost(tokens)
            await self._record_usage(tokens, cost, config)
            
            return result
            
        except genai_types.StopCandidateException as e:
            logger.warning(f"Gemini StopCandidateException: {e}")
            return {
                "is_genuine": False,
                "confidence_score": 0.0,
                "severity": "MEDIUM",
                "rationale": "safety_filter_blocked"
            }
        except (genai_types.BlockedPromptException, json.JSONDecodeError, ValueError) as e:
            raise self._translate_provider_error(e, "analyze_image")
        except Exception as e:
            logger.error(f"{self.provider_name} unexpected error: {e}")
            raise self._translate_provider_error(e, "analyze_image")
    
    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 600

# ---------------------------------------------------------
# 5. VLLM PROVIDER (Fixed __init__ Signature)
# ---------------------------------------------------------
class VLLMProvider(VLMProvider):
    PROVIDER_NAME = "vllm"
    SUPPORTS_VISION = True
    
    def __init__(self, model: str, api_key: str, base_url: str):
        # Fix #3: Explicit provider_name propagation + local base_url storage
        super().__init__("vllm", model, api_key)
        self.base_url = base_url
        self.client: Optional[AsyncOpenAI] = None
    
    async def _ensure_client(self):
        if not self.client:
            self.client = AsyncOpenAI(
                base_url=self.base_url,
                api_key=self.api_key,
                timeout=settings.VLLM_TIMEOUT,
                max_retries=2
            )
            self._initialized = True
    
    async def _ping_api(self) -> bool:
        await self._ensure_client()
        timeout = getattr(settings, "PROVIDER_HEALTH_TIMEOUT", 3.0)
        try:
            await asyncio.wait_for(self.client.models.list(), timeout=timeout)
            return True
        except (asyncio.TimeoutError, Exception):
            return False
    
    async def analyze_image(self, image_url: str, context: str, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
        await self._ensure_client()
        safe_context = _sanitize_context(context)
        
        prompt = f"Forensic analysis. Claim: {safe_context}. JSON: {json.dumps(FORENSIC_SCHEMA)}"
        
        token_estimate = await self.estimate_tokens(image_url, safe_context)
        allowed, wait_sec = await self._check_rate_limit(token_estimate, config)
        if not allowed:
            raise TimeoutError(f"{self.provider_name} rate limited. Wait {wait_sec:.1f}s")
        
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
            
            content = response.choices[0].message.content.strip()
            if content.startswith("```json"):
                content = content[7:-3].strip()
            elif content.startswith("```"):
                content = content[3:-3].strip()
            
            result = json.loads(content)
            
            for field in FORENSIC_SCHEMA["required"]:
                if field not in result:
                    raise ValueError(f"Missing required field: {field}")
            
            tokens = getattr(response.usage, "total_tokens", token_estimate)
            await self._record_usage(tokens, 0.0, config)
            
            return result
            
        except (APIConnectionError, OpenAIRateLimit, json.JSONDecodeError, ValueError) as e:
            raise self._translate_provider_error(e, "analyze_image")
        except Exception as e:
            logger.error(f"{self.provider_name} unexpected error: {e}")
            raise self._translate_provider_error(e, "analyze_image")
    
    async def estimate_tokens(self, image_url: str, context: str) -> int:
        return 350

# ---------------------------------------------------------
# 6. PROVIDER FACTORY + HEALTH-AWARE SELECTION
# ---------------------------------------------------------
def get_provider(name: str) -> Optional[VLMProvider]:
    """Factory function to instantiate provider by name."""
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
    """Get first healthy provider from priority list with real health checks."""
    for name in priority_list:
        provider = get_provider(name)
        if not provider:
            logger.debug(f"Provider {name} not configured")
            continue
        if await provider.check_health():
            logger.info(f"Selected healthy provider: {name}")
            return provider
        logger.warning(f"Provider {name} unhealthy: {provider._health_status.get('error')}")
    return None