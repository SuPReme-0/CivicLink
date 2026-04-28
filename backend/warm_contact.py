# backend/warm_contacts.py
import asyncio
import logging
import sys
import time

from backend.core.db import prisma
from backend.brain.nodes.contact import contact_discovery_node, shutdown_contact_discovery

logging.basicConfig(
    level=logging.INFO, 
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("OSINT_Warmer")

async def warm_database_cache():
    logger.info("🔌 Connecting to Database...")
    await prisma.connect()
    
    # 🚨 GEO-FENCE: We strictly lock the warmer to these two target districts
    target_districts = ["kolkata", "north24parganas", "north 24 parganas"]
    
    # Fetch all pending routes
    all_pending = await prisma.administrativehierarchy.find_many(
        where={"status": "PENDING"},
        order={"district": "asc"}
    )

    # Filter purely for our target zones (handles case sensitivity and spacing)
    records = [
        r for r in all_pending 
        if r.district.lower().strip() in target_districts
    ]

    if not records:
        logger.info("✅ No pending routes found for Kolkata or North 24 Parganas. You are fully warmed!")
        await prisma.disconnect()
        return

    logger.info(f"🗺️ Geo-Fence Active: Found {len(records)} pending routes for Kolkata & N24P.")

    try:
        for idx, record in enumerate(records):
            logger.info(f"\n==================================================")
            logger.info(f"🚀 OSINT PIPELINE [{idx+1}/{len(records)}]: {record.district.upper()} - {record.issueCategory.split(',')[0].upper()}")
            logger.info(f"==================================================")

            mock_state = {
                "jurisdiction_hierarchy": {
                    "id": record.id,
                    "district": record.district,
                    "state": record.state,
                    "issueCategory": record.issueCategory,
                    "officialDesignation": record.officialDesignation
                },
                "session_id": f"warmer_{record.district}_{idx}",
                "visited_urls": []
            }

            start_time = time.time()
            result = await contact_discovery_node(mock_state, config=None)
            elapsed = time.time() - start_time

            if result.get("current_status") == "DRAFTING_LETTER":
                contact = result.get("primary_contact", {})
                name_str = f"{contact.get('officialName')} - " if contact.get('officialName') else ""
                logger.info(f"✅ SUCCESS ({elapsed:.1f}s): Cached {name_str}{contact.get('officialEmail')} -> Ready for Dispatch!")
            else:
                logger.warning(f"❌ FAILED ({elapsed:.1f}s): Spider exhausted. Route marked for Human Review.")

            # ⏳ Polite 4-second delay to protect Groq API from bursting
            logger.info("⏳ Cooling down APIs for 4 seconds...")
            await asyncio.sleep(4)

    finally:
        logger.info("\n🧹 Shutting down OSINT Engine...")
        await shutdown_contact_discovery()
        await prisma.disconnect()
        logger.info("✅ Cache Warming Complete for Target Zones! System is ready.")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    try:
        asyncio.run(warm_database_cache())
    except KeyboardInterrupt:
        logger.info("\n🛑 Warmer interrupted by user. Shutting down gracefully...")