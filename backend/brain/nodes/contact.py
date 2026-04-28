# backend/brain/nodes/contact.py
"""
Production OSINT Contact Discovery Node.
- Exhaustive Graph Building (Crawls deep, aggregates all contacts)
- Universal Entity Deduction with 70B orchestration
- 8B Llama Routing for internal navigation (token efficient)
- 70B for search generation, URL selection, contact extraction
- Confidence Threshold Gating (Prevents Blind Dispatches)
- SSL Bypass & Fast Commit Loading
"""
import asyncio
import logging
import re
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

import aiohttp
import dns.resolver
import smtplib
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, BrowserContext, Route
from langgraph.config import RunnableConfig
from pydantic import BaseModel, Field
from langchain_core.prompts import PromptTemplate

from backend.brain.state import CivicLinkState
from backend.core.observability import get_tracer
from backend.core.db import prisma
from backend.core.llm import get_llm, get_fast_llm  # get_llm returns 70B (Groq), get_fast_llm returns 8B

logger = logging.getLogger(__name__)
tracer = get_tracer("contact_discovery")

# ---------------------------------------------------------
# PLAYWRIGHT MANAGER (SSL Bypass & Fast Load)
# ---------------------------------------------------------
class PlaywrightManager:
    _playwright = None
    _browser = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_context(cls) -> BrowserContext:
        async with cls._lock:
            if cls._browser is None or not cls._browser.is_connected():
                cls._playwright = await async_playwright().start()
                cls._browser = await cls._playwright.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled", "--no-sandbox",
                          "--disable-gpu", "--disable-dev-shm-usage"]
                )
            context = await cls._browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                bypass_csp=True,
                ignore_https_errors=True  # SSL bypass
            )
            async def block_resources(route: Route):
                if route.request.resource_type in ["media", "font", "stylesheet", "image"]:
                    await route.abort()
                else:
                    await route.continue_()
            await context.route("**/*", block_resources)
            return context

    @classmethod
    async def close(cls):
        async with cls._lock:
            if cls._browser:
                await cls._browser.close()
                cls._browser = None
            if cls._playwright:
                await cls._playwright.stop()
                cls._playwright = None

# ---------------------------------------------------------
# AI MODELS (70B ORCHESTRATION + 8B ROUTING)
# ---------------------------------------------------------
class SearchQueries(BaseModel):
    queries: List[str] = Field(description="Top 2 precise search engine queries.")

class LinkSelection(BaseModel):
    selected_urls: List[str] = Field(description="Top 3 URLs to explore next.")

class OfficialContact(BaseModel):
    officialDesignation: str = Field(description="Exact job title")
    officialName: Optional[str] = Field(default="Concerned Authority")
    officialEmail: Optional[str] = None
    phone: Optional[str] = None
    confidenceScore: float = 0.0

class ContactExtractionResult(BaseModel):
    contacts: List[OfficialContact] = Field(description="List of extracted contacts. Maximum 10.", max_length=10)

# ---------------------------------------------------------
# 70B: Generate precise search queries
# ---------------------------------------------------------
async def _generate_search_queries(district: str, state: str, category: str) -> List[str]:
    llm = get_llm()  # 70B model
    structured_llm = llm.with_structured_output(SearchQueries)
    clean_cat = category.split(',')[0].strip().upper()

    prompt = PromptTemplate.from_template("""
    You are an expert Indian Government OSINT researcher.
    Find the official contact directory for '{clean_cat}' in {district}, {state}, India.

    JURISDICTION RULES:
    1. METROPOLITAN: Municipal Corporation handles Roads, Water, Sanitation, Encroachment.
    2. RURAL: PWD (Roads), PHE (Water), District Magistrate (Encroachment), CMOH (Health).
    3. ELECTRICITY: State Electricity Boards or private metro utilities.

    IMPORTANT: Do NOT hallucinate neighboring districts. Keep queries strictly about {district}.
    Generate 2 precise search terms that will return the official contact/directory page.
    Example format: "{district} Municipal Corporation contact directory", "PWD {district} official website"
    """)
    try:
        res = await structured_llm.ainvoke(prompt.format(clean_cat=clean_cat, district=district, state=state))
        return res.queries
    except Exception:
        # Fallback to a safe default query (still AI-generated but simpler)
        fallback_prompt = f"Generate one search query for the official website of {district}, {state}, India."
        resp = await llm.ainvoke(fallback_prompt)
        lines = [line.strip().strip('"') for line in resp.content.strip().split('\n') if line.strip()]
        return lines[:1] if lines else [f"{district} district administration official website {state}"]

