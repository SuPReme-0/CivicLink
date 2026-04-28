# backend/core/config.py
import secrets
from typing import List, Dict, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """
    CivicLink Master Configuration.
    Loaded automatically from the .env file. Fails fast if required variables are missing.
    """
    
    # ==========================================
    # GLOBAL APPLICATION SETTINGS
    # ==========================================
    PROJECT_NAME: str = "CivicLink Enterprise"
    APP_VERSION: str = "1.0.0" # 🚨 FIXED: Renamed to match main.py
    ENVIRONMENT: str = "development" # 'development' | 'production'
    DEBUG: bool = True
    
    # 🚨 ADDED: Missing infrastructure variables required by main.py
    LOG_LEVEL: str = "INFO"
    ENABLE_METRICS: bool = True
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    
    # Shared directories & identity
    DATA_DIR: str = "data" 
    USER_AGENT: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    
    # ==========================================
    # STAGE 1: DATA LAYER & SECURITY 
    # ==========================================
    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_KEY: str  
    
    # Cryptography & Zero-Trust
    ENCRYPTION_KEY: str = secrets.token_urlsafe(32) 
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    
    # Server-to-Server Auth (Next.js -> FastAPI)
    FRONTEND_API_KEY: str

    # ==========================================
    # STAGE 2: MULTI-PROVIDER AI BRAIN
    # ==========================================
    VLM_PROVIDER_PRIORITY: List[str] = ["groq", "gemini"]  # 🚨 FIXED: Renamed from VLM_PROVIDER_ORDER for clarity
    
    # 1. Gemini Configuration (Primary Vision)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_RATE_LIMIT_RPM: int = 15
    
    # 2. Groq Configuration (Primary Text/Drafting/RAG)
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_RATE_LIMIT_RPM: int = 30
    
    # 3. vLLM Configuration (Local Fallback)
    VLLM_API_BASE: str = "http://localhost:8000/v1"
    VLLM_API_KEY: str = "civiclink-local-key"
    VLLM_MODEL: str = "qwen2.5-vl-7b-instruct"
    
    # 4. Local Embeddings
    EMBEDDING_MODEL: str = "BAAI/bge-m3"

    # ==========================================
    # FORENSICS & RATE LIMITING
    # ==========================================
    VLLM_TIMEOUT: float = 10.0
    FORENSIC_FUSION_WEIGHTS: dict = {"vlm": 0.6, "ela": 0.2, "freq": 0.15, "exif": 0.05}
    SEVERITY_THRESHOLDS: Dict[str, float] = {
        "LOW": 0.6, "MEDIUM": 0.7, "HIGH": 0.8, "CRITICAL": 0.9 
    }
    
    # SQLite Native Rate Limiter Configuration
    SQLITE_TIMEOUT: int = 30 
    SQLITE_BUSY_TIMEOUT: int = 5000 
    RATE_LIMIT_BUCKET_SIZE: int = 100 
    RATE_LIMIT_REFILL_RATE: float = 10.0 
    VLM_CIRCUIT_TIMEOUT: int = 60 

    # ==========================================
    # STAGE 3: JURISDICTION RAG CONFIG
    # ==========================================
    EMBEDDING_MODEL_NAME: str = "BAAI/bge-small-en-v1.5"
    ENABLE_GPU_EMBEDDINGS: bool = False  
    MODEL_CACHE_DIR: str = "data/models"
    JURISDICTION_VECTOR_THRESHOLD: float = 0.75  
    JURISDICTION_GEO_TOLERANCE_KM: float = 5.0   

    # ==========================================
    # STAGE 4: OSINT SCRAPER CONFIG
    # ==========================================
    SCRAPER_TIMEOUT_MS: int = 15000
    MAX_CONCURRENT_PAGES: int = 2
    DOMAIN_REP_TTL_HOURS: int = 6  

    # ==========================================
    # STAGE 5a: DRAFTING NODE CONFIG
    # ==========================================
    GROQ_DRAFTING_MODEL: str = "llama-3.3-70b-versatile"  
    FALLBACK_TIMEOUT_SECONDS: int = 15
    MIN_CITATIONS_REQUIRED: int = 1
    MAX_CITATIONS_PER_DRAFT: int = 5

    # ==========================================
    # STAGE 5b: DISPATCH CONFIGURATION (SMTP)
    # ==========================================
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str
    SMTP_PASSWORD: str
    SMTP_USE_TLS: bool = True
    
    DISPATCH_FROM_EMAIL: str
    DISPATCH_DOMAIN: str
    
    DKIM_ENABLED: bool = False
    DKIM_PRIVATE_KEY: Optional[str] = None
    DKIM_SELECTOR: str = "civiclink"
    
    MAX_DISPATCH_RETRIES: int = 3

    # Configure Pydantic to load from .env and ignore extra fields
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

# Instantiate the singleton to be imported across the app
settings = Settings()