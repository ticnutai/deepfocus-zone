"""
delete_bavli_tree.py
מוחק את עץ "תלמוד בבלי" (1,142 קטגוריות) - עלים לפני שורשים.
הכרטיסים לא נמחקים - הם ממשיכים לעבוד דרך עץ ש"ס.
"""
import sys, requests
sys.stdout.reconfigure(encoding='utf-8')

URL = "https://htsuoqvafayyffyxjhhh.supabase.co"
KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
       "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
       "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
       "Go7jVgobNsv7Fan0LIXxQ")

r = requests.post(f"{URL}/auth/v1/token?grant_type=password",
                  json={"email": "jj1212t@gmail.com", "password": "543211"},
                  headers={"apikey": KEY})
tok = r.json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "apikey": KEY, "Content-Type": "application/json",
     "Prefer": "return=minimal"}

def fetch_all(endpoint, params=None):
    rows, offset = [], 0
    while True:
        p = {"limit": "1000", "offset": str(offset), **(params or {})}
        res = requests.get(f"{URL}/rest/v1/{endpoint}", headers=H, params=p).json()
        if not isinstance(res, list) or not res:
            break
        rows += res
        if len(res) < 1000:
            break
        offset += 1000
    return rows

print("Loading categories...")
cats = fetch_all("categories", {"select": "id,name,parent_id"})
by_id = {c["id"]: c for c in cats}
children_map = {}
for c in cats:
    pid = c.get("parent_id")
    if pid:
        children_map.setdefault(pid, []).append(c["id"])

# Find root
bavli_root = next((c for c in cats if not c.get("parent_id") and "\u05ea\u05dc\u05de\u05d5\u05d3 \u05d1\u05d1\u05dc\u05d9" in c["name"]), None)
if not bavli_root:
    print("ERROR: Could not find root!")
    sys.exit(1)

print(f"Found root: {bavli_root['name']} [{bavli_root['id'][:8]}]")

# Collect all IDs in subtree using BFS
all_ids = []
queue = [bavli_root["id"]]
while queue:
    pid = queue.pop(0)
    all_ids.append(pid)
    for cid in children_map.get(pid, []):
        queue.append(cid)

print(f"Total categories to delete: {len(all_ids)}")

# Delete in reverse BFS order (leaves first)
to_delete = list(reversed(all_ids))

# Delete in batches of 100
BATCH = 100
deleted = 0
for i in range(0, len(to_delete), BATCH):
    batch = to_delete[i:i+BATCH]
    ids_str = ",".join(f'"{x}"' for x in batch)
    res = requests.delete(
        f"{URL}/rest/v1/categories",
        headers=H,
        params={"id": f"in.({','.join(batch)})"}
    )
    if res.status_code not in (200, 204):
        print(f"ERROR at batch {i//BATCH}: {res.status_code} {res.text[:200]}")
        sys.exit(1)
    deleted += len(batch)
    print(f"  Deleted {deleted}/{len(to_delete)}...")

print(f"\nDone! Deleted {deleted} categories.")
print("Cards are untouched - they remain tagged and visible via the ש\"ס tree.")