# ---------------------------------------------------------
# SEARCH ENGINE (DuckDuckGo) – returns full URLs
# ---------------------------------------------------------
async def _dynamic_url_discovery(query: str) -> List[str]:
    urls = []
    search_url = "https://lite.duckduckgo.com/lite/"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(search_url, data={"q": query},
                                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, "lxml")
                    for a in soup.find_all('a'):
                        href = a.get('href')
                        if href and href.startswith('http'):
                            # Keep full URL; prefer Indian government domains
                            if any(ext in href for ext in ['.gov.in', '.nic.in', '.co.in']) and 'duckduckgo' not in href:
                                urls.append(href)
    except Exception as e:
        logger.warning(f"Dynamic search failed: {e}")
    # Deduplicate and limit
    return list(dict.fromkeys(urls))[:5]  # return up to 5 raw results

# ---------------------------------------------------------
# 70B: From search results, pick the 3 best contact-page candidates
# ---------------------------------------------------------
async def _ai_select_starting_urls(search_urls: List[str], target_desc: str, district: str) -> List[str]:
    if not search_urls:
        return []
    # Pre‑filter: remove non‑HTML, non‑gov domains that are clearly wrong
    filtered = []
    for url in search_urls:
        if url.endswith(('.pdf', '.doc', '.xls', '.zip')):
            continue
        # Only keep URLs that contain the district name or common state/district patterns
        # This is a simple heuristic – the AI will further refine.
        if district.replace(' ', '').lower() in url.replace(' ', '').lower() or '.gov.in' in url or '.nic.in' in url:
            filtered.append(url)
    # If all filtered out, fall back to the original (AI will decide)
    if not filtered:
        filtered = search_urls

    llm = get_llm()  # 70B
    structured_llm = llm.with_structured_output(LinkSelection)
    urls_text = "\n".join(filtered[:10])
    prompt = PromptTemplate.from_template("""
    You are an OSINT agent. The target is a contact directory for: {target_desc} in {district}, India.
    From these URLs, select up to 3 that are most likely to contain a **direct** list of officials (e.g. "Contact Us", "Officials Directory", "Who's Who", departmental sub‑pages).
    IMPORTANT:
    - The URL **must** belong to an organisation in {district}.
    - Do NOT select language‑selection pages, login portals, or homepage splash screens.
    - Exclude any link pointing to a PDF or document file.
    Return only the full URLs.
    URLs:
    {urls}
    """)
    try:
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, urls=urls_text, district=district))
        return result.selected_urls[:3]
    except Exception:
        # fallback to any .gov.in or .nic.in
        return [u for u in filtered if '.gov.in' in u or '.nic.in' in u][:3]
# ---------------------------------------------------------
# 70B: Fallback - generate candidate URLs when search returns nothing
# ---------------------------------------------------------
async def _ai_generate_candidate_urls(district: str, state: str, category: str) -> List[str]:
    llm = get_llm()  # 70B
    prompt = f"""You are an expert on Indian government websites.
    Category: '{category}'. District: {district}, State: {state}.
    Suggest up to 3 likely official web page URLs that would contain a contact directory for this category in that district.
    Prefer .gov.in, .nic.in, or official municipal corporation sites.
    Return ONLY the full URLs, one per line. No explanation.
    Example:
    https://example.gov.in/contact
    """
    try:
        resp = await llm.ainvoke(prompt)
        urls = re.findall(r'https?://[^\s]+', resp.content)
        return urls[:3]
    except Exception:
        # Last resort fallback to common patterns (still not hardcoded district names)
        return [
            f"https://{district}.nic.in",
            f"https://{district}.gov.in",
            f"https://{district}.{state}.gov.in"
        ]

