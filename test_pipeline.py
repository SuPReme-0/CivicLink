import asyncio
import base64
import httpx
import os
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

# ==============================================================================
# CONFIGURATION
# ==============================================================================
API_BASE_URL = "http://localhost:8000/api/v1"
FRONTEND_API_KEY = os.getenv("FRONTEND_API_KEY", "civiclink_dev_super_secret_998877")

BASE_HEADERS = {
    "Content-Type": "application/json",
    "X-Frontend-API-Key": FRONTEND_API_KEY
}

# ==============================================================================
# UTILITIES
# ==============================================================================
def get_image_data_uri(filepath: str) -> str:
    path = Path(filepath)
    if not path.exists():
        print(f"\n❌ ERROR: {filepath} not found! Please place it in the root directory.")
        exit(1)
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    ext = path.suffix.lower().replace(".", "")
    if ext == "jpg": ext = "jpeg"
    return f"data:image/{ext};base64,{encoded}"

async def authenticate_citizen(client: httpx.AsyncClient, username: str, phone: str):
    print(f"\n[SYSTEM] Authenticating Citizen Identity: {username}...")
    reg_payload = {"username": username, "password": "securepassword123", "phone_number": phone}
    try:
        await client.post(f"{API_BASE_URL}/auth/citizen/register", json=reg_payload, headers=BASE_HEADERS)
    except Exception:
        pass 
    
    login_payload = {"username": username, "password": "securepassword123"}
    res = await client.post(f"{API_BASE_URL}/auth/citizen/login", json=login_payload, headers=BASE_HEADERS)
    
    if res.status_code == 200:
        data = res.json()
        token = data.get("token") or data.get("access_token")
        print("✅ Citizen authenticated. Secure JWT acquired.")
        return token
    else:
        print(f"❌ FATAL: Could not log in citizen: {res.text}")
        exit(1)

async def send_message(client: httpx.AsyncClient, payload: dict, turn: int, token: str):
    text = payload.get("text_message", "[No Text]")
    media = "[Image Attached]" if payload.get("image_url") else ""
    print(f"\n👤 CITIZEN [Turn {turn}]: {text} {media}")
    print("-" * 80)
    
    secure_headers = {
        **BASE_HEADERS,
        "Authorization": f"Bearer {token}"
    }
    
    try:
        response = await client.post(f"{API_BASE_URL}/ingest", json=payload, headers=secure_headers)
        if response.status_code != 200:
            print(f"❌ API ERROR ({response.status_code}): {response.text}")
            exit(1)
    except httpx.ConnectError:
        print("\n❌ FATAL: Cannot connect to Backend. Is Uvicorn running?")
        exit(1)

