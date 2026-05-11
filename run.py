# run.py
import sys
import asyncio
import uvicorn

# 🚨 1. FORCE THE PLAYWRIGHT-COMPATIBLE LOOP BEFORE ANYTHING ELSE HAPPENS
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# 🚨 2. THEN LAUNCH THE SERVER
if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)