# ---------------------------------------------------------
# 8B (FAST): Internal link routing within a site
# ---------------------------------------------------------
async def _ai_select_next_links(links: List[Dict[str, str]], target_desc: str) -> List[str]:
    if not links:
        return []
    links = links[:40]  # prevent large payload
    llm = get_fast_llm()  # 8B model – cheap and fast
    try:
        structured_llm = llm.with_structured_output(LinkSelection)
        unique_links = {l['href']: l['text'] for l in links}
        links_text = "\n".join([f"- {text}: {href}" for href, text in unique_links.items()])

        prompt = PromptTemplate.from_template("""
    You are an OSINT spider. Find the directory for: {target_desc}.
    From these internal links, choose up to 3 that most likely lead to the department's personnel, leadership, or contact page.
    DO NOT select:
    - Language selection pages (e.g., "language", "languages", "select language")
    - Printer‑friendly versions
    - PDFs or documents
    - "Home" (unless it's the only option)
    LINKS:
    {links}
    """)
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, links=links_text))
        return result.selected_urls
    except Exception:
        # Local fallback: look for keywords
        keywords = ['contact', 'who', 'direct', 'depart', 'admin']
        return [l['href'] for l in links if any(kw in l['href'].lower() for kw in keywords)][:3]

# ---------------------------------------------------------
# 70B: Extract contacts from page text (already high accuracy)
# ---------------------------------------------------------
async def _ai_extract_all_contacts(sniper_text: str, target_desc: str) -> List[Dict[str, Any]]:
    llm = get_llm()  # 70B
    structured_llm = llm.with_structured_output(ContactExtractionResult)

    prompt = PromptTemplate.from_template("""
    You are an OSINT extraction agent. Extract every real government official from this text.
    DO NOT hallucinate. DO NOT pad with nulls.

    Target: '{target_desc}'.
    Scoring:
    - If the person exactly matches the target role, confidence = 0.9-1.0.
    - If the person is related (e.g., superior officer), confidence = 0.7-0.8.
    - If unrelated, set low confidence and still include if present.

    Decode obfuscated emails like [at] nic [dot] in.
    TEXT:
    {text}
    """)
    try:
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, text=sniper_text[:6000]))
        return [c.model_dump() for c in result.contacts
                if c.officialEmail and c.officialEmail.lower() != "null"]
    except Exception as e:
        logger.error(f"70B extraction failed: {e}")
        return []

# ---------------------------------------------------------
# SMTP VERIFICATION (unchanged)
# ---------------------------------------------------------
async def _verify_smtp_async(email: str) -> str:
    def sync_smtp_check() -> str:
        try:
            domain = email.split("@")[1]
            try:
                mx_records = dns.resolver.resolve(domain, "MX")
                if not mx_records:
                    return "FAILED"
            except Exception:
                return "FAILED"
            mx_host = str(mx_records[0].exchange)
            server = smtplib.SMTP(timeout=3)
            server.connect(mx_host, 25)
            server.helo()
            server.mail("verify@civiclink.local")
            code, _ = server.rcpt(email)
            server.quit()
            return "VERIFIED" if code == 250 else "FAILED"
        except Exception:
            return "FAILED"
    return await asyncio.to_thread(sync_smtp_check)

