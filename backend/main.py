import os
import sys
import json
import logging
import asyncio
import warnings
from contextlib import asynccontextmanager
from typing import AsyncGenerator

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
from fastapi import FastAPI, BackgroundTasks, Depends, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from prometheus_fastapi_instrumentator import Instrumentator

# 🛑 Suppress the Google Generative AI deprecation warning
warnings.filterwarnings("ignore", module="google.generativeai")

from backend.api.citizen_routes import citizen_router
from backend.api.admin_routes import admin_router
from backend.core.config import settings
from backend.core.db import connect_db, disconnect_db, prisma
from backend.core.rate_limiter import rate_limiter
from backend.core.observability import get_tracer, shutdown_observability

from backend.core.security import verify_frontend_auth, verify_system_key, hash_phone_number

from backend.brain.nodes.contact import shutdown_contact_discovery
from backend.brain.nodes.dispatch import shutdown_dispatch
from backend.brain.nodes.drafting import shutdown_drafting
from backend.brain.workflow import build_civiclink_graph

# 🚨 REQUIRED FOR PRISMA JSON FIELDS
from prisma import Json

# =============================================================================
# STRUCTURED LOGGING CONFIGURATION
# =============================================================================

class JSONFormatter(logging.Formatter):
    """JSON formatter for structured logging in production."""
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
        }
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        return json.dumps(log_entry)

def setup_logging():
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    handler = logging.StreamHandler(sys.stdout)
    if settings.ENVIRONMENT == "production":
        handler.setFormatter(JSONFormatter())
    else:
        formatter = logging.Formatter('%(asctime)s | %(levelname)-8s | %(name)s | %(message)s', datefmt='%H:%M:%S')
        handler.setFormatter(formatter)
        
    root_logger.addHandler(handler)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("prisma").setLevel(logging.WARNING)

setup_logging()
logger = logging.getLogger("civiclink_api")

# =============================================================================
# LIFESPAN MANAGEMENT
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("🚀 Booting CivicLink Backend...", extra={"version": settings.APP_VERSION})
    
    try:
        await connect_db()
        logger.info("✅ Database connected")
    except Exception as e:
        logger.error("❌ Database connection failed", exc_info=e)
        raise
    
    try:
        await rate_limiter.connect()
        logger.info("✅ Rate limiter initialized")
    except Exception as e:
        logger.error("❌ Rate limiter initialization failed", exc_info=e)
        await disconnect_db()
        raise
    
    try:
        _ = get_tracer("civiclink_startup")
        logger.info("✅ Observability providers initialized")
    except Exception as e:
        logger.warning(f"⚠️ Observability initialization warning: {e}")
    
    try:
        app.state.graph = build_civiclink_graph()
        logger.info("✅ LangGraph compiled and ready.")
    except Exception as e:
        logger.error("❌ LangGraph compilation failed", exc_info=e)
        await rate_limiter.close()
        await disconnect_db()
        raise
    
    logger.info("✨ CivicLink Backend ready to serve requests")
    yield 
    
    logger.info("🛑 Shutting down CivicLink Backend...")
    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    if pending:
        logger.info(f"⏳ Cancelling {len(pending)} pending tasks...")
        for task in pending:
            task.cancel()
        try:
            await asyncio.gather(*pending, return_exceptions=True)
        except asyncio.CancelledError:
            pass
            
    try:
        await shutdown_contact_discovery()
        await shutdown_dispatch()
        await shutdown_drafting()
        logger.info("✅ Node shutdown hooks completed")
    except Exception as e:
        logger.error("❌ Node shutdown failed", exc_info=e)
    
    try:
        shutdown_observability()
    except Exception:
        pass
    
    await rate_limiter.close()
    await disconnect_db()
    logger.info("Shutdown complete.")

# =============================================================================
# FASTAPI INITIALIZATION & MIDDLEWARE
# =============================================================================

app = FastAPI(
    title="CivicLink Core API",
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan,
)

