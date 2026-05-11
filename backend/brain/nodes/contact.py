"""
Production OSINT Contact Discovery Node.
- Administrative Entity Deduction (LLM expands geography into exact Govt Bodies)
- Exhaustive Graph Building (Crawls deep, aggregates all contacts)
- Strict Pan-India URL Geofencing (Prevents "State Drift" hallucinations)
- 8B Llama Routing for internal navigation (token efficient)
- SSL Bypass, Anti-Zombie Page Loading, & Infinite Loop Prevention
"""
import asyncio
import logging
import re
import sys
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
from backend.core.llm import get_llm, get_fast_llm  

logger = logging.getLogger(__name__)
tracer = get_tracer("contact_discovery")

# ---------------------------------------------------------
# PAN-INDIA GEO-FENCING UTILITY
# ---------------------------------------------------------
def _is_valid_geofenced_url(url: str, target_state: str) -> bool:
    """
    🚨 THE IRON WHITELIST: Fails closed. Only allows URLs that explicitly match 
    Central Government domains or the specific target state's recognized domains.
    """
    if not url:
        return False
        
    url_lower = url.lower()
    
    try:
        netloc = urlparse(url_lower).netloc
    except Exception:
        return False

    # 1. FAIL-CLOSED: If we lost the state context, ONLY allow pan-India gateways.
    if not target_state or target_state.strip().lower() in ["unknown", "none", "null", "n/a", ""]:
        logger.warning(f"⚠️ Missing state context. Restricting {url} to central gateways only.")
        return any(ext in netloc for ext in ["igod.gov.in", "india.gov.in", "nic.in"])

    target_state_lower = target_state.strip().lower()

    # 2. UNIVERSAL WHITELIST: Always allow central government registries
    if any(ext in netloc for ext in ["igod.gov.in", "india.gov.in", "nic.in"]):
        return True

    # 3. PAN-INDIA STATE WHITELIST (28 States + 8 UTs)
    STATE_DOMAINS = {
        "andhra pradesh": ["ap.gov.in", "aponline.gov.in", "vija.cdma.ap.gov.in"],
        "arunachal pradesh": ["arunachal.gov.in", "arunachalpradesh.gov.in"],
        "assam": ["assam.gov.in", "gmc.assam.gov.in", "pwdroads.assam.gov.in"],
        "bihar": ["bihar.gov.in", "state.bihar.gov.in"],
        "chhattisgarh": ["cg.gov.in", "chhattisgarh.gov.in", "cgstate.gov.in"],
        "goa": ["goa.gov.in"],
        "gujarat": ["gujarat.gov.in", "ahmedabadcity.gov.in", "suratmunicipal.gov.in", "vmc.gov.in"],
        "haryana": ["haryana.gov.in", "ulbharyana.gov.in", "mcg.gov.in", "fmda.haryana.gov.in"],
        "himachal pradesh": ["hp.gov.in", "hppwd.gov.in", "himachal.gov.in"],
        "jharkhand": ["jharkhand.gov.in"],
        "karnataka": ["karnataka.gov.in", "ka.gov.in", "bbmp.gov.in", "kpwd.karnataka.gov.in"],
        "kerala": ["kerala.gov.in", "lsgkerala.gov.in", "malappuram"],
        "madhya pradesh": ["mp.gov.in", "mpurban.gov.in", "mppwd.gov.in"],
        "maharashtra": ["maharashtra.gov.in", "mh.gov.in", "mcgm.gov.in", "bmc.gov.in", "pmc.gov.in", "pcmcindia.gov.in"],
        "manipur": ["manipur.gov.in"],
        "meghalaya": ["meghalaya.gov.in"],
        "mizoram": ["mizoram.gov.in"],
        "nagaland": ["nagaland.gov.in"],
        "odisha": ["odisha.gov.in", "bmc.gov.in", "worksodisha.gov.in"],
        "punjab": ["punjab.gov.in", "mcludhiana.gov.in"],
        "rajasthan": ["rajasthan.gov.in", "sugampath.rajasthan.gov.in"],
        "sikkim": ["sikkim.gov.in"],
        "tamil nadu": ["tn.gov.in", "chennaicorporation.gov.in", "tntcp.tn.gov.in"],
        "telangana": ["telangana.gov.in", "ghmc.gov.in", "gwmc.gov.in"],
        "tripura": ["tripura.gov.in"],
        "uttar pradesh": ["up.gov.in", "uppwd.gov.in", "lmc.up.nic.in", "nnvns.up.nic.in"],
        "uttarakhand": ["uk.gov.in", "uttarakhand.gov.in", "pwd.uk.gov.in"],
        "west bengal": ["wb.gov.in", "kmcgov.in", "kolkata.gov.in", "nkda.gov.in", "wbpwd.gov.in", "udma.wb.gov.in"],
        "andaman and nicobar islands": ["andaman.gov.in"],
        "chandigarh": ["chandigarh.gov.in", "mcchandigarh.gov.in"],
        "dadra and nagar haveli and daman and diu": ["dnh.gov.in", "daman.nic.in", "ddd.gov.in"],
        "delhi": ["delhi.gov.in", "ndmc.gov.in", "mcdonline.nic.in", "pwddelhi.gov.in"],
        "jammu and kashmir": ["jk.gov.in", "pwdrb.jk.gov.in", "jmc.nic.in", "smcsrinagar.in"],
        "ladakh": ["ladakh.gov.in"],
        "lakshadweep": ["lakshadweep.gov.in"],
        "puducherry": ["py.gov.in", "puducherry.gov.in"]
    }

    allowed_domains = STATE_DOMAINS.get(target_state_lower, [])
    
    # 4. DYNAMIC FALLBACK
    if not allowed_domains:
        safe_state_str = target_state_lower.replace(" ", "")
        allowed_domains = [f"{safe_state_str}.gov.in", f"{safe_state_str}.nic.in"]

    # 5. EXECUTE THE WHITELIST
    for domain in allowed_domains:
        if domain in netloc:
            return True

    logger.warning(f"🚫 GEOFENCE BLOCK: {url} is not an authorized domain for {target_state_lower}")
    return False

