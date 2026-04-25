# backend/brain/nodes/contact.py
"""
Production OSINT Contact Discovery Node.

FEATURES:
- Playwright Stealth with isolated contexts + RAM leak prevention
- SQLite-backed domain reputation cache (WAL-mode multi-worker safe)
- Deterministic extraction + Obfuscation decoding (zero hallucination)
- MX Record + SMTP verification with cloud-provider Port 25 fallback
- Prisma-synced schema mapping (AdministrativeHierarchy compatible)
"""
import re
import asyncio
import logging
import hashlib
import json
from typing import Dict, Any, Optional, List, Set
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from pathlib import Path

import aiohttp
from backend.brain import state
import dns.resolver
import smtplib
import aiosqlite
from playwright.async_api import async_playwright, Page, Browser, BrowserContext, Route
from langgraph.config import RunnableConfig
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer

logger = logging.getLogger(__name__)
tracer = get_tracer("contact_discovery")

# ---------------------------------------------------------
# GLOBALS: SQLite Cache for Domain Reputation (Worker-Safe)
# ---------------------------------------------------------
REPUTATION_DB_PATH = Path(getattr(settings, "DATA_DIR", "data")) / "domain_reputation.db"
REPUTATION_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

async def _init_reputation_db() -> aiosqlite.Connection:
    """Initialize SQLite cache for domain reputation with concurrency locks."""
    db = await aiosqlite.connect(REPUTATION_DB_PATH)
    # 🚨 FIX: Enable WAL mode for multi-worker safety
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA synchronous=NORMAL;")
    
    await db.execute("""
        CREATE TABLE IF NOT EXISTS reputation (
            domain TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            failure_count INTEGER DEFAULT 0,
            last_checked TEXT NOT NULL,
            next_check TEXT
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_reputation_next_check ON reputation(next_check)")
    await db.commit()
    return db

_reputation_db: Optional[aiosqlite.Connection] = None

async def _get_reputation_db() -> aiosqlite.Connection:
    global _reputation_db
    if _reputation_db is None:
        _reputation_db = await _init_reputation_db()
    return _reputation_db

async def _check_domain_reputation(domain: str) -> bool:
    """Check if domain should be scraped based on reputation cache."""
    db = await _get_reputation_db()
    now = datetime.now(timezone.utc).isoformat()
    
    async with db.execute(
        "SELECT status, failure_count, next_check FROM reputation WHERE domain = ?",
        (domain,)
    ) as cursor:
        row = await cursor.fetchone()
        if not row:
            return True  # No record = allow
        
        status, fail_count, next_check = row
        if next_check and now < next_check:
            return False  # Still in cooldown
        if status == "blocked" and fail_count >= 3:
            return False  # Permanently blocked
        return True

async def _record_domain_status(domain: str, status: str, success: bool):
    """Record scraping outcome in reputation cache with exponential backoff."""
    db = await _get_reputation_db()
    now = datetime.now(timezone.utc)
    
    if success:
        next_check = (now + timedelta(hours=6)).isoformat()  # Recheck in 6h
        failure_count = 0
    else:
        async with db.execute("SELECT failure_count FROM reputation WHERE domain = ?", (domain,)) as cursor:
            row = await cursor.fetchone()
            current_fails = row[0] if row else 0
            new_fails = min(current_fails + 1, 4)
            backoff_hours = min(2 ** new_fails, 8)
            next_check = (now + timedelta(hours=backoff_hours)).isoformat()
            failure_count = new_fails
    
    await db.execute("""
        INSERT INTO reputation (domain, status, failure_count, last_checked, next_check)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET
            status = excluded.status,
            failure_count = excluded.failure_count,
            last_checked = excluded.last_checked,
            next_check = excluded.next_check
    """, (domain, status, failure_count, now.isoformat(), next_check))
    await db.commit()

# ---------------------------------------------------------
# 1. PLAYWRIGHT MANAGER (Isolated Contexts + RAM Cleanup)
# ---------------------------------------------------------
class PlaywrightManager:
    """Manages Playwright lifecycle with isolated contexts per session."""
    _playwright = None
    _browser: Optional[Browser] = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_context(cls, session_id: str) -> BrowserContext:
        """Create isolated browser context for a single scraping session."""
        async with cls._lock:
            if cls._browser is None or not cls._browser.is_connected():
                cls._playwright = await async_playwright().start()
                cls._browser = await cls._playwright.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu"
                    ]
                )
            
            # Isolated context: No cookie sharing
            context = await cls._browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent=getattr(settings, "USER_AGENT", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
                locale="en-US",
                storage_state=None, 
                bypass_csp=True
            )
            
            # Anti-detection script
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                window.chrome = {runtime: {}};
                navigator.languages = ['en-US', 'en'];
                navigator.plugins = {length: 5};
            """)
            
            # Block non-essential resources for speed
            async def block_resources(route: Route):
                if route.request.resource_type in ["image", "stylesheet", "font", "media"]:
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*", block_resources)
            
            return context

    @classmethod
    async def close(cls):
        """Graceful shutdown: close browser + stop Playwright entirely."""
        async with cls._lock:
            if cls._browser:
                await cls._browser.close()
                cls._browser = None
            if cls._playwright:
                # 🚨 FIX: Stops the zombie processes from eating RAM
                await cls._playwright.stop()
                cls._playwright = None