origins = settings.CORS_ORIGINS.split(",") if settings.CORS_ORIGINS else []
if not origins or "*" in origins:
    logger.warning("CORS_ORIGINS is empty or contains wildcard. Defaulting to strict localhost/Vercel.")
    origins = [
        "http://localhost:3000",
        "https://civic-link.vercel.app" 
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or f"req-{os.urandom(8).hex()}"
    logger_adapter = logging.LoggerAdapter(logger, {"request_id": request_id})
    
    if "/api/v1/status/" not in request.url.path:
        logger_adapter.info(f"📥 {request.method} {request.url.path}")
        
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

if settings.ENABLE_METRICS:
    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        env_var_name="ENABLE_METRICS",
    ).instrument(app).expose(app, endpoint="/metrics")

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

# =============================================================================
# HEALTH CHECKS
# =============================================================================

@app.get("/health", tags=["health"], response_class=PlainTextResponse)
async def health_check():
    return "OK"

@app.get("/ready", tags=["health"])
async def readiness_check():
    checks = {"database": False, "rate_limiter": False, "langgraph": False}
    
    try:
        if prisma.is_connected():
            await prisma.systemsetting.find_first()
            checks["database"] = True
    except Exception: pass
    
    try:
        await rate_limiter._get_reputation_db() if hasattr(rate_limiter, '_get_reputation_db') else None
        checks["rate_limiter"] = True
    except Exception: pass
    
    try:
        checks["langgraph"] = getattr(app.state, "graph", None) is not None
    except Exception: pass
    
    all_healthy = all(checks.values())
    status_code = status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    
    return JSONResponse(status_code=status_code, content={"status": "healthy" if all_healthy else "unhealthy", "checks": checks})

# =============================================================================
# ASYNC WORKFLOW EXECUTION
# =============================================================================

async def execute_langgraph_workflow(payload: dict, request_id: str, is_resume: bool = False):
    tracer = get_tracer("civiclink.workflow")
    thread_id = payload.get("thread_id")
    
    with tracer.start_as_current_span("workflow.execute", attributes={"thread_id": thread_id}) as span:
        try:
            graph = app.state.graph
            config = {
                "configurable": {
                    "thread_id": thread_id,
                    "raw_payload": payload 
                }
            }
            
            if not is_resume:
                input_state = {
                    "session_id": payload.get("phone_number", "anonymous"),
                    "thread_id": thread_id,
                    "tracking_id": f"CIVIC-{payload.get('phone_number', '0000')[-4:]}-{thread_id[-6:]}",
                    "user_input": payload.get("text_message", ""),
                    "text_message": payload.get("text_message", ""),
                    "text_body": payload.get("text_message", ""),
                    "is_grievance_complete": False,
                    "retry_count": 0
                }
                
                if payload.get("image_url"):
                    input_state["image_url"] = payload.get("image_url")
                if payload.get("location"):
                    input_state["location_raw"] = payload.get("location")
            else:
                input_state = None
            
            logger.info(f"\n⚙️ [ORCHESTRATOR] {'Resuming' if is_resume else 'Spinning up'} LangGraph for thread: {thread_id}")
            
            async for output in graph.astream(input_state, config=config):
                for node_name, node_state in output.items():
                    logger.info(f"  └─ ✅ [NODE COMPLETED] {node_name.upper()}")
                    span.add_event(f"node.completed.{node_name}")
            
            logger.info(f"🏁 [ORCHESTRATOR] Graph execution halted or finished for {thread_id}\n")
            span.set_attribute("workflow.status", "success")
            
        except Exception as e:
            span.set_attribute("workflow.status", "error")
            span.record_exception(e)
            logger.error(f"❌ [ORCHESTRATOR] Workflow execution failed: {str(e)}", exc_info=True)

# =============================================================================
# API ROUTES
# =============================================================================