# ---------------------------------------------------------
# PLAYWRIGHT MANAGER
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
                ignore_https_errors=True  
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
# AI MODELS (70B ENTITY DEDUCTION + 8B ROUTING)
# ---------------------------------------------------------
class SearchQueries(BaseModel):
    administrative_body: str = Field(description="The explicitly deduced government entity (e.g., 'New Town Kolkata Development Authority', 'Bruhat Bengaluru Mahanagara Palike', 'Public Works Department'). If unknown, use the District name.")
    queries: List[str] = Field(description="Top 2 precise search engine queries targeting this specific body.")

class LinkSelection(BaseModel):
    selected_urls: List[str] = Field(description="Top 3 URLs to explore next.")

class OfficialContact(BaseModel):
    officialDesignation: str = Field(description="Exact job title")
    officialName: Optional[str] = Field(default="Concerned Authority")
    officialEmail: Optional[str] = None
    phone: Optional[str] = None
    confidenceScore: float = 0.0

class ContactExtractionResult(BaseModel):
    contacts: List[OfficialContact] = Field(description="List of extracted contacts.")

# ---------------------------------------------------------
# 70B: ENTITY DEDUCTION & SEARCH GENERATION
# ---------------------------------------------------------
async def _deduce_entity_and_generate_queries(jurisdiction: Dict[str, str], category: str) -> Dict[str, Any]:
    """
    🚨 THE UPGRADE: Uses the LLM to expand the raw location into the exact Governing Entity.
    """
    llm = get_llm()  
    structured_llm = llm.with_structured_output(SearchQueries)
    clean_cat = category.split(',')[0].strip().upper() if category else "GENERAL"
    
    ward = jurisdiction.get("ward", "")
    muni = jurisdiction.get("municipality", "")
    dist = jurisdiction.get("district", "")
    state = jurisdiction.get("state", "")

    prompt = PromptTemplate.from_template("""
    You are an expert Indian Government OSINT researcher.
    
    TARGET CATEGORY: {clean_cat}
    LOCATION: Ward {ward}, {muni}, {dist} District, {state}, India.

    STEP 1: Deduce the exact administrative body responsible for this issue in this specific location.
    - If it's a major city, it's usually the Municipal Corporation (e.g., KMC, BBMP, BMC).
    - If it's a planned township, it's a Development Authority (e.g., NKDA for New Town, DDA for Delhi).
    - If it's rural roads, it's the State PWD.
    
    STEP 2: Generate 2 precise search queries to find the official contact directory for THAT SPECIFIC BODY.
    CRITICAL: EVERY query MUST end with the word "{state}" to prevent out-of-state hallucinations.
    """)
    
    try:
        res = await structured_llm.ainvoke(prompt.format(clean_cat=clean_cat, ward=ward, muni=muni, dist=dist, state=state))
        return {"body": res.administrative_body, "queries": res.queries}
    except Exception:
        safe_loc = muni if muni else dist
        return {"body": f"{safe_loc} Administration", "queries": [f"{safe_loc} {clean_cat} official website {state}"]}

