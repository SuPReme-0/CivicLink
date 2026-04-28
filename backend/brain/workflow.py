# backend/brain/workflow.py
"""
CivicLink Master LangGraph Orchestrator.
Compiles the state machine, wires the conditional edges, and mounts the 
checkpointer for conversational memory.
"""
import logging
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from backend.core.config import settings
from backend.brain.state import CivicLinkState
from backend.brain.routing import ROUTING_EDGES

# 🚨 IMPORTING THE REAL PRODUCTION NODES
from backend.brain.nodes.verification_gate import verification_gate_node # 🚨 ADD THIS
from backend.brain.nodes.ingest_node import ingest_node
from backend.brain.nodes.vlm_verify import vlm_verify_node
from backend.brain.nodes.jurisdiction import resolve_jurisdiction_node
from backend.brain.nodes.contact import contact_discovery_node
from backend.brain.nodes.drafting import drafting_node
from backend.brain.nodes.dispatch import dispatch_node

logger = logging.getLogger(__name__)

# =============================================================================
# 🚧 PENDING NODES (To be built next)
# =============================================================================

async def human_review_node(state: CivicLinkState) -> dict:
    """
    This node does nothing computationally. It acts as an anchor for the LangGraph interrupt.
    The graph pauses BEFORE this node, and resumes when an Admin updates the state.
    """
    return {}

# =============================================================================
# 🏗️ GRAPH CONSTRUCTION & COMPILATION
# =============================================================================
def build_civiclink_graph():
    """
    Defines nodes, wires conditional edges, and compiles the workflow.
    """
    workflow = StateGraph(CivicLinkState)
    
    # 1. Register Nodes
    workflow.add_node("ingest", ingest_node)
    workflow.add_node("vlm_verify", vlm_verify_node)
    workflow.add_node("resolve_jurisdiction", resolve_jurisdiction_node)
    workflow.add_node("discover_contact", contact_discovery_node)
    workflow.add_node("draft_letter", drafting_node)
    workflow.add_node("verification_gate", verification_gate_node)
    workflow.add_node("human_review", human_review_node)
    workflow.add_node("dispatch", dispatch_node)
    
    # 2. Set Entry Point (Every user message hits ingest first)
    workflow.set_entry_point("ingest")
    
    # 3. Wire Conditional Edges using our Central Routing Registry
    # This ensures every node has a fail-safe fallback to Human Review
    workflow.add_conditional_edges("ingest", ROUTING_EDGES["ingest"])
    workflow.add_conditional_edges("vlm_verify", ROUTING_EDGES["vlm_verify"])
    workflow.add_conditional_edges("resolve_jurisdiction", ROUTING_EDGES["resolve_jurisdiction"])
    workflow.add_conditional_edges("discover_contact", ROUTING_EDGES["discover_contact"])
    workflow.add_conditional_edges("draft_letter", ROUTING_EDGES["draft_letter"])
    workflow.add_conditional_edges("verification_gate", ROUTING_EDGES["verification_gate"])
    workflow.add_conditional_edges("dispatch", ROUTING_EDGES["dispatch"])
    workflow.add_conditional_edges("human_review", ROUTING_EDGES["human_review"])
    
    # 4. Initialize Synchronous Checkpointer (Memory)
    memory = MemorySaver()
    
    # 5. Compile Graph with HARD INTERRUPTS
    compiled_graph = workflow.compile(
        checkpointer=memory,
        # 🚨 This physically locks the background thread from executing any further 
        # until an Admin explicitly resumes it via the /admin API.
        interrupt_before=["human_review"] 
    )
    
    return compiled_graph