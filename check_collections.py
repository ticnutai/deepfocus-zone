import requests
import json

API_KEY = "AIzaSyAZ_oGVhcLdZ7x1FUyU_LRFNQENuBRgTro"
PROJECT = "shemesh-test"
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

# Try to list root-level collections using collectionGroup
# Try a few known/possible collection names
collections_to_try = [
    "tractates",
    "hebrew_strings", 
    "masechot",
    "questions",
    "seder_moed",
    "seder_nashim",
    "seder_nezikin",
    "massechtot",
]

for col in collections_to_try:
    try:
        params = {"key": API_KEY, "pageSize": 1}
        resp = requests.get(f"{BASE_URL}/{col}", params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            count = len(data.get("documents", []))
            has_more = "nextPageToken" in data
            print(f"  ✅ {col}: found (docs in first page: {count}, has_more: {has_more})")
        elif resp.status_code == 404:
            print(f"  ❌ {col}: not found")
        else:
            print(f"  ⚠️ {col}: status {resp.status_code}")
    except Exception as e:
        print(f"  ❌ {col}: error {e}")

# Also check how many hebrew_strings there are
print()
print("Counting hebrew_strings documents...")
params = {"key": API_KEY, "pageSize": 300}
url = f"{BASE_URL}/hebrew_strings"
total = 0
page_count = 0
while True:
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    docs = data.get("documents", [])
    total += len(docs)
    page_count += 1
    if page_count == 1:
        # Show first 10 doc IDs
        for doc in docs[:10]:
            print(f"  {doc['name'].split('/')[-1]}")
        print(f"  ... ({len(docs)} in first page)")
    token = data.get("nextPageToken")
    if not token:
        break
    params["pageToken"] = token
print(f"Total hebrew_strings: {total}")
