import requests
import json

API_KEY = "AIzaSyAZ_oGVhcLdZ7x1FUyU_LRFNQENuBRgTro"
PROJECT = "shemesh-test"
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

def firestore_list(path, page_size=300):
    results = []
    params = {"key": API_KEY, "pageSize": page_size}
    url = f"{BASE_URL}/{path}"
    while True:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        docs = data.get("documents", [])
        results.extend(docs)
        token = data.get("nextPageToken")
        if not token:
            break
        params["pageToken"] = token
    return results

print("Fetching tractate list from Firestore...")
try:
    tractate_docs = firestore_list("tractates")
    bavli = [t for t in tractate_docs if t["name"].split("/")[-1].endswith("_b")]
    print(f"\nTotal Bavli tractates in Firestore: {len(bavli)}")
    for t in sorted(bavli, key=lambda x: x["name"]):
        fields = t.get("fields", {})
        name = fields.get("name", {}).get("stringValue", "?")
        pages = fields.get("total_pages_in_tractate", {}).get("integerValue", "?")
        print(f"  {name}: {pages} pages")
except Exception as e:
    print(f"Error: {e}")
