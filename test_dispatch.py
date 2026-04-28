"""
End-to-end test for Drafting & Dispatch nodes.
Simulates the exact state after successful jurisdiction + contact discovery.
"""
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

from backend.core.config import settings
from backend.core.db import prisma
from backend.brain.nodes.drafting import drafting_node
from backend.brain.nodes.dispatch import dispatch_node

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("draft_dispatch_test")

# ── Simulated state after Jurisdiction + Contact Discovery ──
MOCK_STATE = {
    "session_id": "test_session_draft",
    "thread_id": "thread-draft-test-001",
    "tracking_id": "CIVIC-0000-TEST01",
    "extracted_text": (
        "A large pothole in the center of a cracked asphalt road has caused a bus tire to get stuck. "
        "The road has a white line down the center and a visible shoulder on the left side. "
        "The location has been provided, and a photo of the pothole has been attached."
    ),
    "location_raw": {
        "type": "gps",
        "lat": 22.5726,
        "lon": 88.3639
    },
    "severity_level": "HIGH",
    "issue_category": "ROADS",
    "jurisdiction_hierarchy": {
        "id": "cmoij8gkc0000yy2rv0k16c8t",               # id from your DB
        "ward": "All Wards",
        "municipality": "Kolkata Municipal Corporation",
        "district": "Kolkata",
        "state": "West Bengal",
        "issueCategory": "Roads, pothole, street, damage",
        "officialDesignation": "Chief Engineer (Roads)"
    },
    "primary_contact": {
        "officialEmail": "mitrashreyan2005@gmail.com",             # verified email from warm_contact
        "officialDesignation": "Chief Engineer (Roads)",
        "officialName": "Sri Nihar Kanti Biswas",
        "verification_status": "VERIFIED",
        "confidenceScore": 0.9
    },
    "confidence_metrics": {
        "vlm_verification": 0.9,
        "pixel_forensics": 0.337,
        "metadata_forensics": 0.8,
        "overall": 0.715,
        "jurisdiction": 0.469                              # from your test
    },
    "retry_count": 0,
    "max_retries": 3,
    "image_url": None,                                     # optionally set a base64 data URI if you have one
    "is_grievance_complete": True,
    "current_status": "DRAFTING_LETTER"                   # optional
}

async def test_drafting_node():
    """Generate the formal complaint letter."""
    logger.info("📝 Testing Drafting Node...")
    config = {"configurable": {"thread_id": "draft-test"}}
    result = await drafting_node(MOCK_STATE, config)
    
    logger.info("\n" + "="*60)
    logger.info("DRAFTING RESULT")
    logger.info("="*60)
    
    drafted = result.get("drafted_letter")
    if drafted:
        logger.info("✅ Draft generated successfully!")
        logger.info("Subject: %s", drafted.get("subject"))
        logger.info("Body (text):\n%s\n", drafted.get("body"))
        logger.info("Language: %s", drafted.get("language"))
        logger.info("Citations: %s", drafted.get("citations_included"))
    else:
        logger.error("❌ Drafting failed: %s", json.dumps(result, indent=2))
    
    return result

async def test_dispatch_node(drafted_state):
    """Attempt to dispatch the letter (SMTP + optional portal fallback)."""
    logger.info("\n📬 Testing Dispatch Node...")
    config = {"configurable": {"thread_id": "dispatch-test"}}
    result = await dispatch_node(drafted_state, config)
    
    logger.info("\n" + "="*60)
    logger.info("DISPATCH RESULT")
    logger.info("="*60)
    
    dispatch_status = result.get("dispatch_status")
    if dispatch_status in ("SENT", "DELIVERED", "PORTAL_SUBMITTED"):
        logger.info("✅ Dispatch succeeded: %s", dispatch_status)
    else:
        logger.warning("⚠️ Dispatch not sent: %s", dispatch_status)
    
    logger.info("Full dispatch output:\n%s", json.dumps(result, indent=2))
    return result

async def main():
    # Ensure DB connection (some nodes use it)
    if not prisma.is_connected():
        await prisma.connect()
    
    # 1. Run drafting
    draft_result = await test_drafting_node()
    
    # 2. Merge the drafted letter back into the state for dispatch
    state_for_dispatch = {**MOCK_STATE, **draft_result}
    # Ensure we have the drafted_letter key present
    if "drafted_letter" not in state_for_dispatch:
        state_for_dispatch["drafted_letter"] = draft_result.get("drafted_letter", {})
    
    # 3. Run dispatch
    await test_dispatch_node(state_for_dispatch)
    
    await prisma.disconnect()

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())