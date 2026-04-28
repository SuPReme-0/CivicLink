import asyncio
import base64
import logging
import warnings
from pathlib import Path
from datetime import datetime, timezone

# 🛑 Mute all background noise and deprecation warnings
warnings.filterwarnings("ignore", module="google.generativeai")
logging.getLogger().setLevel(logging.CRITICAL) 
logging.getLogger("civiclink_api").setLevel(logging.CRITICAL)

from backend.brain.workflow import build_civiclink_graph
from backend.core.db import prisma

def get_image_data_uri(filepath: str) -> str:
    path = Path(filepath)
    if not path.exists():
        print(f"\n❌ ERROR: {filepath} not found! Please place it in the root directory.")
        exit(1)
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    ext = path.suffix.lower().replace(".", "")
    return f"data:image/{ext};base64,{encoded}"

async def stream_turn(graph, input_state: dict, config: dict, turn_number: int):
    """Streams a single conversational turn and prints a clean UI."""
    print(f"\n👤 CITIZEN [Turn {turn_number}]: {input_state.get('user_input', '[Image Uploaded]')}")
    print("--------------------------------------------------")
    
    requires_review = False
    
    async for event in graph.astream(input_state, config, stream_mode="updates"):
        for node_name, state_updates in event.items():
            
            # 🚨 THE FIX: Make state_updates absolutely null-safe
            if not isinstance(state_updates, dict):
                state_updates = {}
                
            # If the node was just a chat, print the AI's reply
            if "conversational_reply" in state_updates:
                print(f"🤖 AI REPLY: {state_updates['conversational_reply']}")
            
            # If the pipeline fires, show the steps cleanly
            if node_name == "vlm_verify" and "vlm_output" in state_updates:
                print(f"✅ [FORENSICS] Image verified. Score: {state_updates.get('image_authenticity_score')}")
                
            elif node_name == "resolve_jurisdiction" and "jurisdiction_hierarchy" in state_updates:
                j = state_updates["jurisdiction_hierarchy"]
                print(f"✅ [JURISDICTION] Mapped to: {j.get('district')} -> {j.get('issueCategory')}")
                
            elif node_name == "discover_contact" and "primary_contact" in state_updates:
                c = state_updates["primary_contact"]
                print(f"✅ [OSINT] Found Official: {c.get('officialName')} ({c.get('officialEmail')})")
                
            elif node_name == "draft_letter" and "drafted_letter" in state_updates:
                print(f"✅ [LEGAL DRAFT] Generated. Subject: {state_updates['drafted_letter'].get('subject')}")
                
            elif node_name == "verification_gate":
                conf = state_updates.get('confidence_metrics', {}).get('pipeline_confidence')
                print(f"✅ [GATEKEEPER] Overall Confidence: {conf}")
                if state_updates.get('requires_human_review'):
                    requires_review = True
                    
            elif node_name == "dispatch":
                print(f"✅ [DISPATCH] Status: {state_updates.get('dispatch_status')} via {state_updates.get('dispatch_channel')}")

    return requires_review

async def main():
    print("\n==================================================")
    print("🚀 CIVICLINK MULTI-TURN CONVERSATION TEST")
    print("==================================================")
    
    print("\nLoading backend graph...")
    graph = build_civiclink_graph()
    config = {"configurable": {"thread_id": f"chat_test_{datetime.now().strftime('%H%M%S')}"}}
    
    try:
        if not prisma.is_connected():
            await prisma.connect()

        # --- TURN 1: Initial Greeting ---
        await stream_turn(graph, {
            "session_id": "test_user_01",
            "user_input": "Hi, I want to report a broken road that is causing accidents.",
            "is_grievance_complete": False
        }, config, 1)

        # --- TURN 2: Providing Location ---
        await stream_turn(graph, {
            "user_input": "It is located in Kolkata, near the main market.",
            "is_grievance_complete": False
        }, config, 2)

        # --- TURN 3: Uploading the Image (Triggers the Pipeline) ---
        image_uri = get_image_data_uri("test.webp")
        requires_review = await stream_turn(graph, {
            "user_input": "Here is the photo of the pothole.",
            "image_url": image_uri,
            "location_raw": {"type": "gps", "lat": 22.5726, "lon": 88.3639},
            "is_grievance_complete": True 
        }, config, 3)

        # --- HITL: Admin Approval (If Required) ---
        if requires_review:
            print("\n⚠️ PIPELINE PAUSED: Low confidence detected. Awaiting Admin Review.")
            print("👨‍💻 Admin clicked 'Approve' on Dashboard. Resuming...")
            
            # Update state with Admin decision
            graph.update_state(config, {"human_review_decision": "APPROVED"})
            
            # Resume graph with empty input
            await stream_turn(graph, None, config, 4)

        print("\n🎉 TEST COMPLETE!")

    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        
    finally:
        print("\n🧹 Cleaning up...")
        if prisma.is_connected():
            await prisma.disconnect()
        # Clean up node resources gracefully
        try:
            from backend.brain.nodes.contact import shutdown_contact_discovery
            from backend.brain.nodes.drafting import shutdown_drafting
            from backend.brain.nodes.dispatch import shutdown_dispatch
            await shutdown_contact_discovery()
            await shutdown_drafting()
            await shutdown_dispatch()
        except: pass

if __name__ == "__main__":
    asyncio.run(main())