# backend/brain/workflow.py
"""
CivicLink Master LangGraph Orchestrator.
Compiles the state machine, wires the conditional edges, and mounts the 
Async PostgreSQL checkpointer with connection pooling.
"""
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

from backend.core.config import settings
from backend.brain.state import CivicLinkState
from backend.brain.routing import ROUTING_EDGES

# Import the nodes we've built (and placeholders for the ones we haven't)
from backend.brain.nodes.ingest_node import ingest_node
from backend.brain.nodes.vlm_verify import vlm_verify_node
# from backend.brain.nodes.jurisdiction import resolve_jurisdiction_node
# from backend.brain.nodes.contact import discover_contact_node
# from backend.brain.nodes.drafting import draft_letter_node
# from backend.brain.nodes.gatekeeper import verification_gate_node
# from backend.brain.nodes.dispatch import dispatch_node

logger = logging.getLogger(__name__)

# --- Placeholder Nodes (To be replaced as we build them) ---
async def dummy_node(state: CivicLinkState) -> dict:
    return {}

# ---------------------------------------------------------
# 1. GRAPH CONSTRUCTION
# ---------------------------------------------------------
def build_graph_definition() -> StateGraph:
    """Defines the nodes and edges without compiling the checkpointer."""
    workflow = StateGraph(CivicLinkState)
    
    # Add Nodes
    workflow.add_node("ingest", ingest_node)
    workflow.add_node("vlm_verify", vlm_verify_node)
    workflow.add_node("resolve_jurisdiction", dummy_node) # Pending
    workflow.add_node("discover_contact", dummy_node)     # Pending
    workflow.add_node("draft_letter", dummy_node)         # Pending
    workflow.add_node("verification_gate", dummy_node)    # Pending
    workflow.add_node("dispatch", dummy_node)             # Pending
    
    # Human Review is a dummy node because the logic happens externally via API
    workflow.add_node("human_review", dummy_node) 
    
    # Set Entry Point
    workflow.set_entry_point("ingest")
    
    # Wire Conditional Edges
    workflow.add_conditional_edges("ingest", ROUTING_EDGES["ingest"])
    workflow.add_conditional_edges("vlm_verify", ROUTING_EDGES["vlm_verify"])
    workflow.add_conditional_edges("resolve_jurisdiction", ROUTING_EDGES["resolve_jurisdiction"])
    workflow.add_conditional_edges("discover_contact", ROUTING_EDGES["discover_contact"])
    workflow.add_conditional_edges("draft_letter", ROUTING_EDGES["draft_letter"])
    workflow.add_conditional_edges("verification_gate", ROUTING_EDGES["verification_gate"])
    workflow.add_conditional_edges("dispatch", ROUTING_EDGES["dispatch"])
    workflow.add_conditional_edges("human_review", ROUTING_EDGES["human_review"])
    
    return workflow

# ---------------------------------------------------------
# 2. ASYNC CHECKPOINTER & COMPILATION
# ---------------------------------------------------------
@asynccontextmanager
async def get_compiled_graph() -> AsyncGenerator[Any, None]:
    """
    Context manager that yields the fully compiled, database-backed LangGraph.
    Manages the AsyncConnectionPool lifecycle safely.
    """
    connection_string = settings.DATABASE_URL
    
    # Initialize a connection pool for the async checkpointer
    async with AsyncConnectionPool(
        conninfo=connection_string,
        max_size=10,
        kwargs={"autocommit": True, "prepare_threshold": 0}
    ) as pool:
        
        checkpointer = AsyncPostgresSaver(pool)
        
        # Ensure the LangGraph checkpoint tables exist in the DB
        await checkpointer.setup()
        
        workflow = build_graph_definition()
        
        # Compile with the checkpointer and the explicit HITL interrupt
        compiled_graph = workflow.compile(
            checkpointer=checkpointer,
            interrupt_before=["human_review"] # 🚨 LangGraph-native HITL pause
        )
        
        yield compiled_graph