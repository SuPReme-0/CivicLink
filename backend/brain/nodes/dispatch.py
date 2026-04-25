# backend/brain/nodes/dispatch.py
"""
Production Dispatch Node: Email + Portal Delivery Engine.

FEATURES:
- SMTP dispatch with DKIM/SPF signing (raw byte transmission)
- SQLite Circuit Breaker (WAL-mode, timezone-safe queries)
- State-Safe Dictionary Merging (preserves previous confidence scores)
- Safe Infinite-Loop Prevention (explicit retry_count increments)
- Playwright Stealth context reuse (zero memory leaks)
"""
import asyncio
import logging
import hashlib
import dkim
from typing import Dict, Any, Optional, Literal, Tuple
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

import aiosmtplib
from langgraph.config import RunnableConfig

from backend.brain.state import CivicLinkState
from backend.core.config import settings
from backend.core.observability import get_tracer
from backend.brain.nodes.contact import PlaywrightManager  # 🚨 FIX: Reuse Playwright

logger = logging.getLogger(__name__)
tracer = get_tracer("dispatch_node")

# ---------------------------------------------------------
# GLOBALS: Idempotency Cache + Circuit Breaker
# ---------------------------------------------------------
DISPATCH_DB_PATH = getattr(settings, "DATA_DIR", "data") + "/dispatch_state.db"

async def _init_dispatch_db():
    import aiosqlite
    db = await aiosqlite.connect(DISPATCH_DB_PATH)
    # 🚨 FIX: Enable concurrent reads/writes for multi-worker safety
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA synchronous=NORMAL;")
    
    await db.execute("""
        CREATE TABLE IF NOT EXISTS dispatch_log (
            idempotency_key TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            target_email TEXT,
            portal_url TEXT,
            status TEXT NOT NULL,
            smtp_code INTEGER,
            error_details TEXT,
            retry_count INTEGER DEFAULT 0,
            next_retry TEXT,
            dispatched_at TEXT
        )
    """)
    await db.commit()
    return db

_dispatch_db = None

async def _get_dispatch_db():
    global _dispatch_db
    if _dispatch_db is None:
        _dispatch_db = await _init_dispatch_db()
    return _dispatch_db

def _generate_idempotency_key(state: CivicLinkState) -> str:
    # Uses tracking_id which was added in Patch 3
    data = f"{state.get('session_id')}|{state.get('tracking_id')}|{state.get('primary_contact', {}).get('officialEmail')}"
    return hashlib.sha256(data.encode()).hexdigest()

async def _check_idempotency(key: str) -> bool:
    db = await _get_dispatch_db()
    async with db.execute("SELECT status FROM dispatch_log WHERE idempotency_key = ?", (key,)) as cursor:
        row = await cursor.fetchone()
        return bool(row and row[0] in ("SENT", "DELIVERED", "PORTAL_SUBMITTED"))

async def _record_dispatch_attempt(key, session_id, target_email, portal_url, status, smtp_code=None, error_details=None, retry_count=0):
    db = await _get_dispatch_db()
    now = datetime.now(timezone.utc).isoformat()
    
    next_retry = None
    if status in ("FAILED", "BOUNCED") and retry_count < getattr(settings, "MAX_DISPATCH_RETRIES", 3):
        next_retry = (datetime.now(timezone.utc) + timedelta(seconds=min(2**retry_count, 300))).isoformat()
    
    await db.execute("""
        INSERT INTO dispatch_log (idempotency_key, session_id, target_email, portal_url, status, smtp_code, error_details, retry_count, next_retry, dispatched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
            status=excluded.status, smtp_code=excluded.smtp_code, error_details=excluded.error_details, 
            retry_count=excluded.retry_count, next_retry=excluded.next_retry, dispatched_at=excluded.dispatched_at
    """, (key, session_id, target_email, portal_url, status, smtp_code, error_details, retry_count, next_retry, now))
    await db.commit()

# ---------------------------------------------------------
# 1. SMTP DISPATCH ENGINE
# ---------------------------------------------------------
def _build_mime_message(subject, body_text, body_html, from_email, to_email, tracking_id) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=getattr(settings, "DISPATCH_DOMAIN", "civiclink.local"))
    msg["X-CivicLink-Tracking"] = tracking_id
    msg["Auto-Submitted"] = "auto-generated"
    
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    return msg

