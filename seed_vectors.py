import asyncio
import logging
from backend.core.db import prisma
from backend.brain.nodes.jurisdiction import _generate_embedding

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    print("\n==================================================")
    print("🧬 BOOTING PGVECTOR SEEDER (RAW SQL OVERRIDE)")
    print("==================================================\n")
    
    await prisma.connect()
    
    # 1. Fetch all hierarchy rows
    rows = await prisma.administrativehierarchy.find_many()
    
    if not rows:
        print("❌ No rows found! Did you run seed_db.py?")
        return

    print(f"Found {len(rows)} regions. Generating vectors...")

    for row in rows:
        # Create a dense semantic string
        semantic_text = f"{row.issueCategory} {row.district} {row.state} {row.municipality or ''} {row.ward or ''}"
        
        # Generate the high-dimensional vector
        vector = await _generate_embedding(semantic_text)
        
        # Format it precisely for Postgres
        vector_str = f"[{','.join(map(str, vector.tolist()))}]"
        
        # 🚨 FIX: Use raw SQL to bypass Prisma's ORM limitation with pgvector
        await prisma.execute_raw(
            """
            UPDATE administrative_hierarchy 
            SET embedding = $1::vector 
            WHERE id = $2
            """,
            vector_str,
            row.id
        )
        print(f"✅ Embedded: {semantic_text}")

    await prisma.disconnect()
    print("\n🎉 All vectors seeded successfully!")

if __name__ == "__main__":
    asyncio.run(main())