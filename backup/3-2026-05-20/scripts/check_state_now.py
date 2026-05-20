"""
check_state_now.py
בודק את המצב הנוכחי של הDB: כמה כרטיסים, כמה בעץ ש"ס, כמה עזובים.
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

print("=== טוען נתונים ===")
cats  = fetch_all("categories", {"select": "id,name,parent_id"})
cards = fetch_all("cards",      {"select": "id,tags"})

print(f"סה\"כ קטגוריות: {len(cats)}")
print(f"סה\"כ כרטיסים:  {len(cards)}")

# Build sets
cat_names = {c["name"] for c in cats}
roots = [c for c in cats if not c.get("parent_id")]
print(f"\n=== קטגוריות שורש ({len(roots)}) ===")
for r2 in sorted(roots, key=lambda c: c["name"]):
    print(f"  {r2['name']}")

# Build subtree for each root
def subtree_names(root_id, by_parent):
    names = set()
    stack = [root_id]
    id_map = {c["id"]: c for c in cats}
    while stack:
        pid = stack.pop()
        cat = id_map.get(pid)
        if cat:
            names.add(cat["name"])
        for cid in by_parent.get(pid, []):
            stack.append(cid)
    return names

by_parent = {}
for c in cats:
    if c.get("parent_id"):
        by_parent.setdefault(c["parent_id"], []).append(c["id"])

print("\n=== גודל כל עץ ===")
root_stats = []
for r2 in sorted(roots, key=lambda c: c["name"]):
    names = subtree_names(r2["id"], by_parent)
    root_stats.append((r2["name"], names))
    print(f"  {r2['name']:30}  {len(names):5} קטגוריות")

# Now check cards
print("\n=== ניתוח כרטיסים ===")
orphaned = []
per_root = {name: 0 for name, _ in root_stats}
per_root_names = {name: names for name, names in root_stats}

card_in_any = 0
for card in cards:
    cat_tags = [t[4:] for t in (card.get("tags") or []) if t.startswith("cat:")]
    found_roots = set()
    found_in_any = False
    for tag_name in cat_tags:
        if tag_name in cat_names:
            found_in_any = True
            for rname, rnames in per_root_names.items():
                if tag_name in rnames:
                    found_roots.add(rname)
    if found_in_any:
        card_in_any += 1
        for rname in found_roots:
            per_root[rname] = per_root.get(rname, 0) + 1
    else:
        if cat_tags:
            orphaned.append((card["id"], cat_tags))

print(f"  כרטיסים שיש להם קטגוריה קיימת: {card_in_any}")
print(f"  כרטיסים עזובים (tags שלא קיימים): {len(orphaned)}")

print("\n  כרטיסים לפי עץ שורש:")
for rname, count in sorted(per_root.items(), key=lambda x: -x[1]):
    if count > 0:
        print(f"    {rname:30}  {count}")

if orphaned:
    print(f"\n  דוגמאות כרטיסים עזובים (עד 10):")
    for cid, tags in orphaned[:10]:
        print(f"    card {cid[:8]}  tags={tags[:3]}")
    # Check if orphaned look like bavli names
    bavli_like = sum(1 for _, tags in orphaned if any("·" in t or "·" in t for t in tags))
    # Check specifically for any pattern
    print(f"\n  בדיקה - האם ה-tags העזובים נראים כמו שמות ש\"ס/בבלי:")
    sample_tags = [tags[0] for _, tags in orphaned[:20] if tags]
    for t in sample_tags:
        print(f"    '{t}'")
else:
    print("\n  אין כרטיסים עזובים - כל הכרטיסים מחוברים לקטגוריות קיימות!")

print("\n=== סיכום ===")
print(f"  לפני המחיקה: 10,230 כרטיסים, 7,962 קטגוריות (כולל שניהם - ש\"ס + תלמוד בבלי)")
print(f"  אחרי המחיקה: {len(cards):,} כרטיסים, {len(cats):,} קטגוריות")
print(f"  כרטיסים שאבדו: {10230 - len(cards)}")
print(f"  כרטיסים עזובים: {len(orphaned)}")
