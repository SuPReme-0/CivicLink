import requests
import json
import os
from dotenv import load_dotenv

# Load the API key directly from your .env file
load_dotenv()
API_KEY = os.getenv("FRONTEND_API_KEY", "dev-key-12345") # Fallback just in case

BASE_URL = "http://127.0.0.1:8000"
HEADERS = {
    "X-Frontend-API-Key": API_KEY,
    "Content-Type": "application/json"
}

def print_result(name, res):
    if res.status_code == 200:
        print(f"✅ {name}: OK ({res.status_code})")
        # Print a snippet of the JSON so we can see it's working
        try:
            data = res.json()
            print(f"   Response: {str(data)[:100]}...")
        except:
            print(f"   Response: {res.text}")
    else:
        print(f"❌ {name}: FAILED ({res.status_code})")
        print(f"   Error: {res.text}")
    print("-" * 50)

print("\n🚀 Initiating CivicLink API Diagnostics...\n")

# 1. Test Root
res = requests.get(f"{BASE_URL}/")
print_result("Root Endpoint", res)

# 2. Test Liveness (Health)
res = requests.get(f"{BASE_URL}/health")
print_result("Liveness Probe (/health)", res)

# 3. Test Readiness (DB & Rate Limiter Check)
res = requests.get(f"{BASE_URL}/ready")
print_result("Readiness Probe (/ready)", res)

# 4. Test Protected Admin Route
res = requests.get(f"{BASE_URL}/api/v1/admin/dashboard-stats", headers=HEADERS)
print_result("Protected Admin Route (/dashboard-stats)", res)

# 5. Test Mock Ingestion (Does LangGraph accept the payload?)
mock_payload = {
    "phone_number": "+919876543210",
    "thread_id": "test-thread-001",
    "text_message": "There is a massive pothole in Sector 5.",
    "location": {"type": "gps", "lat": 22.5726, "lng": 88.3639}
}
res = requests.post(f"{BASE_URL}/api/v1/ingest", headers=HEADERS, json=mock_payload)
print_result("Ingestion Endpoint (/ingest)", res)

print("✨ Diagnostics Complete.\n")