@app.post("/api/v1/ingest", dependencies=[Depends(verify_system_key)], tags=["ingestion"])
async def ingest_grievance(request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()
    request_id = request.headers.get("X-Request-ID", "unknown")
    
    raw_phone = payload.get("phone_number")
    if not raw_phone:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Phone number/User ID required"})
        
    hashed_phone = hash_phone_number(raw_phone)
    payload["phone_number"] = hashed_phone

    thread_id = payload.get("thread_id")
    text_message = payload.get("text_message", "")

    # =========================================================================
    # 🚨 1. BULLETPROOF INSTANT THREAD ANCHORING 
    # =========================================================================
    if thread_id:
        try:
            citizen = await prisma.citizen.find_first(
                where={
                    "OR": [
                        {"phoneHash": hashed_phone},
                        {"username": raw_phone} 
                    ]
                }
            )

            # 🚨 FIX: Auto-provision fallback if the race condition hides the citizen
            if not citizen:
                logger.warning(f"Citizen not found for {raw_phone}. Auto-provisioning anchor...")
                try:
                    citizen = await prisma.citizen.create(
                        data={
                            "phoneHash": hashed_phone,
                            "encryptedPhone": "AUTOGENERATED_FALLBACK",
                            "username": f"User_{os.urandom(3).hex().upper()}",
                            "trustScore": 1.0,
                            "encryptionKeyVer": "v1"
                        }
                    )
                except Exception as e:
                    logger.error(f"Failed to auto-provision citizen: {e}")
                    return JSONResponse(status_code=500, content={"status": "error", "message": "Failed to anchor identity"})

            if citizen:
                existing_thread = await prisma.grievancethread.find_unique(
                    where={"threadId": thread_id}
                )
                
                if not existing_thread:
                    try:
                        await prisma.grievancethread.create(
                            data={
                                "threadId": thread_id, 
                                "citizenId": citizen.id
                            }
                        )
                    except Exception as e:
                        logger.error(f"Failed to create parent GrievanceThread: {e}")

                existing_case = await prisma.grievancecase.find_unique(
                    where={"threadId": thread_id}
                )

                if not existing_case:
                    await prisma.grievancecase.create(
                        data={
                            "trackingId": f"CLC-{os.urandom(4).hex().upper()}",
                            "threadId": thread_id,
                            "citizenId": citizen.id,
                            "status": "RECEIVED",
                            "issueCategory": "PENDING_TRIAGE",
                            "descriptionText": text_message[:150], 
                            "severity": "LOW",
                            # 🚨 FIX: Prisma strongly types JSON. We MUST wrap payload in Json()
                            "rawInputPayload": Json(payload) 
                        }
                    )
                
        except Exception as e:
            logger.error(f"Database Anchoring Blocked (FK/Serialization Constraint): {e}")
            
    # 🚨 2. FIRE THE LANGGRAPH ORCHESTRATOR
    background_tasks.add_task(execute_langgraph_workflow, payload, request_id)
    
    return {
        "status": "success", 
        "message": "Grievance queued for AI processing",
        "thread_id": thread_id
    }

@app.get("/api/v1/status/{thread_id}", tags=["status"])
async def get_grievance_status(thread_id: str):
    graph = app.state.graph
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        current_state = await graph.aget_state(config)
        state_values = current_state.values if current_state else {}
    except Exception:
        state_values = {}
        
    ai_reply = state_values.get("conversational_reply")
    
    case = await prisma.grievancecase.find_unique(
        where={"threadId": thread_id},
        include={"dispatchRecords": True}
    )
    
    if not case:
        return {
            "status": "chatting", 
            "current_state": "PENDING_DETAILS",
            "reply_message": ai_reply or "Processing..."
        }
        
    return {
        "status": "found",
        "current_state": case.status,
        "reply_message": ai_reply,
        "issue_category": case.issueCategory,
        "description_text": case.descriptionText,
        "system_metadata": case.systemMetadata,
        "dispatch_records": [
            {"email": r.targetEmail, "status": r.status} 
            for r in case.dispatchRecords
        ] if case.dispatchRecords else []
    }

@app.get("/api/v1/admin/graph-state/{thread_id}", dependencies=[Depends(verify_frontend_auth)], tags=["admin"])
async def get_graph_state(thread_id: str):
    graph = app.state.graph
    config = {"configurable": {"thread_id": thread_id}}
    try:
        current_state = await graph.aget_state(config)
        nodes = []
        state_values = current_state.values
        next_nodes = current_state.next
        
        if "extracted_text" in state_values:
            nodes.append({"id": "ingest", "name": "Ingest & NLP Normalization", "status": "success", "output": {"text": state_values.get("extracted_text")}})
        if "system_metadata" in state_values and "auth_score" in state_values.get("system_metadata", {}):
            nodes.append({"id": "vlm_verify", "name": "VLM Deepfake Forensics", "status": "success", "confidence": state_values["system_metadata"]["auth_score"], "output": {"is_genuine": True}})
        if "verification_gate" in next_nodes:
            nodes.append({"id": "verification_gate", "name": "Human-in-the-Loop Review", "status": "running"})
            
        return {"nodes": nodes, "is_paused": len(next_nodes) > 0}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/v1/admin/retry/{thread_id}/{node_id}", dependencies=[Depends(verify_frontend_auth)], tags=["admin"])
async def retry_graph_node(thread_id: str, node_id: str):
    graph = app.state.graph
    await graph.aupdate_state({"configurable": {"thread_id": thread_id}}, None, as_node=node_id)
    return {"status": "retrying", "node": node_id}

@app.post("/api/v1/admin/review/{thread_id}", dependencies=[Depends(verify_frontend_auth)], tags=["admin"])
async def admin_review_decision(thread_id: str, payload: dict, background_tasks: BackgroundTasks):
    decision = payload.get("decision")
    if decision not in ["APPROVED", "REJECTED"]:
        return JSONResponse(status_code=400, content={"error": "Invalid Decision"})
        
    graph = app.state.graph
    config = {"configurable": {"thread_id": thread_id}}
    
    # 1. Resume the LangGraph AI
    await graph.aupdate_state(config, {"human_review_decision": decision}, as_node="human_review")
    background_tasks.add_task(execute_langgraph_workflow, {"thread_id": thread_id}, f"resume-{thread_id}", True)
    
    # 🚨 2. WRITE TO THE IMMUTABLE AUDIT LOG
    try:
        # Retrieve the case to get its actual DB ID
        case = await prisma.grievancecase.find_unique(where={"threadId": thread_id})
        
        await prisma.systemauditlog.create(
            data={
                "actor": "Admin API", # In production, extract Admin Name from JWT Token
                "actorRole": "REVIEWER", 
                "action": f"REVIEW_{decision}",
                "severity": "SUCCESS" if decision == "APPROVED" else "WARNING",
                "target": f"Thread: {thread_id}",
                "details": f"Human-in-the-Loop decision processed. Result: {decision}",
                "ip": "INTERNAL",
                # Generate a pseudo-cryptographic seal
                "immutableHash": f"SEAL-{os.urandom(16).hex()}" 
            }
        )
        
        # Also update the GrievanceCase with the accountability record
        if case:
            await prisma.grievancecase.update(
                where={"threadId": thread_id},
                data={
                    "reviewDecision": decision,
                    "reviewedAt": datetime.utcnow().isoformat() + "Z"
                }
            )
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")
    
    return {"status": "success"}

@app.get("/api/v1/admin/stream", tags=["admin", "sse"])
async def admin_sse_stream(request: Request):
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected(): break
                yield "data: {\"type\": \"ping\"}\n\n"
                await asyncio.sleep(5)
        except asyncio.CancelledError: pass
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})

# =============================================================================
# ROUTERS & EXCEPTIONS
# =============================================================================
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin-dashboard"])
app.include_router(citizen_router, prefix="/api/v1/auth/citizen", tags=["citizen-auth"])

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": {"code": 500, "message": "Internal server error"}})

@app.get("/", tags=["root"], response_class=PlainTextResponse)
async def root():
    return f"CivicLink API v{settings.APP_VERSION}\nEnvironment: {settings.ENVIRONMENT}\nDocs: /docs"

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)