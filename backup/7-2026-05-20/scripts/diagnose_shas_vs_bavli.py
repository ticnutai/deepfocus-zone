"""
diagnose_shas_vs_bavli.py
מנתח את ההבדלים בין עץ "ש"ס" לעץ "תלמוד בבלי" בסופאבייס.
"""
import sys, requests
sys.stdout.reconfigure(encoding='utf-8')

URL = "https://htsuoqvafayyffyxjhhh.supabase.co"
KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
       "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
       "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
       "Go7jVgobNsv7Fan0LIXxQ")

# ── Auth ──
r = requests.post(f"{URL}/auth/v1/token?grant_type=password",
                  json={"email": "jj1212t@gmail.com", "password": "543211"},
                  headers={"apikey": KEY})
tok = r.json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "apikey": KEY, "Content-Type": "application/json"}

# ── Fetch all categories and cards ──
def fetch_all(endpoint, params=None):
    rows = []
    offset = 0
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

print("טוען קטגוריות...")
cats = fetch_all("categories", {"select": "id,name,parent_id,sort_order"})
print(f"  סה\"כ קטגוריות: {len(cats)}")

print("טוען כרטיסים...")
cards = fetch_all("cards", {"select": "id,question,tags"})
print(f"  סה\"כ כרטיסים: {len(cards)}")

by_id   = {c["id"]: c for c in cats}
by_name = {}
for c in cats:
    by_name.setdefault(c["name"], []).append(c)

def subtree_ids(root_id):
    """Return set of all category IDs in subtree (including root)."""
    result = set()
    stack = [root_id]
    while stack:
        pid = stack.pop()
        result.add(pid)
        for c in cats:
            if c.get("parent_id") == pid:
                stack.append(c["id"])
    return result

def subtree_names(root_id):
    ids = subtree_ids(root_id)
    return {by_id[i]["name"] for i in ids}

def children_of(parent_id, depth=0):
    kids = sorted(
        [c for c in cats if c.get("parent_id") == parent_id],
        key=lambda c: (c.get("sort_order") or 0, c["name"])
    )
    for k in kids[:20]:  # limit output
        print("  " * (depth+1) + k["name"])
        children_of(k["id"], depth+1)
    if len(kids) > 20:
        print("  " * (depth+1) + f"... ({len(kids)-20} עוד)")

# ── Find root categories ──
shas_roots   = [c for c in cats if not c.get("parent_id") and 'ש"ס' in c["name"]]
bavli_roots  = [c for c in cats if not c.get("parent_id") and "תלמוד בבלי" in c["name"]]
all_roots    = [c for c in cats if not c.get("parent_id")]

print(f"\n=== כל קטגוריות שורש ===")
for c in sorted(all_roots, key=lambda c: c["name"]):
    print(f"  {c['name']!r:40} id={c['id'][:8]}")

print(f"\n=== עץ ש\"ס ===")
if shas_roots:
    sr = shas_roots[0]
    print(f"  root: {sr['name']!r} id={sr['id'][:8]}")
    children_of(sr["id"])
    shas_names = subtree_names(sr["id"])
    print(f"  סה\"כ שמות קטגוריות בעץ: {len(shas_names)}")
else:
    shas_names = set()
    print("  לא נמצא!")

print(f"\n=== עץ תלמוד בבלי ===")
if bavli_roots:
    br = bavli_roots[0]
    print(f"  root: {br['name']!r} id={br['id'][:8]}")
    children_of(br["id"])
    bavli_names = subtree_names(br["id"])
    print(f"  סה\"כ שמות קטגוריות בעץ: {len(bavli_names)}")
else:
    bavli_names = set()
    print("  לא נמצא!")

# ── Check overlapping names ──
overlap_names = shas_names & bavli_names
print(f"\n=== שמות קטגוריות ששייכים לשני העצים ({len(overlap_names)}) ===")
for n in sorted(overlap_names)[:40]:
    print(f"  {n!r}")
if len(overlap_names) > 40:
    print(f"  ... ({len(overlap_names)-40} עוד)")

# ── Cards in each tree ──
def card_ids_in_tree(tree_names):
    ids = set()
    for card in cards:
        tags = card.get("tags") or []
        for t in tags:
            if t.startswith("cat:") and t[4:] in tree_names:
                ids.add(card["id"])
                break
    return ids

shas_card_ids  = card_ids_in_tree(shas_names)
bavli_card_ids = card_ids_in_tree(bavli_names)
overlap_cards  = shas_card_ids & bavli_card_ids

print(f"\n=== כרטיסים ===")
print(f"  ש\"ס בלבד:        {len(shas_card_ids - bavli_card_ids)}")
print(f"  תלמוד בבלי בלבד: {len(bavli_card_ids - shas_card_ids)}")
print(f"  בשניהם (כפילות): {len(overlap_cards)}")
print(f"  ללא שום עץ:       {len(set(c['id'] for c in cards) - shas_card_ids - bavli_card_ids)}")

if overlap_cards:
    print(f"\n=== דוגמאות כרטיסים כפולים (עד 5) ===")
    for cid in list(overlap_cards)[:5]:
        card = next(c for c in cards if c["id"] == cid)
        print(f"  q: {card['question'][:80]!r}")
        print(f"  tags: {card['tags']}")
        print()

# ── Check if any masechet name appears in BOTH trees as a DIFFERENT category ──
print(f"\n=== קטגוריות עם אותו שם בשני עצים שונים ===")
for name in sorted(overlap_names):
    instances = by_name.get(name, [])
    roots_for_instances = set()
    for inst in instances:
        # trace back to root
        pid = inst.get("parent_id")
        while pid and pid in by_id:
            parent = by_id[pid]
            if not parent.get("parent_id"):
                roots_for_instances.add(parent["name"])
                break
            pid = parent.get("parent_id")
        else:
            roots_for_instances.add("(root)")
    if len(roots_for_instances) > 1:
        print(f"  {name!r}: נמצא תחת {roots_for_instances}")
