"""Diagnose full category tree structure before merge."""
import requests

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

r = requests.post(URL+'/auth/v1/token?grant_type=password',
    headers={'apikey': ANON, 'Content-Type': 'application/json'},
    json={'email': 'jj1212t@gmail.com', 'password': '543211'})
token = r.json()['access_token']
uid   = r.json()['user']['id']
hdrs  = {'Authorization': f'Bearer {token}', 'apikey': ANON}

def get_all(path, params=""):
    all_rows, offset = [], 0
    while True:
        r = requests.get(URL+f'/rest/v1/{path}?{params}&limit=1000&offset={offset}', headers=hdrs).json()
        all_rows.extend(r)
        if len(r) < 1000: break
        offset += 1000
    return all_rows

# Load all non-deleted categories
cats = get_all('categories', f'select=id,name,parent_id,sort_order&user_id=eq.{uid}&deleted_at=is.null')
print(f"Total active categories: {len(cats)}")

# Build lookup
by_id = {c['id']: c for c in cats}
by_parent = {}
for c in cats:
    p = c['parent_id'] or '__root__'
    by_parent.setdefault(p, []).append(c)

# Print roots
print("\n=== ROOT CATEGORIES (parent_id IS NULL) ===")
roots = by_parent.get('__root__', [])
for r in roots:
    children = by_parent.get(r['id'], [])
    print(f"  [{r['name']}]  id={r['id']}  children={len(children)}")

# Print ש"ס subtree
print("\n=== ש\"ס SUBTREE (level 1 = direct children) ===")
shas_roots = [c for c in roots if c['name'] == 'ש"ס']
for sr in shas_roots:
    print(f"\n  ש\"ס root: {sr['id']}")
    for child in sorted(by_parent.get(sr['id'], []), key=lambda x: x.get('sort_order') or 999):
        grandchildren = by_parent.get(child['id'], [])
        print(f"    {child['name']}  ({len(grandchildren)} sub-cats)  id={child['id']}")

# Print תלמוד בבלי subtree
print("\n=== תלמוד בבלי SUBTREE ===")
bavli_roots = [c for c in roots if c['name'] == 'תלמוד בבלי']
for br in bavli_roots:
    print(f"\n  תלמוד בבלי root: {br['id']}")
    for child in sorted(by_parent.get(br['id'], []), key=lambda x: x.get('sort_order') or 999):
        grandchildren = by_parent.get(child['id'], [])
        print(f"    {child['name']}  ({len(grandchildren)} dafim)  id={child['id']}")

# Check for masechet name overlaps between ש"ס and תלמוד בבלי
print("\n=== OVERLAP CHECK (masechets in BOTH trees) ===")
shas_child_names = set()
for sr in shas_roots:
    for c in by_parent.get(sr['id'], []):
        shas_child_names.add(c['name'])

bavli_child_names = set()
bavli_children = []
for br in bavli_roots:
    for c in by_parent.get(br['id'], []):
        bavli_child_names.add(c['name'])
        bavli_children.append(c)

overlap = shas_child_names & bavli_child_names
print(f"  Masechets in ש\"ס: {len(shas_child_names)}")
print(f"  Masechets in תלמוד בבלי: {len(bavli_child_names)}")
print(f"  OVERLAPPING names: {len(overlap)}")
for name in sorted(overlap):
    print(f"    {name}")

# Count cards tagged cat:תלמוד בבלי
print("\n=== CARD TAG COUNTS ===")
from collections import Counter
all_cards = get_all('cards', f'select=tags&user_id=eq.{uid}')
print(f"  Total cards: {len(all_cards)}")
tag_counts = Counter()
for c in all_cards:
    for t in (c.get('tags') or []):
        tag_counts[t] += 1
print(f"  cat:ש\"ס: {tag_counts['cat:ש\"ס']}")
print(f"  cat:תלמוד בבלי: {tag_counts['cat:תלמוד בבלי']}")
