import asyncio
import os
from backend.core.db import prisma

async def reset_caches():
    print("🔌 Connecting to Postgres...")
    await prisma.connect()
    
    # Wipe the false positive emails, but keep the geographic RAG routes!
    updated = await prisma.administrativehierarchy.update_many(
        where={"status": {"not": "PENDING"}},
        data={
            "officialEmail": None,
            "status": "PENDING",
            "portalUrl": None
        }
    )
    print(f"✅ Postgres Cache Wiped. Reset {updated} records to PENDING.")
    await prisma.disconnect()
    
    # Destroy the poisoned SQLite bouncer
    db_path = "data/domain_reputation.db"
    if os.path.exists(db_path):
        os.remove(db_path)
        print("✅ SQLite Reputation Cache Destroyed.")
        
    # Also clean up WAL files if they exist
    if os.path.exists(db_path + "-wal"): os.remove(db_path + "-wal")
    if os.path.exists(db_path + "-shm"): os.remove(db_path + "-shm")

if __name__ == "__main__":
    asyncio.run(reset_caches())