# ---------------------------------------------------------
# SEARCH ENGINE (DuckDuckGo)
# ---------------------------------------------------------
async def _dynamic_url_discovery(query: str, target_state: str) -> List[str]:
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
                            if any(ext in href for ext in ['.gov.in', '.nic.in', '.co.in']) and 'duckduckgo' not in href:
                                if _is_valid_geofenced_url(href, target_state):
                                    urls.append(href)
    except Exception as e:
        logger.warning(f"Dynamic search failed: {e}")
    return list(dict.fromkeys(urls))[:5] 

# ---------------------------------------------------------
# 70B: URL SELECTION
# ---------------------------------------------------------
async def _ai_select_starting_urls(search_urls: List[str], target_desc: str, state: str) -> List[str]:
    if not search_urls: return []
    filtered = [url for url in search_urls if not url.endswith(('.pdf', '.doc', '.xls', '.zip', '.xlsx'))]
    if not filtered: return []

    llm = get_llm() 
    structured_llm = llm.with_structured_output(LinkSelection)
    urls_text = "\n".join(filtered[:10])
    
    prompt = PromptTemplate.from_template("""
    You are an OSINT agent. The target is a contact directory for: {target_desc} in {state}.
    From these URLs, select up to 3 that are most likely to contain a **direct** list of officials.
    IMPORTANT: Do NOT select language‑selection pages, login portals, or homepage splash screens.
    URLs:
    {urls}
    """)
    try:
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, state=state, urls=urls_text))
        return result.selected_urls[:3]
    except Exception:
        return [u for u in filtered if '.gov.in' in u or '.nic.in' in u][:3]

async def _ai_generate_candidate_urls(entity: str, state: str) -> List[str]:
    llm = get_llm() 
    prompt = f"""You are an expert on Indian government websites.
    Entity: '{entity}'. State: {state}.
    Suggest up to 3 likely official web page URLs that would contain a contact directory for this entity.
    Prefer .gov.in or .nic.in. Return ONLY the full URLs, one per line.
    """
    try:
        resp = await llm.ainvoke(prompt)
        urls = re.findall(r'https?://[^\s]+', resp.content)
        return [u for u in urls if _is_valid_geofenced_url(u, state)][:3]
    except Exception:
        return []

# ---------------------------------------------------------
# 8B (FAST): Internal link routing
# ---------------------------------------------------------
async def _ai_select_next_links(links: List[Dict[str, str]], target_desc: str) -> List[str]:
    if not links: return []
    links = links[:40] 
    llm = get_fast_llm() 
    try:
        structured_llm = llm.with_structured_output(LinkSelection)
        unique_links = {l['href']: l['text'] for l in links}
        links_text = "\n".join([f"- {text}: {href}" for href, text in unique_links.items()])

        prompt = PromptTemplate.from_template("""
    You are an OSINT spider. Find the directory for: {target_desc}.
    From these internal links, choose up to 3 that most likely lead to the department's personnel or contact page.
    LINKS:
    {links}
    """)
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, links=links_text))
        return result.selected_urls
    except Exception:
        keywords = ['contact', 'who', 'direct', 'depart', 'admin', 'directory']
        return [l['href'] for l in links if any(kw in l['href'].lower() for kw in keywords)][:3]

