import requests

API_KEY = "AIzaSyAZ_oGVhcLdZ7x1FUyU_LRFNQENuBRgTro"
PROJECT = "shemesh-test"
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

# Get all hebrew_strings doc IDs to find unique tractates
print("Getting all hebrew_strings document IDs...")
params = {"key": API_KEY, "pageSize": 300, "mask.fieldPaths": "name"}
url = f"{BASE_URL}/hebrew_strings"
total = 0
tractates = set()

while True:
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    docs = data.get("documents", [])
    for doc in docs:
        doc_id = doc["name"].split("/")[-1]
        # doc_id format: tractate_name_b_PAGE or tractate_name_y_PAGE
        # Find the suffix pattern (_b_ or _y_)
        for suffix in ["_b_", "_y_"]:
            idx = doc_id.rfind(suffix)
            if idx != -1:
                # Get everything up to the last _b_ or _y_
                tractate = doc_id[:idx]
                suffix_type = suffix.strip("_")
                tractates.add(f"{tractate}_{suffix_type}")
                break
    total += len(docs)
    token = data.get("nextPageToken")
    if not token:
        break
    params["pageToken"] = token

print(f"\nTotal hebrew_strings docs: {total}")
print(f"Unique tractates found: {len(tractates)}")
print("\nAll tractates:")
for t in sorted(tractates):
    print(f"  {t}")
