import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

# CivicLink imports
from backend.core.config import settings
from backend.core.db import prisma
from backend.brain.nodes.jurisdiction import resolve_jurisdiction_node

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("jurisdiction_test")

# Re‑create the exact state that the graph had at the jurisdiction step
MOCK_STATE = {
    "session_id": "test_session",
    "thread_id": "thread-1777393712208",
    "tracking_id": "CIVIC-0000-123456",
    "user_input": "YEah file a report.",
    "text_message": "YEah file a report.",
    "is_grievance_complete": True,
    "extracted_text": (
        "A large pothole in the center of a cracked asphalt road has caused a bus tire to get stuck. "
        "The road has a white line down the center and a visible shoulder on the left side. "
        "The location has been provided, and a photo of the pothole has been attached.\n"
        "[SYSTEM: VLM analyzed attached image. Description: A close-up photograph of a cracked asphalt "
        "road with a large pothole in the center, surrounded by a network of cracks. The pothole is circular "
        "and has a rough, rocky interior. A white line runs down the center of the road, and the shoulder is "
        "visible on the left side.]"
    ),
    "location_raw": {
        "type": "gps",
        "lat": 22.5726,   # Example Kolkata coordinates – replace with actual test data if different
        "lon": 88.3639
    },
    "severity_level": "HIGH",
    "issue_category": "ROADS",
    "confidence_metrics": {
        "vlm_verification": 0.9,
        "pixel_forensics": 0.337,
        "metadata_forensics": 0.8,
        "overall": 0.715
    }
}

async def test_jurisdiction_node():
    # Ensure DB is connected (same as production)
    if not prisma.is_connected():
        await prisma.connect()
        logger.info("✅ Connected to database")
    
    # Dummy config (RunnableConfig) – the node doesn't heavily use it here
    config = {"configurable": {"thread_id": "test_thread"}}

    logger.info("🚀 Running jurisdiction node with simulated state...")
    result = await resolve_jurisdiction_node(MOCK_STATE, config)

    logger.info("\n" + "="*60)
    logger.info("📊 JURISDICTION NODE RESULT")
    logger.info("="*60)

    hierarchy = result.get("jurisdiction_hierarchy")
    if hierarchy:
        logger.info("✅ Jurisdiction resolved:")
        logger.info(json.dumps(hierarchy, indent=2))
    else:
        logger.warning("❌ Jurisdiction NOT resolved (null hierarchy)")

    logger.info("Confidence metrics: %s", result.get("confidence_metrics"))
    logger.info("Status updates: %s", json.dumps(result.get("status_updates"), indent=2))
    error_log = result.get("error_log", [])
    if error_log:
        logger.warning("Error log: %s", json.dumps(error_log, indent=2))

    # Additional deep‑dive: we can manually call the internal search to see candidates
    # (if you want to debug further, uncomment the following lines)
    # from backend.brain.nodes.jurisdiction import _generate_embedding, _search_jurisdiction
    # embedding = await _generate_embedding(MOCK_STATE["extracted_text"])
    # candidates = await _search_jurisdiction(embedding, MOCK_STATE["extracted_text"], MOCK_STATE["location_raw"])
    # logger.info("Raw candidates: %s", json.dumps([(dict(r), s) for r, s in candidates], default=str))

    await prisma.disconnect()

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test_jurisdiction_node())