async def poll_conversational_status(client: httpx.AsyncClient, thread_id: str, last_reply: str, token: str, terminal_states: list = None, require_terminal: bool = False):
    terminal_states = terminal_states or []
    last_state = "PENDING_DETAILS"
    
    secure_headers = {
        **BASE_HEADERS,
        "Authorization": f"Bearer {token}"
    }
    
    while True:
        try:
            response = await client.get(f"{API_BASE_URL}/status/{thread_id}", headers=secure_headers)
            
            if response.status_code == 200:
                data = response.json()
                current_state = data.get("current_state", "")
                current_reply = data.get("reply_message", "")

                # 1. Print Backend Node Progress
                if current_state != last_state and current_state != "PENDING_DETAILS":
                    state_colors = {
                        "RECEIVED": "📥  [INGEST NODE]: Case permanently registered in database.",
                        "VERIFYING_IMAGE": "👁️  [VLM NODE]: Analyzing image forensics...",
                        "ROUTING_JURISDICTION": "🗺️  [JURISDICTION NODE]: Mapping 70B Georesolution...",
                        "AWAITING_USER_INPUT": "⏸️  [AMBIGUITY GATE]: Location too vague. Halting graph...",
                        "AUTONOMOUS_SEEDING": "🌱  [AGENTIC OSINT]: 70B deducing municipal hierarchy & seeding DB...",
                        "DISCOVERING_CONTACT": "🕷️  [CONTACT SPIDER]: Geofenced crawl for official emails...",
                        "DRAFTING_LETTER": "⚖️  [DRAFTING NODE]: Writing legal grievance & citing statutes...",
                        "VERIFYING_DISPATCH": "🛡️  [VERIFICATION GATE]: Auditing confidence metrics...",
                        "AWAITING_REVIEW": "⚠️  [GATEKEEPER]: Pipeline Paused. Routing to Human Review.",
                        "LLM_RECOVERY_NEEDED": "🧠  [RECOVERY]: Node failed. Bouncing to LLM to ask user for help."
                    }
                    print("\n" + state_colors.get(current_state, f"⚙️  [STATE TRANSITION]: {current_state}"))
                    last_state = current_state

                # 2. Print live conversational updates
                if current_reply and current_reply != last_reply:
                    if current_reply == "Processing...":
                        await asyncio.sleep(1)
                        continue
                        
                    print(f"\n🤖 AI REPLY: {current_reply}")
                    last_reply = current_reply
                    
                    if not require_terminal:
                        return last_reply

                # 3. Check for terminal/pausing states
                if terminal_states and current_state in terminal_states:
                    print("\n" + "="*80)
                    print(f"🏁 PIPELINE HALTED. FINAL STATE: {current_state}")
                    return last_reply
                    
        except Exception:
            pass 

        await asyncio.sleep(2)

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================
async def main():
    print("\n=====================================================================")
    print("🚀 CIVICLINK HARD STRESS TEST: UTTAR PRADESH DEVELOPMENT AUTHORITY")
    print("=====================================================================")
    
    thread_id = f"CLC-TEST-{datetime.now().strftime('%H%M%S')}"
    phone_number = "+919988112233"
    username = "Vikram_Singh"
    last_reply = ""
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        
        citizen_jwt = await authenticate_citizen(client, username, phone_number)
        
        # --- TURN 1: Highly Urgent, Vague Location ---
        await send_message(client, {
            "thread_id": thread_id,
            "phone_number": phone_number,
            "text_message": "There is a massive crater in the middle of the road. It's extremely dangerous, bikes are skidding and cars are swerving into oncoming traffic."
        }, 1, citizen_jwt)
        last_reply = await poll_conversational_status(client, thread_id, last_reply, citizen_jwt)

        # --- TURN 2: Image Upload + Pushback ---
        image_uri = get_image_data_uri("test.webp")
        await send_message(client, {
            "thread_id": thread_id,
            "phone_number": phone_number,
            "text_message": "Here is the photo. I don't have time to drop a GPS pin, I'm driving to work. Just report it to the authorities right now.",
            "image_url": image_uri,
        }, 2, citizen_jwt)
        
        # Expected: VLM verification completes, then RAG hits the Ambiguity Gate and halts.
        last_reply = await poll_conversational_status(client, thread_id, last_reply, citizen_jwt)

        # --- TURN 3: Tricky Landmark Resolution (Noida, UP) ---
        await send_message(client, {
            "thread_id": thread_id,
            "phone_number": phone_number,
            "text_message": "Fine. It's located right below the Sector 62 Metro Station, near the Fortis Hospital intersection in Noida, UP. The road is completely caving in."
        }, 3, citizen_jwt)
        last_reply = await poll_conversational_status(client, thread_id, last_reply, citizen_jwt)

        # --- TURN 4: Final Directive ---
        await send_message(client, {
            "thread_id": thread_id,
            "phone_number": phone_number,
            "text_message": "Yes, go ahead and submit the official report with all the legal penalties attached. This needs fixing today."
        }, 4, citizen_jwt)
        
        terminal_states = ["AWAITING_REVIEW", "DELIVERED", "PORTAL_SUBMITTED", "RESOLVED", "FAILED", "REJECTED_FRAUD", "LLM_RECOVERY_NEEDED"]
        await poll_conversational_status(client, thread_id, last_reply, citizen_jwt, terminal_states, require_terminal=True)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⏹️ Test manually aborted.")