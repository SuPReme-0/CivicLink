---
title: CivicLink Backend
emoji: 🏛️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🏛️ CivicLink: Autonomous Citizen Grievance Agent

CivicLink is a production-grade, highly autonomous AI backend designed to resolve citizen grievances. Powered by a LangGraph agentic workflow, it processes natural language complaints, verifies image forensics via Vision-Language Models (VLMs), autonomously deduces complex Indian administrative geographies using 70B LLMs, dynamically scrapes government portals for official contact details, and drafts legally bound grievance notices.

## 🚀 Key Features

* **Omniscient Geo-Resolver:** Bypasses brittle standard geocoders. Uses `Llama-3.3-70B` to instantly map hyper-local landmarks (e.g., "Sector 62 Metro Station") to strict Indian administrative districts and states.
* **Agentic OSINT Seeder:** If a jurisdiction isn't in the database, the AI autonomously deduces the municipal hierarchy and seeds the PostgreSQL database with vector-embedded routing pathways.
* **Autonomous Contact Spider:** Uses Playwright to geofence and crawl government directories, leveraging the 70B model to extract the exact official's email (with Fast-Path DB caching for speed).
* **VLM Forensics:** Analyzes uploaded grievance images for authenticity and severity, seamlessly merging visual data with the RAG pipeline.
* **Self-Healing Routing:** A 100% autonomous pipeline. If an API rate-limits, a scrape fails, or a location is too ambiguous, the system physically halts and dynamically routes back to the LLM to ask the user for conversational clarification.
* **Multi-Provider Fallback:** Primary inference via Groq for extreme speed, with automatic fallback to Gemini to circumvent rate limits and ensure 100% uptime.

## 🧠 The Agentic Pipeline (LangGraph)

1. **Ingest Node:** Parses user intent and manages the conversational state.
2. **VLM Verify:** Authenticates image metadata and extracts visual grievance context.
3. **Resolve Jurisdiction:** Queries the pgvector database for administrative targets.
4. **OSINT Seeder:** Resolves mapping blind spots using 70B geographic deduction.
5. **Discover Contact:** Web-scrapes target government portals for verified emails.
6. **Draft Letter:** Retrieves local statutes via Legal RAG and drafts a formal notice.
7. **Verification Gate:** A mathematical circuit breaker that halts the graph if confidence scores drop, preventing unauthorized dispatches.

## 🛠️ Tech Stack

* **Core:** Python 3.11, FastAPI, LangGraph
* **AI & Inference:** LangChain, Groq (Llama-3.3-70B), Google Gemini (2.5 Flash / Pro)
* **Database:** PostgreSQL (Supabase) with `pgvector`
* **ORM:** Prisma Client Python
* **Scraping:** Playwright, BeautifulSoup
* **Deployment:** Docker, Hugging Face Spaces

## ⚙️ Environment Setup

To run this application locally or deploy to Hugging Face, you must configure the following variables in your `.env` file (or Hugging Face Secrets):

```env
# API Keys
FRONTEND_API_KEY="your_secure_frontend_key"
GROQ_API_KEY="gsk_your_groq_key"
GEMINI_API_KEY="AIza_your_gemini_key"

# Database
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"

# Model Config (Optional Defaults)
GROQ_MODEL="llama-3.3-70b-versatile"
GEMINI_MODEL="gemini-2.5-flash"
EMBEDDING_MODEL_NAME="BAAI/bge-small-en-v1.5"