# ---------------------------------------------------------
# 2. CAPTCHA DETECTION & HANDLING
# ---------------------------------------------------------
CAPTCHA_SELECTORS = [
    "#captcha", ".g-recaptcha", ".h-captcha", "iframe[src*='recaptcha']",
    "div[class*='captcha']", "img[alt*='captcha']", "#challenge-running",
    "#turnstile-wrapper", ".cf-turnstile"
]
CLOUDFLARE_INDICATORS = ["checking your browser", "ray id", "cf-chl", "turnstile", "just a moment"]

async def _detect_captcha(page: Page) -> Optional[str]:
    for sel in CAPTCHA_SELECTORS:
        if await page.query_selector(sel):
            return "captcha_detected"
    page_text = (await page.inner_text("body"))[:500].lower()
    if any(ind in page_text for ind in CLOUDFLARE_INDICATORS):
        return "cloudflare_challenge"
    return None

async def _handle_captcha(page: Page, captcha_type: str) -> bool:
    """Attempt graceful bypass via delay + refresh."""
    logger.warning(f"{captcha_type} detected. Attempting delay + refresh.")
    await asyncio.sleep(5)
    
    if captcha_type == "cloudflare_challenge":
        await page.wait_for_timeout(3000)
        return not await _detect_captcha(page)
    
    try:
        await page.reload(wait_until="domcontentloaded")
        await asyncio.sleep(2)
        return not await _detect_captcha(page)
    except Exception:
        return False

# ---------------------------------------------------------
# 3. CONTACT EXTRACTION ENGINE (Prisma-Synced)
# ---------------------------------------------------------
# 🚨 FIX: Schema synced to Prisma's AdministrativeHierarchy fields
class ContactSchema(BaseModel):
    officialDesignation: str = Field(default="Official")
    officialName: Optional[str] = None
    officialEmail: Optional[str] = None
    phone: Optional[str] = None  # Ephemeral context
    portalUrl: Optional[str] = None
    source_url: str
    status: str = Field(default="PENDING")  # Maps to VerificationStatus Enum
    confidenceScore: float = Field(default=0.5, ge=0.0, le=1.0)

# Regex patterns with Unicode support
EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", re.UNICODE)
PHONE_IN_PATTERN = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{9}")
DESIGNATION_HINTS = re.compile(
    r"\b(?:Director|Commissioner|Officer|Secretary|Chief|Head|Warden|Engineer|Inspector|अधिकारी|আধিকারিক)\b",
    re.I | re.UNICODE
)

OBFUSCATION_PATTERNS = [
    (re.compile(r"\b([\w.+-]+)\s*\[at\]\s*([\w.-]+)\s*\[dot\]\s*(\w+)", re.I), r"\1@\2.\3"),
    (re.compile(r"\b([\w.+-]+)\s*@?\s*([\w.-]+)\s*\.?\s*(\w+)", re.I), r"\1@\2.\3"),
]

def _decode_obfuscated_email(text: str) -> Optional[str]:
    """Decode common email obfuscation patterns (e.g. name [at] nic [dot] in)."""
    for pattern, replacement in OBFUSCATION_PATTERNS:
        match = pattern.search(text)
        if match:
            decoded = pattern.sub(replacement, match.group(0))
            if EMAIL_PATTERN.match(decoded):
                return decoded
    return None

