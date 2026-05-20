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

print("Fetching ALL tractates from Firestore...")
tractate_docs = firestore_list("tractates")
print(f"Total documents in tractates collection: {len(tractate_docs)}")
print()

# Show ALL of them, sorted
for t in sorted(tractate_docs, key=lambda x: x["name"]):
    doc_id = t["name"].split("/")[-1]
    fields = t.get("fields", {})
    name = fields.get("name", {}).get("stringValue", "?")
    pages = fields.get("total_pages_in_tractate", {}).get("integerValue", "?")
    print(f"  {doc_id}: name={name}, pages={pages}")
