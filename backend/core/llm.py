# backend/core/llm.py
import os
import logging
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI

logger = logging.getLogger(__name__)

def get_llm():
    api_key = os.environ.get("GROQ_API_KEY")
    return ChatGroq(
        temperature=0.0, 
        model_name="llama-3.3-70b-versatile",
        max_retries=0, # 🚨 Forces instant failure on 429 so our fallback triggers
        api_key=api_key
    )

def get_fast_llm():
    api_key = os.environ.get("GROQ_API_KEY")
    return ChatGroq(
        temperature=0.0, 
        model_name="llama-3.1-8b-instant",
        max_retries=0, # 🚨 Prevent silent 16-second hangs
        api_key=api_key
    )

def get_vlm():
    """
    Primary Vision Engine. 
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    return ChatGoogleGenerativeAI(
        temperature=0.0,
        model="gemini-2.0-flash",
        google_api_key=api_key
    )