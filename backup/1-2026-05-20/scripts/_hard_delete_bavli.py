"""
_hard_delete_bavli.py
מוחק לגמרי (hard delete) את שורש תלמוד בבלי וכל הצאצאים שלו מה-DB.
רק מחיקה — לא מגע בכרטיסים (הכרטיסים כבר עודכנו ל-cat:ש"ס).
"""
import sys, requests
sys.stdout.reconfigure(encoding='utf-8')

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

BAVLI_ROOT = "7a0151f6-27e0-4919-8927-f4f2e4708045"

print("Logging in...")
r = requests.post(URL+"/auth/v1/token?grant_type=password",
    headers={"apikey": ANON, "Content-Type": "application/json"},
    json={"email": "jj1212t@gmail.com", "password": "543211"})
r.raise_for_status()
tok = r.json()["access_token"]
uid = r.json()["user"]["id"]
print(f"Logged in as {uid}")

H_read = {"Authorization": f"Bearer {tok}", "apikey": ANON}
H_del  = {"Authorization": f"Bearer {tok}", "apikey": ANON, "Prefer": "return=minimal"}

# Load ALL categories (including soft-deleted) for this user
print("\nLoading all categories (incl. soft-deleted)...")
all_cats = []
offset = 0
while True:
    r2 = requests.get(
        URL+f"/rest/v1/categories?user_id=eq.{uid}&select=id,name,parent_id,deleted_at"
            f"&limit=1000&offset={offset}",
        headers=H_read)
    r2.raise_for_status()
    rows = r2.json()
    all_cats.extend(rows)
    if len(rows) < 1000:
        break
    offset += 1000

print(f"Total categories (all): {len(all_cats)}")

# Build subtree of BAVLI_ROOT (BFS), including soft-deleted
by_parent = {}
for c in all_cats:
    pid = c.get("parent_id")
    if pid:
        by_parent.setdefault(pid, []).append(c["id"])

def subtree_ids(root_id):
    """All IDs in subtree rooted at root_id (including root)."""
    result = []
    stack = [root_id]
    while stack:
        pid = stack.pop()
        result.append(pid)
        for child_id in by_parent.get(pid, []):
            stack.append(child_id)
    return result

ids_to_delete = subtree_ids(BAVLI_ROOT)
print(f"\nCategories to hard-delete (subtree of תלמוד בבלי): {len(ids_to_delete)}")

# Show what we're about to delete
id_map = {c["id"]: c for c in all_cats}
for cid in ids_to_delete:
    cat = id_map.get(cid, {})
    deleted = "🗑 soft-deleted" if cat.get("deleted_at") else "⚠️  active"
    print(f"  {cat.get('name', '?'):25}  {deleted}  ({cid[:8]}...)")

confirm = input(f"\nמאשר מחיקת {len(ids_to_delete)} קטגוריות? (y/n): ").strip().lower()
if confirm != "y":
    print("בוטל.")
    sys.exit(0)

# Hard delete — children first (reverse BFS = delete deepest first)
# ids_to_delete is BFS order (root first), so reverse = leaves first
deleted_count = 0
errors = 0

for cid in reversed(ids_to_delete):
    resp = requests.delete(
        URL+f"/rest/v1/categories?id=eq.{cid}",
        headers=H_del,
        timeout=20)
    if resp.ok:
        cat = id_map.get(cid, {})
        print(f"  ✅ deleted {cat.get('name', '?')} ({cid[:8]}...)")
        deleted_count += 1
    else:
        print(f"  ❌ FAILED {cid[:8]}...: {resp.status_code} {resp.text[:100]}")
        errors += 1

print(f"\n✅ Hard-deleted: {deleted_count}")
print(f"❌ Errors:       {errors}")
print("\n=== DONE ===")