# ---------------------------------------------------------
# MAIN GRAPH NODE
# ---------------------------------------------------------
async def contact_discovery_node(state: CivicLinkState, config: RunnableConfig) -> dict:
    jurisdiction = state.get("jurisdiction_hierarchy", {})
    record_id = jurisdiction.get("id")
    district = jurisdiction.get("district", "").strip().lower()
    state_code = jurisdiction.get("state", "").strip().lower()
    target_category = jurisdiction.get("issueCategory", "General Administration")
    target_designation = jurisdiction.get("officialDesignation", "Official")
    target_desc = f"{target_designation} for {target_category} in {district}"
    current_retry = state.get("retry_count", 0)

    if not record_id or not district:
        return {"current_status": "AWAITING_REVIEW", "error_log": [{"action": "missing_jurisdiction"}]}

    with tracer.start_as_current_span("contact_discovery_node"):
        try:
            if not prisma.is_connected():
                await prisma.connect()

            # Fast path: cached contact in DB
            db_record = await prisma.administrativehierarchy.find_unique(where={"id": record_id})
            if db_record and db_record.officialEmail:
                logger.info(f"⚡ FAST PATH: Cached email: {db_record.officialEmail}")
                return {
                    "current_status": "DRAFTING_LETTER",
                    "primary_contact": {
                        "officialEmail": db_record.officialEmail,
                        "officialDesignation": db_record.officialDesignation,
                        "officialName": db_record.officialName
                    },
                    "discovered_contacts": []
                }

            # --- 1. 70B generates search queries ---
            logger.info(f"🧠 70B: Generating search queries for {target_category} in {district}...")
            queries = await _generate_search_queries(district, state_code, target_category)
            logger.info(f"   Queries: {queries}")

            # --- 2. Execute searches and collect full URLs ---
            raw_search_urls = []
            for q in queries:
                urls = await _dynamic_url_discovery(q)
                raw_search_urls.extend(urls)
            raw_search_urls = list(dict.fromkeys(raw_search_urls))  # deduplicate

            # --- 3. 70B selects the best 3 starting URLs ---
            if raw_search_urls:
                logger.info(f"🧠 70B: Selecting best starting URLs from {len(raw_search_urls)} candidates...")
                frontier = await _ai_select_starting_urls(raw_search_urls, target_desc, district)
                logger.info(f"   Selected: {frontier}")
            else:
                # --- Fallback: 70B generates candidate URLs directly ---
                logger.warning("No search results. 🧠 70B: Generating candidate URLs...")
                frontier = await _ai_generate_candidate_urls(district, state_code, target_category)
                logger.info(f"   AI‑generated fallback URLs: {frontier}")

            if not frontier:
                logger.error("❌ Completely unable to discover URLs. Cannot proceed.")
                return {"current_status": "FAILED", "error_log": [{"action": "no_urls_available"}]}

            # --- 4. Spider crawling (8B for internal routing) ---
            logger.info(f"🕷️ Starting spider on {len(frontier)} seed URLs...")
            context = await PlaywrightManager.get_context()
            visited: set = set()
            all_found_contacts = []
            max_pages = 15 # limit total crawled pages
            pages_crawled = 0

            while frontier and pages_crawled < max_pages:
                current_url = frontier.pop(0)
                if current_url in visited:
                    continue
                visited.add(current_url)
                pages_crawled += 1
                logger.info(f"   [{pages_crawled}/{max_pages}] Scanning: {current_url}")

                page = await context.new_page()
                try:
                    if current_url.split('?')[0].split('.')[-1].lower() in ('pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip'):
                        logger.info(f"     Skipping non‑HTML file: {current_url}")
                        continue
                    await page.goto(current_url, wait_until="networkidle", timeout=90000)  # network fully idle
                    await page.wait_for_selector('body', state="visible")  # ensure body rendered
                    await asyncio.sleep(3)  # extra safety for late AJAX
                    await asyncio.sleep(2)  # let dynamic content settle
                    page_text = await page.evaluate("""() => {
                        const root = document.body || document.documentElement;
                        return root ? root.innerText.replace(/\\s+/g, ' ').trim() : '';
                    }""")
                    # Find obfuscated emails
                    obf_pattern = r"(?i)[A-Za-z0-9._%+-]+\s*(?:@|\[at\]|\(at\)|\{at\}|\s+at\s+)\s*[A-Za-z0-9.-]+\s*(?:\.|\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*[A-Za-z]{2,7}"
                    raw_emails = re.findall(obf_pattern, page_text)
                    if raw_emails:
                        logger.info(f"     Found {len(raw_emails)} raw emails. Extracting with 70B...")
                        # Build sniper text around each email
                        sniper_text = ""
                        for match in re.finditer(obf_pattern, page_text):
                            start = max(0, match.start() - 250)
                            end = min(len(page_text), match.end() + 250)
                            sniper_text += page_text[start:end] + "\n...[SNIP]...\n"
                        contacts = await _ai_extract_all_contacts(sniper_text[:6000], target_desc)
                        for c in contacts:
                            if c.get("confidenceScore", 0.0) >= 0.20:
                                c["source_url"] = current_url
                                all_found_contacts.append(c)
                                logger.info(f"     Added: {c.get('officialName')} ({c.get('confidenceScore')})")
                    else:
                        logger.info("     No emails found on this page. Routing internally...")

                    # Internal link routing with 8B
                    raw_links = await page.evaluate("""() => {
                        const rootDomain = window.location.hostname.replace('www.', '');
                        return Array.from(document.querySelectorAll('a'))
                            .map(a => ({ text: a.innerText.trim().replace(/\\s+/g, ' ').substring(0, 60), href: a.href }))
                            .filter(l => l.href.startsWith('http') && l.text.length > 2
                                && new URL(l.href).hostname.includes(rootDomain)
                                && !l.href.endsWith('.pdf') && !l.href.endsWith('.jpg'));
                    }""")
                    if raw_links:
                        unique_links = {l['href']: l for l in raw_links}.values()
                        next_links = await _ai_select_next_links(list(unique_links), target_desc)
                        for link in next_links:
                            if link not in visited and link not in frontier:
                                frontier.append(link)
                except Exception as e:
                    logger.warning(f"     Spider error on {current_url}: {e}")
                finally:
                    await page.close()

            if not all_found_contacts:
                return {
                    "current_status": "AWAITING_REVIEW",
                    "error_log": [{"action": "spider_exhausted_no_target_found"}],
                    "discovered_contacts": [],
                    "retry_count": current_retry + 1
                }

            # --- 5. Select best match and apply confidence gate ---
            primary = max(all_found_contacts, key=lambda x: x.get("confidenceScore", 0.0))
            logger.info(f"🏆 Best match: {primary.get('officialName')} (Score: {primary.get('confidenceScore')})")
            if primary.get("confidenceScore", 0.0) < 0.70:
                logger.warning(f"   ⚠️ Confidence too low ({primary.get('confidenceScore')}). Awaiting review.")
                return {
                    "current_status": "AWAITING_REVIEW",
                    "discovered_contacts": all_found_contacts,
                    "error_log": [{"action": "low_confidence_score", "best_score": primary.get("confidenceScore")}],
                    "retry_count": current_retry + 1
                }

            # Verify email
            primary["verification_status"] = await _verify_smtp_async(primary["officialEmail"])
            # Save to DB
            if db_record:
                await prisma.administrativehierarchy.update(
                    where={"id": db_record.id},
                    data={
                        "officialEmail": primary["officialEmail"],
                        "officialName": primary.get("officialName", "Concerned Authority"),
                        "portalUrl": primary.get("source_url"),
                        "status": "VERIFIED_SMTP" if primary.get("verification_status") == "VERIFIED" else "PENDING"
                    }
                )

            return {
                "current_status": "DRAFTING_LETTER",
                "primary_contact": primary,
                "discovered_contacts": all_found_contacts
            }

        except Exception as e:
            logger.exception(f"Critical spider failure: {e}")
            return {"current_status": "FAILED"}
        finally:
            if 'context' in locals():
                await context.close()

async def shutdown_contact_discovery():
    await PlaywrightManager.close()