async def _send_smtp_async(msg_bytes: bytes, to_email: str) -> Tuple[int, str]:
    """Sends raw bytes via sendmail to support DKIM signatures safely."""
    try:
        smtp = aiosmtplib.SMTP(
            hostname=settings.SMTP_HOST, port=settings.SMTP_PORT,
            use_tls=settings.SMTP_USE_TLS, timeout=15, validate_certs=True
        )
        await smtp.connect()
        await smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        
        # 🚨 FIX 1: Use sendmail for pre-signed raw bytes, NOT send_message
        await smtp.sendmail(settings.DISPATCH_FROM_EMAIL, [to_email], msg_bytes)
        await smtp.quit()
        return 250, "OK"
        
    except aiosmtplib.SMTPConnectError as e:
        return 421, f"Connection failed: {e}"
    except aiosmtplib.SMTPAuthenticationError as e:
        return 535, f"Auth failed: {e}"
    except aiosmtplib.SMTPRecipientsRefused as e:
        return 550, f"Recipient refused: {e}"
    except aiosmtplib.SMTPResponseException as e:
        return e.code, e.message
    except Exception as e:
        return 500, f"Unexpected error: {type(e).__name__}: {e}"

def _interpret_smtp_response(code: int, response: str) -> Literal["SENT", "BOUNCED", "FAILED", "RETRYING"]:
    if 200 <= code < 300:
        return "SENT"
    elif code in (421, 450, 451):
        # 🚨 FIX 4a: Must return exactly "RETRYING" to match routing.py
        return "RETRYING" 
    elif 500 <= code < 600:
        if "550" in response and ("user unknown" in response.lower() or "no such user" in response.lower()):
            return "BOUNCED"
    return "FAILED"

# ---------------------------------------------------------
# 2. PORTAL FALLBACK AUTOMATION
# ---------------------------------------------------------
async def _submit_portal_form(portal_url, subject, body_text, jurisdiction, session_id):
    """Submit grievance via portal using shared Playwright context."""
    # 🚨 FIX: Reuse the global Playwright manager (No memory leaks)
    context = await PlaywrightManager.get_context(session_id)
    page = await context.new_page()
    try:
        await page.goto(portal_url, wait_until="domcontentloaded", timeout=30000)
        
        fields = {
            "subject": ["subject", "title", "विषय"],
            "description": ["description", "details", "विवरण"],
            "location": ["location", "address", "पता"],
        }
        for field_type, selectors in fields.items():
            for sel in selectors:
                element = await page.query_selector(f"input[name*='{sel}'], textarea[name*='{sel}']")
                if element:
                    val = subject if field_type == "subject" else body_text[:500] if field_type == "description" else jurisdiction.get("district", "")
                    await element.fill(val)
                    break
                    
        submit_btn = await page.query_selector("button[type='submit'], input[type='submit']")
        if submit_btn:
            await submit_btn.click()
            await page.wait_for_load_state("networkidle", timeout=10000)
            ticket = await page.evaluate("() => { const m = document.body.innerText.match(/(?:Ticket|Reference)\\s*#?\\s*([A-Z0-9-]+)/i); return m ? m[1] : null; }")
            return True, "Success", ticket
        return False, "Submit button not found", None
    except Exception as e:
        logger.error(f"Portal submission failed: {e}")
        return False, f"Submission error: {type(e).__name__}", None
    finally:
        if 'page' in locals():
            await page.close()
        if 'context' in locals():
            await context.close()

# ---------------------------------------------------------
# 3. CIRCUIT BREAKER
# ---------------------------------------------------------
async def _check_dispatch_circuit(target: str) -> bool:
    db = await _get_dispatch_db()
    # 🚨 FIX 2: Python-native UTC timestamp ensures perfect Lexicographical comparison
    threshold_time = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    
    async with db.execute(
        """SELECT COUNT(*) FROM dispatch_log 
           WHERE (target_email = ? OR target_email LIKE ?) 
           AND status IN ('FAILED', 'BOUNCED') 
           AND dispatched_at > ?""",
        (target, f"%@{target}" if "@" not in target else target, threshold_time)
    ) as cursor:
        row = await cursor.fetchone()
        return (row[0] if row else 0) >= 3