# ---------------------------------------------------------
# 70B: Extract contacts from page text
# ---------------------------------------------------------
async def _ai_extract_all_contacts(sniper_text: str, target_desc: str, target_state: str) -> List[Dict[str, Any]]:
    llm = get_llm() 
    structured_llm = llm.with_structured_output(ContactExtractionResult)

    prompt = PromptTemplate.from_template("""
    You are an OSINT extraction agent. Extract every real government official from this text.
    Target: '{target_desc}' in '{target_state}'.
    
    Scoring:
    - If the person exactly matches the target role and organization, confidence = 0.9-1.0.
    - If the person is related, confidence = 0.7-0.8.
    - 🚨 CRITICAL: If the email belongs to a different state, confidence = 0.0.

    Decode obfuscated emails like [at] nic [dot] in.
    TEXT:
    {text}
    """)
    try:
        result = await structured_llm.ainvoke(prompt.format(target_desc=target_desc, target_state=target_state, text=sniper_text[:6000]))
        return [c.model_dump() for c in result.contacts
                if c.officialEmail and c.officialEmail.lower() != "null"]
    except Exception as e:
        logger.error(f"70B extraction failed: {e}")
        return []

# ---------------------------------------------------------
# SMTP VERIFICATION 
# ---------------------------------------------------------
async def _verify_smtp_async(email: str) -> str:
    def sync_smtp_check() -> str:
        try:
            domain = email.split("@")[1]
            try:
                mx_records = dns.resolver.resolve(domain, "MX")
                if not mx_records: return "FAILED"
            except Exception: return "FAILED"
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
    jurisdiction = state.get("jurisdiction_hierarchy") or {}
    record_id = jurisdiction.get("id")
    
    district = (jurisdiction.get("district") or "").strip().lower()
    state_code = (jurisdiction.get("state") or "").strip().lower()
    target_category = jurisdiction.get("issueCategory") or "General Administration"
    target_designation = jurisdiction.get("officialDesignation") or "Official"
    
    current_retry = state.get("retry_count", 0)

    if not record_id or not state_code:
        return {"current_status": "AWAITING_REVIEW", "error_log": [{"action": "missing_jurisdiction_state"}]}

    with tracer.start_as_current_span("contact_discovery_node"):
        try:
            if not prisma.is_connected():
                await prisma.connect()

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

            # 🚨 1. ENTITY DEDUCTION: LLM expands the location into the exact Governing Body
            logger.info(f"🧠 70B: Deducing Administrative Entity for {target_category} in {jurisdiction}...")
            deduction_data = await _deduce_entity_and_generate_queries(jurisdiction, target_category)
            admin_body = deduction_data.get("body", district)
            queries = deduction_data.get("queries", [])
            
            # Enriched target description for the Spider & Extractor
            target_desc = f"{target_designation} for {target_category} at {admin_body} ({state_code})"
            logger.info(f"🎯 Enriched Target: {target_desc}")
            logger.info(f"🔍 Queries: {queries}")

            raw_search_urls = []
            for q in queries:
                urls = await _dynamic_url_discovery(q, state_code)
                raw_search_urls.extend(urls)
            raw_search_urls = list(dict.fromkeys(raw_search_urls)) 

            if raw_search_urls:
                frontier = await _ai_select_starting_urls(raw_search_urls, target_desc, state_code)
            else:
                logger.warning("No search results. 🧠 70B: Generating candidate URLs...")
                frontier = await _ai_generate_candidate_urls(admin_body, state_code)

            if not frontier:
                logger.error("❌ Completely unable to discover URLs. Cannot proceed.")
                new_seeder_count = state.get("seeder_retry_count", 0) + 1
                return {
                    "current_status": "SEEDER_RETRY", 
                    "seeder_retry_count": new_seeder_count,
                    "error_log": [{"action": "no_urls_available"}]
                }

            logger.info(f"🕷️ Starting spider on {len(frontier)} seed URLs...")
            context = await PlaywrightManager.get_context()
            visited: set = set()
            all_found_contacts = []
            max_pages = 15 
            pages_crawled = 0

            while frontier and pages_crawled < max_pages:
                current_url = frontier.pop(0)
                if current_url in visited: continue
                if not _is_valid_geofenced_url(current_url, state_code): continue
                    
                visited.add(current_url)
                pages_crawled += 1
                logger.info(f"   [{pages_crawled}/{max_pages}] Scanning: {current_url}")

                page = await context.new_page()
                try:
                    if current_url.split('?')[0].split('.')[-1].lower() in ('pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip'):
                        continue
                        
                    try:
                        await page.goto(current_url, wait_until="domcontentloaded", timeout=45000) 
                    except Exception as e:
                        logger.warning(f"   ⏳ Page Load Timeout/Error on {current_url}: {str(e)[:50]}")
                        continue
                        
                    await asyncio.sleep(2) 
                    page_text = await page.evaluate("""() => {
                        const root = document.body || document.documentElement;
                        return root ? root.innerText.replace(/\\s+/g, ' ').trim() : '';
                    }""")
                    
                    obf_pattern = r"(?i)[A-Za-z0-9._%+-]+\s*(?:@|\[at\]|\(at\)|\{at\}|\s+at\s+)\s*[A-Za-z0-9.-]+\s*(?:\.|\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*[A-Za-z]{2,7}"
                    raw_emails = re.findall(obf_pattern, page_text)
                    
                    if raw_emails:
                        logger.info(f"     Found {len(raw_emails)} raw emails. Extracting with 70B...")
                        sniper_text = ""
                        for match in re.finditer(obf_pattern, page_text):
                            start = max(0, match.start() - 250)
                            end = min(len(page_text), match.end() + 250)
                            sniper_text += page_text[start:end] + "\n...[SNIP]...\n"
                            
                        contacts = await _ai_extract_all_contacts(sniper_text[:6000], target_desc, state_code)
                        for c in contacts:
                            if c.get("confidenceScore", 0.0) >= 0.20:
                                c["source_url"] = current_url
                                all_found_contacts.append(c)
                                logger.info(f"     Added: {c.get('officialName')} ({c.get('confidenceScore')})")
                    else:
                        logger.info("     No emails found on this page. Routing internally...")

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
                                if _is_valid_geofenced_url(link, state_code):
                                    frontier.append(link)
                except Exception as e:
                    logger.warning(f"     Spider logic error on {current_url}: {e}")
                finally:
                    await page.close()

            if not all_found_contacts:
                new_seeder_count = state.get("seeder_retry_count", 0) + 1
                return {
                    "current_status": "SEEDER_RETRY", 
                    "seeder_retry_count": new_seeder_count,
                    "error_log": [{"action": "spider_exhausted_no_target_found"}],
                    "discovered_contacts": []
                }

            primary = max(all_found_contacts, key=lambda x: x.get("confidenceScore", 0.0))
            logger.info(f"🏆 Best match: {primary.get('officialName')} (Score: {primary.get('confidenceScore')})")
            
            if primary.get("confidenceScore", 0.0) < 0.70:
                logger.warning(f"   ⚠️ Confidence too low ({primary.get('confidenceScore')}). Retrying Seeder.")
                new_seeder_count = state.get("seeder_retry_count", 0) + 1
                return {
                    "current_status": "SEEDER_RETRY",
                    "seeder_retry_count": new_seeder_count,
                    "discovered_contacts": all_found_contacts,
                    "error_log": [{"action": "low_confidence_score", "best_score": primary.get("confidenceScore")}]
                }

            primary["verification_status"] = await _verify_smtp_async(primary["officialEmail"])
            
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
            return {
                "current_status": "FAILED",
                "seeder_retry_count": current_retry + 1, 
                "error_log": [{"action": "spider_crash", "details": str(e)}]
            }
        finally:
            if 'context' in locals() and context:
                await context.close()

async def shutdown_contact_discovery():
    await PlaywrightManager.close()