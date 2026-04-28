# test_vlm.py
import asyncio
import logging
import json
import base64
from pathlib import Path

from backend.brain.nodes.vlm_verify import vlm_verify_node 

logging.basicConfig(
    level=logging.DEBUG, 
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("VLM_Forensics")

async def run_vlm_test():
    image_path = Path("test.webp")
    
    if not image_path.exists():
        logger.error(f"❌ Could not find '{image_path}' in the root directory.")
        return

    logger.info(f"📸 Found image: {image_path}. Converting to Base64 Data URI...")

    # 🚨 FIX: Read the image and encode it as a Data URI so the VLM node accepts it
    with open(image_path, "rb") as f:
        image_bytes = f.read()
    
    # Create the Base64 Data URI string
    base64_str = base64.b64encode(image_bytes).decode("utf-8")
    data_uri = f"data:image/webp;base64,{base64_str}"

    # 🚨 FIX: Pass it as 'image_url' to match CivicLinkState
    mock_state = {
        "session_id": "vlm_debug_session_001",
        "image_url": data_uri, 
        "extracted_text": "There is a massive pothole outside my house causing accidents." 
    }

    logger.info("🧠 Firing VLM Verification Node...")
    
    try:
        result = await vlm_verify_node(mock_state, config=None)
        
        logger.info("\n" + "="*60)
        logger.info("🎯 VLM VERIFICATION RESULTS (JSON DUMP)")
        logger.info("="*60)
        print(json.dumps(result, indent=2))
        
        logger.info("\n" + "="*60)
        logger.info("🕵️ FORENSIC BREAKDOWN")
        logger.info("="*60)
        
        status = result.get("current_status", "UNKNOWN")
        status_updates = result.get("status_updates", [])
        error_log = result.get("error_log", [])
        
        logger.info(f"➡️ Final Routing Status: {status}")
        
        if status_updates:
            rationale = status_updates[-1].get("rationale", "No rationale provided by VLM.")
            score = result.get("image_authenticity_score", "N/A")
            logger.info(f"📊 Final Authenticity Score: {score}")
            if result.get("vlm_output"):
                logger.info(f"🧠 AI Rationale: {result['vlm_output'].get('rationale')}")
                logger.info(f"🖼️ AI Description: {result['vlm_output'].get('image_description')}")
            
        if error_log:
            logger.warning(f"⚠️ Errors/Rejections Caught: {json.dumps(error_log, indent=2)}")
            
    except Exception as e:
        logger.exception(f"❌ VLM Node crashed during execution: {e}")

if __name__ == "__main__":
    import sys
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        
    asyncio.run(run_vlm_test())