# ---------------------------------------------------------
# 4. THE GRAPH NODE
# ---------------------------------------------------------
async def dispatch_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    drafted = state.get("drafted_letter", {})
    contact = state.get("primary_contact", {})
    jurisdiction = state.get("jurisdiction_hierarchy", {})
    tracking_id = state.get("tracking_id", f"CIVIC-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
    session_id = state.get("session_id", "unknown")
    current_retry = state.get("retry_count", 0)
    execution_ts = datetime.now(timezone.utc)
    
    if not drafted.get("subject") or not contact.get("officialEmail"):
        return {"dispatch_status": "FAILED", "status_updates": [{"node": "dispatch", "action": "missing_data", "ts": execution_ts.isoformat()}]}
    
    idempotency_key = _generate_idempotency_key(state)
    if await _check_idempotency(idempotency_key):
        return {"status_updates": [{"node": "dispatch", "action": "idempotent_skip", "ts": execution_ts.isoformat()}]}

    with tracer.start_as_current_span("dispatch_node") as span:
        try:
            target = contact.get("officialEmail", "").split("@")[-1] if "@" in contact.get("officialEmail", "") else contact.get("officialEmail")
            if await _check_dispatch_circuit(target):
                smtp_status = "CIRCUIT_OPEN"
            else:
                msg = _build_mime_message(
                    drafted["subject"], drafted["body"], drafted.get("body_html"),
                    settings.DISPATCH_FROM_EMAIL, contact["officialEmail"], tracking_id
                )
                
                if getattr(settings, "DKIM_ENABLED", False) and getattr(settings, "DKIM_PRIVATE_KEY", None):
                    signed_bytes = dkim.sign(
                        message=msg.as_bytes(), selector=settings.DKIM_SELECTOR.encode(),
                        domain=settings.DISPATCH_DOMAIN.encode(), privkey=settings.DKIM_PRIVATE_KEY.encode(),
                        include_headers=[b"from", b"to", b"subject", b"date"]
                    ) + msg.as_bytes()
                else:
                    signed_bytes = msg.as_bytes()
                
                smtp_code, smtp_response = await _send_smtp_async(signed_bytes, contact["officialEmail"])
                smtp_status = _interpret_smtp_response(smtp_code, smtp_response)
                
                await _record_dispatch_attempt(
                    idempotency_key, session_id, contact["officialEmail"], None, 
                    smtp_status, smtp_code, smtp_response if smtp_status != "SENT" else None, current_retry
                )
            
            portal_submitted, portal_ticket = False, None
            if smtp_status not in ("SENT", "DELIVERED") and contact.get("portalUrl"):
                portal_success, portal_msg, portal_ticket = await _submit_portal_form(
                    contact["portalUrl"], drafted["subject"], drafted["body"], jurisdiction, session_id
                )
                if portal_success:
                    portal_submitted = True
                    smtp_status = "PORTAL_SUBMITTED"
                    await _record_dispatch_attempt(idempotency_key, session_id, None, contact["portalUrl"], "PORTAL_SUBMITTED", None, portal_msg, current_retry)

            final_status = "DELIVERED" if smtp_status == "SENT" else smtp_status
            
            # 🚨 FIX 3: Safely merge confidence metrics to prevent data loss
            existing_metrics = state.get("confidence_metrics", {})
            updated_metrics = {**existing_metrics, "dispatch_success": 1.0 if final_status in ("DELIVERED", "PORTAL_SUBMITTED") else 0.0}
            
            return {
                "dispatch_status": final_status,
                "final_dispatch_id": portal_ticket or tracking_id,
                "dispatch_channel": "PORTAL_FORM" if portal_submitted else "SMTP",
                "confidence_metrics": updated_metrics,
                # 🚨 FIX 4b: Explicitly increment retry_count to prevent infinite loops
                "retry_count": current_retry + 1 if final_status == "RETRYING" else current_retry,
                "status_updates": [{
                    "node": "dispatch", "action": f"dispatch_{final_status.lower()}",
                    "tracking_id": tracking_id, "ts": execution_ts.isoformat()
                }]
            }
            
        except Exception as e:
            logger.exception(f"Dispatch failure: {e}")
            span.record_exception(e)
            return {
                "dispatch_status": "FAILED",
                "retry_count": current_retry + 1,  # Failsafe increment
                # 🚨 FIX: Anchor the tracking ID in the state so retries use the exact same ID
                "tracking_id": tracking_id, 
                "error_log": [{
                    "node": "dispatch", 
                    "action": "critical_failure", 
                    "details": type(e).__name__, 
                    "ts": execution_ts.isoformat()
                }],
            }

async def shutdown_dispatch():
    global _dispatch_db
    if _dispatch_db:
        await _dispatch_db.close()
        _dispatch_db = None