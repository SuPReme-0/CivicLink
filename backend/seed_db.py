import asyncio
import logging
from prisma import Prisma

logging.basicConfig(
    level=logging.INFO, 
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("DB_Seeder")

async def hard_reset_and_seed():
    db = Prisma()
    logger.info("🔌 Connecting to Database...")
    await db.connect()

    logger.info("🧨 Initiating Hard Reset: Wiping all records from AdministrativeHierarchy...")
    deleted_count = await db.administrativehierarchy.delete_many()
    logger.info(f"🗑️ Nuked {deleted_count} old records from the database.")

    logger.info("🌱 Seeding fresh target routes for KOLKATA...")
    
    # 🚨 Using the camelCase keys that match the updated Prisma schema
    kolkata_bbox = {
        "bboxMinLat": 22.45,
        "bboxMaxLat": 22.65,
        "bboxMinLon": 88.25,
        "bboxMaxLon": 88.45,
    }

    kolkata_routes = [
        {
            "district": "Kolkata",
            "state": "West Bengal",
            "municipality": "Kolkata Municipal Corporation",
            "ward": "All Wards",
            "issueCategory": "Roads, pothole, street, damage",
            "officialDesignation": "Chief Engineer (Roads)",
            "status": "PENDING",
            **kolkata_bbox
        },
        {
            "district": "Kolkata",
            "state": "West Bengal",
            "municipality": "Kolkata Municipal Corporation",
            "ward": "All Wards",
            "issueCategory": "Water, flooding, water_logging, drainage",
            "officialDesignation": "Executive Engineer (Water Supply)",
            "status": "PENDING",
            **kolkata_bbox
        },
        {
            "district": "Kolkata",
            "state": "West Bengal",
            "municipality": "Kolkata Municipal Corporation",
            "ward": "All Wards",
            "issueCategory": "Sanitation, garbage, waste, dump",
            "officialDesignation": "Chief Medical Officer of Health",
            "status": "PENDING",
            **kolkata_bbox
        },
        {
            "district": "Kolkata",
            "state": "West Bengal",
            "municipality": "Kolkata Municipal Corporation",
            "ward": "All Wards",
            "issueCategory": "Electricity, street_light, power",
            "officialDesignation": "General Manager / Chief Engineer",
            "status": "PENDING",
            **kolkata_bbox
        },
        {
            "district": "Kolkata",
            "state": "West Bengal",
            "municipality": "Kolkata Municipal Corporation",
            "ward": "All Wards",
            "issueCategory": "Encroachment, illegal_construction, occupation",
            "officialDesignation": "Municipal Commissioner / District Magistrate",
            "status": "PENDING",
            **kolkata_bbox
        }
    ]

    for route in kolkata_routes:
        await db.administrativehierarchy.create(data=route)

    logger.info(f"✅ Successfully seeded {len(kolkata_routes)} clean Kolkata routes.")
    
    await db.disconnect()
    logger.info("🔌 Database disconnected. You are ready to run the warmer.")

if __name__ == "__main__":
    asyncio.run(hard_reset_and_seed())