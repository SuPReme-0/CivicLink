# backend/main.py
"""
CivicLink API Gateway.
Boots the FastAPI server, manages lifecycle hooks, and exposes the ingestion endpoints.
"""
import logging
from fastapi import FastAPI, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import settings
from backend.core.db import connect_db, disconnect_db
from backend.core.rate_limiter import rate_limiter
from backend.core.security import verify_frontend_auth, hash_phone_number
from backend.brain.nodes.contact import shutdown_contact_discovery
from backend.brain.nodes.dispatch import shutdown_dispatch
from backend.brain.workflow import build_civiclink_graph

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("civiclink_api")

# Initialize FastAPI
app = FastAPI(title="CivicLink Core API", version="1.0.0")

# 🚨 CORS Middleware: Allows Next.js (e.g., localhost:3000) to talk to FastAPI (localhost:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://your-production-domain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# LIFECYCLE MANAGEMENT
# ---------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    logger.info("Booting CivicLink Backend...")
    await connect_db()
    # Warm up LangGraph (compiles the graph and prepares the Checkpointer)
    app.state.graph = build_civiclink_graph()
    logger.info("LangGraph compiled and ready.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down CivicLink Backend...")
    await disconnect_db()
    await rate_limiter.close()
    await shutdown_contact_discovery()
    await shutdown_dispatch()
    logger.info("Shutdown complete.")

# ---------------------------------------------------------
# ASYNC WORKFLOW TRIGGER
# ---------------------------------------------------------
async def execute_langgraph_workflow(payload: dict):
    """Background task to run the LangGraph workflow without blocking the API response."""
    try:
        # In a full production setup, this would be pushed to a Celery/Redis queue.
        # For the prototype, FastAPI BackgroundTasks handles it seamlessly.
        graph = app.state.graph
        
        # Format the initial state based on your frontend's payload
        initial_state = {
            "session_id": payload.get("phone_number"), # Or user ID
            "thread_id": payload.get("thread_id"),
            "extracted_text": payload.get("text_message", ""),
            "image_url": payload.get("image_url", None),
            "location_raw": payload.get("location", {}),
            # Initialize tracking metadata
            "tracking_id": f"CIVIC-{payload.get('phone_number')[-4:]}-{payload.get('thread_id')[-6:]}"
        }
        
        config = {"configurable": {"thread_id": initial_state["thread_id"]}}
        
        # Trigger the graph asynchronously
        logger.info(f"Triggering LangGraph for thread {initial_state['thread_id']}")
        async for output in graph.astream(initial_state, config=config):
            # You can add logic here to stream real-time socket updates to Next.js if desired
            logger.debug(f"Graph executed step: {list(output.keys())}")
            
    except Exception as e:
        logger.error(f"Workflow execution failed: {e}")

# ---------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------
@app.post("/api/v1/ingest", dependencies=[Depends(verify_frontend_auth)])
async def ingest_grievance(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint for Next.js to submit a new grievance.
    Protected by X-Frontend-API-Key.
    """
    payload = await request.json()
    
    # 1. Protect PII immediately
    raw_phone = payload.get("phone_number")
    if not raw_phone:
        return {"status": "error", "message": "Phone number/User ID required"}
        
    payload["phone_number"] = hash_phone_number(raw_phone)
    
    # 2. Hand off to background worker (LangGraph)
    background_tasks.add_task(execute_langgraph_workflow, payload)
    
    # 3. Return immediate 200 OK to frontend
    return {
        "status": "success", 
        "message": "Grievance queued for AI processing",
        "thread_id": payload.get("thread_id")
    }

# Add/Update this in backend/main.py
@app.get("/api/v1/status/{thread_id}")
async def get_grievance_status(thread_id: str):
    """Fetches the real-time status AND conversational data of a grievance."""
    from backend.core.db import prisma
    
    # Fetch the case and its relations
    case = await prisma.grievancecase.find_first(
        where={"trackingId": thread_id},
        include={
            "dispatchRecords": True  # Include who we sent it to
        }
    )
    
    if not case:
        return {"status": "processing", "current_state": "RECEIVED"}
        
    return {
        "status": "found",
        "current_state": case.status,
        "issue_category": case.issueCategory,
        "description_text": case.descriptionText,
        "system_metadata": case.systemMetadata, # Contains VLM Auth Score
        "dispatch_records": [
            {
                "email": record.sentToEmail,
                "status": record.deliveryStatus
            } for record in case.dispatchRecords
        ] if case.dispatchRecords else []
    }

@app.get("/api/v1/admin/graph-state/{thread_id}")
async def get_graph_state(thread_id: str):
    """
    Pulls the granular node-by-node execution history from LangGraph's Checkpointer 
    to power the Next.js Admin visualization.
    """
    from backend.main import app # Access the compiled graph
    graph = app.state.graph
    
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        # Fetch the current state and the history of how it got there
        current_state = await graph.aget_state(config)
        
        # We parse the state values to map them to the frontend's GraphNode type
        nodes = []
        state_values = current_state.values
        
        # Example mapping: Check if Ingest completed
        if "extracted_text" in state_values:
            nodes.append({
                "id": "ingest",
                "name": "Ingest & NLP Normalization",
                "status": "success",
                "output": {"text": state_values.get("extracted_text")}
            })
            
        # Example mapping: Check VLM results
        if "system_metadata" in state_values and "auth_score" in state_values["system_metadata"]:
            nodes.append({
                "id": "vlm_verify",
                "name": "VLM Deepfake Forensics",
                "status": "success",
                "confidence": state_values["system_metadata"]["auth_score"],
                "output": {"is_genuine": True}
            })
            
        # Check if paused at the HITL Verification Gate
        next_nodes = current_state.next
        if "verification_gate" in next_nodes:
            nodes.append({
                "id": "verification_gate",
                "name": "Human-in-the-Loop Review",
                "status": "running" # It is waiting for Admin input
            })
            
        return {"nodes": nodes, "is_paused": len(next_nodes) > 0}
        
    except Exception as e:
        return {"error": str(e)}
    
@app.post("/api/v1/admin/retry/{thread_id}/{node_id}")
async def retry_graph_node(thread_id: str, node_id: str):
    """Commands LangGraph to retry a specific failed node."""
    from backend.main import app 
    graph = app.state.graph
    
    # Resume the graph by passing None to trigger a re-computation of the current state
    await graph.aupdate_state(
        {"configurable": {"thread_id": thread_id}},
        None,
        as_node=node_id
    )
    return {"status": "retrying", "node": node_id}