def _deterministic_extract(html: str, url: str) -> List[ContactSchema]:
    """Extract contacts using regex + DOM structure. Zero hallucination."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()
    
    contacts = []
    paragraphs = [p.get_text(strip=True) for p in soup.find_all(["p", "div", "td", "li", "span"]) if p.get_text(strip=True)]
    
    for para in paragraphs:
        decoded_email = _decode_obfuscated_email(para)
        emails = [decoded_email] if decoded_email else EMAIL_PATTERN.findall(para)
        phones = list(set(PHONE_IN_PATTERN.findall(para)))
        designations = DESIGNATION_HINTS.findall(para)
        
        if emails:
            for email in emails:
                contacts.append(ContactSchema(
                    officialDesignation=" ".join(designations) if designations else "Official",
                    officialEmail=email,
                    phone=phones[0] if phones else None,
                    source_url=url,
                    portalUrl=url,
                    confidenceScore=0.8 if designations else 0.6
                ))
    
    # Deduplicate by email
    unique = {c.officialEmail: c for c in contacts if c.officialEmail}
    return list(unique.values())

# ---------------------------------------------------------
# 4. VERIFICATION ENGINE (Cloud-Safe SMTP)
# ---------------------------------------------------------
def _verify_mx(email: str) -> bool:
    try:
        domain = email.split("@")[1]
        dns.resolver.resolve(domain, "MX")
        return True
    except Exception:
        return False

async def _verify_smtp_async(email: str) -> str:
    """
    Returns 'VERIFIED_SMTP' if 250 OK, 
    'PENDING' if Port 25 blocked (cloud provider), 
    'FAILED' if rejected. Matches Prisma Enum exactly.
    """
    if not _verify_mx(email):
        return "FAILED"
    
    def sync_smtp_check() -> str:
        try:
            domain = email.split("@")[1]
            mx_records = dns.resolver.resolve(domain, "MX")
            mx_host = str(mx_records[0].exchange)
            
            server = smtplib.SMTP(timeout=3)
            server.connect(mx_host, 25)
            server.helo()
            server.mail("verify@civiclink.local")
            code, _ = server.rcpt(email)
            server.quit()
            return "VERIFIED_SMTP" if code == 250 else "FAILED"
        except (TimeoutError, smtplib.SMTPConnectError, OSError):
            # 🚨 FIX: Port 25 is likely blocked by AWS/GCP. Degrade gracefully.
            return "PENDING"
        except smtplib.SMTPRecipientsRefused:
            return "FAILED"
        except Exception:
            return "FAILED"
    
    return await asyncio.to_thread(sync_smtp_check)

def _contact_idempotency_key(contact: ContactSchema) -> str:
    """Generate deterministic hash for contact deduplication."""
    data = f"{contact.officialEmail or ''}|{contact.officialDesignation}|{contact.source_url}"
    return hashlib.sha256(data.encode()).hexdigest()

# ---------------------------------------------------------
# 5. URL GENERATION (Google IP-Ban Safe)
# ---------------------------------------------------------
def _generate_target_urls(jurisdiction: dict, retry: int) -> List[str]:
    """Generates prioritized scraping targets safely."""
    district = jurisdiction.get("district", "").strip().lower().replace(" ", "")
    state = jurisdiction.get("state", "").strip().lower().replace(" ", "")
    
    # 🚨 FIX: Removed Google search query to prevent instant reCAPTCHA blocks
    urls = [
        f"https://{district}.nic.in/en/contact-us",
        f"https://{district}.{state}.gov.in/contact",
        f"https://{state}.gov.in/departments/contact",
        f"https://{district}.nic.in/whos-who/"
    ]
    if retry > 0:
        urls.extend([
            f"https://{district}.nic.in/public-utility-category/municipality/",
            f"https://{state}.gov.in/grievance-redressal"
        ])
    
    sanitized = [u for u in urls if urlparse(u).netloc.endswith((".gov.in", ".nic.in"))]
    return list(dict.fromkeys(sanitized))[:4] 

# ---------------------------------------------------------
# 6. THE GRAPH NODE (Production-Hardened)
# ---------------------------------------------------------
async def contact_discovery_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    """
    LangGraph node: Discovers & verifies official contacts for resolved jurisdiction.
    """
    jurisdiction = state.get("jurisdiction_hierarchy", {})
    retry_count = state.get("retry_count", 0)
    session_id = state.get("session_id", "unknown")
    execution_ts = datetime.now(timezone.utc)
    
    if not jurisdiction.get("district"):
        return {
            "error_log": [{"node": "contact_discovery", "action": "missing_jurisdiction", "ts": execution_ts.isoformat()}],
            "status_updates": [{"node": "contact_discovery", "action": "skipped", "ts": execution_ts.isoformat()}]
        }

    with tracer.start_as_current_span("contact_discovery_node") as span:
        span.set_attribute("session_id", session_id)
        
        context = None
        try:
            context = await PlaywrightManager.get_context(session_id)
            visited = set(state.get("visited_urls", []))
            base_urls_to_scrape = _generate_target_urls(jurisdiction, retry_count)
            urls_to_scrape = [u for u in base_urls_to_scrape if u not in visited]            
            all_contacts: List[Dict[str, Any]] = []
            seen_ids: Set[str] = set()
            
            # Controlled concurrency: max 2 pages at once to prevent IP rate limits
            semaphore = asyncio.Semaphore(2)
            
            async def scrape_url(url: str) -> List[Dict[str, Any]]:
                async with semaphore:
                    domain = urlparse(url).netloc
                    if not await _check_domain_reputation(domain):
                        return []
                    
                    page = await context.new_page()
                    try:
                        timeout_ms = getattr(settings, "SCRAPER_TIMEOUT_MS", 15000)
                        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                        await page.wait_for_load_state("networkidle", timeout=5000)
                        
                        captcha = await _detect_captcha(page)
                        if captcha and not await _handle_captcha(page, captcha):
                            await _record_domain_status(domain, "blocked", success=False)
                            return []
                        
                        html = await page.content()
                        contacts = _deterministic_extract(html, url)
                        
                        verified_contacts = []
                        for contact in contacts:
                            key = _contact_idempotency_key(contact)
                            if key in seen_ids:
                                continue
                            seen_ids.add(key)
                            
                            if contact.officialEmail:
                                status = await _verify_smtp_async(contact.officialEmail)
                                contact.status = status
                                contact.confidenceScore = 0.98 if status == "VERIFIED_SMTP" else (0.75 if status == "PENDING" else 0.4)
                            
                            verified_contacts.append(contact.model_dump())
                        
                        await _record_domain_status(domain, "ok", success=bool(verified_contacts))
                        return verified_contacts
                        
                    except Exception as e:
                        logger.debug(f"Scraping failed for {url}: {e}")
                        await _record_domain_status(domain, "error", success=False)
                        return []
                    finally:
                        await page.close()
            
            # Execute concurrent scraping
            tasks = [scrape_url(url) for url in urls_to_scrape]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in results:
                if isinstance(result, list):
                    all_contacts.extend(result)
            
            if not all_contacts:
                return {
                    "error_log": [{"node": "contact_discovery", "action": "no_contacts_found", "ts": execution_ts.isoformat()}],
                    "status_updates": [{"node": "contact_discovery", "action": "empty_result", "ts": execution_ts.isoformat()}]
                }
            
            # Select primary contact
            primary = max(
                [c for c in all_contacts if c.get("status") == "VERIFIED_SMTP"],
                key=lambda x: x.get("confidenceScore", 0),
                default=None
            ) or all_contacts[0]
            
            return {
                "discovered_contacts": all_contacts,
                "primary_contact": primary,
                "visited_urls": urls_to_scrape,
                "status_updates": [{
                    "node": "contact_discovery",
                    "action": "contacts_discovered",
                    "count": len(all_contacts),
                    "verified_count": sum(1 for c in all_contacts if c.get("status") == "VERIFIED_SMTP"),
                    "ts": execution_ts.isoformat()
                }]
            }
            
        except Exception as e:
            logger.exception(f"Contact discovery critical failure: {e}")
            span.record_exception(e)
            return {
                "error_log": [{"node": "contact_discovery", "action": "critical_failure", "details": type(e).__name__, "ts": execution_ts.isoformat()}],
                "status_updates": [{"node": "contact_discovery", "action": "failed_safe", "ts": execution_ts.isoformat()}]
            }
        finally:
            # 🚨 FIX: Close the isolated context to prevent severe memory leaks
            if context:
                await context.close()

# ---------------------------------------------------------
# SHUTDOWN HOOK (Add to main.py)
# ---------------------------------------------------------
async def shutdown_contact_discovery():
    """Graceful shutdown: stop Playwright and close SQLite cache."""
    await PlaywrightManager.close()
    if _reputation_db:
        await _reputation_db.close()
        logger.info("Contact discovery node shutdown complete")