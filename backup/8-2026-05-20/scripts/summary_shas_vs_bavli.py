"""
summary_shas_vs_bavli.py - outputs only the key numbers (ASCII safe)
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
H = {"Authorization": f"Bearer {tok}", "apikey": KEY}

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

cats  = fetch_all("categories", {"select": "id,name,parent_id,sort_order"})
cards = fetch_all("cards",      {"select": "id,tags"})
by_id = {c["id"]: c for c in cats}

def subtree_names(root_id):
    result = set()
    stack = [root_id]
    while stack:
        pid = stack.pop()
        result.add(by_id[pid]["name"])
        for c in cats:
            if c.get("parent_id") == pid:
                stack.append(c["id"])
    return result

def subtree_ids(root_id):
    result = set()
    stack = [root_id]
    while stack:
        pid = stack.pop()
        result.add(pid)
        for c in cats:
            if c.get("parent_id") == pid:
                stack.append(c["id"])
    return result

def children(parent_id):
    return [c for c in cats if c.get("parent_id") == parent_id]

# roots
all_roots = [c for c in cats if not c.get("parent_id")]
print("=== ROOT CATEGORIES ===")
for c in sorted(all_roots, key=lambda x: x["name"]):
    ch = children(c["id"])
    print(f"  [{c['id'][:8]}] {c['name']}  (direct children: {len(ch)})")

shas_root  = next((c for c in all_roots if '\u05e9"\u05e1' in c["name"]), None)
bavli_root = next((c for c in all_roots if "\u05ea\u05dc\u05de\u05d5\u05d3 \u05d1\u05d1\u05dc\u05d9" in c["name"]), None)

print()
if shas_root:
    shas_names = subtree_names(shas_root["id"])
    shas_ids   = subtree_ids(shas_root["id"])
    shas_depth2 = children(shas_root["id"])
    print(f'=== SHAS TREE ===')
    print(f'  root id: {shas_root["id"][:8]}')
    print(f'  total categories in subtree: {len(shas_names)}')
    print(f'  direct children (sedarim?): {[c["name"] for c in shas_depth2[:10]]}')
    shas_depth3 = []
    for s in shas_depth2:
        shas_depth3 += children(s["id"])
    print(f'  level 3 (masechtos?): {[c["name"] for c in shas_depth3[:10]]}')
    shas_depth4 = []
    for m in shas_depth3[:3]:
        shas_depth4 += children(m["id"])
    print(f'  level 4 (dapim sample): {[c["name"] for c in shas_depth4[:5]]}')
else:
    shas_names = set()
    print('SHAS ROOT NOT FOUND')

print()
if bavli_root:
    bavli_names = subtree_names(bavli_root["id"])
    bavli_ids   = subtree_ids(bavli_root["id"])
    bavli_depth2 = children(bavli_root["id"])
    print(f'=== BAVLI TREE ===')
    print(f'  root id: {bavli_root["id"][:8]}')
    print(f'  total categories in subtree: {len(bavli_names)}')
    print(f'  direct children (masechtos?): {[c["name"] for c in bavli_depth2[:10]]}')
    bavli_depth3 = []
    for m in bavli_depth2[:3]:
        bavli_depth3 += children(m["id"])
    print(f'  level 3 (dapim sample): {[c["name"] for c in bavli_depth3[:5]]}')
else:
    bavli_names = set()
    print('BAVLI ROOT NOT FOUND')

print()
# Card overlap
def card_ids_in_tree(tree_names):
    ids = set()
    for card in cards:
        tags = card.get("tags") or []
        for t in tags:
            if t.startswith("cat:") and t[4:] in tree_names:
                ids.add(card["id"])
                break
    return ids

shas_cards  = card_ids_in_tree(shas_names)
bavli_cards = card_ids_in_tree(bavli_names)
both        = shas_cards & bavli_cards
shas_only   = shas_cards - bavli_cards
bavli_only  = bavli_cards - shas_cards
neither     = set(c["id"] for c in cards) - shas_cards - bavli_cards

print("=== CARD DISTRIBUTION ===")
print(f"  Total cards:                {len(cards)}")
print(f"  In SHAS tree only:          {len(shas_only)}")
print(f"  In BAVLI tree only:         {len(bavli_only)}")
print(f"  In BOTH trees (duplicates): {len(both)}")
print(f"  In neither tree:            {len(neither)}")

# Name overlap at category level
overlap = shas_names & bavli_names
print()
print(f"=== CATEGORY NAME OVERLAP ===")
print(f"  Category names in SHAS subtree:  {len(shas_names)}")
print(f"  Category names in BAVLI subtree: {len(bavli_names)}")
print(f"  Names in BOTH subtrees:          {len(overlap)}")
sample = sorted(overlap)[:15]
print(f"  Sample overlap names: {sample}")

# Check if same category ID appears in both
shas_cat_ids  = subtree_ids(shas_root["id"])  if shas_root  else set()
bavli_cat_ids = subtree_ids(bavli_root["id"]) if bavli_root else set()
shared_cat_ids = shas_cat_ids & bavli_cat_ids
print()
print(f"=== SHARED CATEGORY IDs (same node in both) ===")
print(f"  {len(shared_cat_ids)} category IDs appear in both subtrees")
if shared_cat_ids:
    for cid in list(shared_cat_ids)[:5]:
        print(f"    {cid[:8]} = {by_id[cid]['name']}")
