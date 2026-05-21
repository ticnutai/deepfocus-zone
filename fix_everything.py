"""
fix_everything.py
=================
מסדר את כל בסיס הנתונים:
1. מוחק את כל הקטגוריות הישנות/שבורות
2. משנה שם decks ל-ש"ס
3. מריץ את import_shemesh ליצירת היררכיה נכונה
4. מעדכן category_ids של ה-deck לתלמוד בבלי

שימוש: python fix_everything.py [--dry-run]
"""
import json, sys, time, argparse
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

# ─── CONFIG ───────────────────────────────────────────────────────────────────
URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
KEY  = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
        "InJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQi"
        "OjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy"
        "451NO0N37rz7yjcpXYc")
EMAIL    = "jj1212t@gmail.com"
PASSWORD = "543211"
# ──────────────────────────────────────────────────────────────────────────────

def login():
    r = requests.post(f"{URL}/auth/v1/token?grant_type=password",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"apikey": KEY}, timeout=15)
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]

def h(token):
    return {"Authorization": f"Bearer {token}", "apikey": KEY,
            "Content-Type": "application/json"}

def count_categories(token, uid):
    r = requests.get(f"{URL}/rest/v1/categories?user_id=eq.{uid}&select=id",
        headers={**h(token), "Prefer": "count=exact", "Range": "0-0"}, timeout=20)
    cr = r.headers.get("content-range", "")
    try:
        return int(cr.split("/")[1])
    except Exception:
        return -1

def delete_all_categories(token, uid, dry_run):
    """
    מוחק את כל הקטגוריות של המשתמש.
    PostgREST DELETE with user_id filter — safe because of RLS.
    """
    total = count_categories(token, uid)
    print(f"  [categories] סך הכל לפני מחיקה: {total}")
    if dry_run:
        print("  [categories] dry-run — דולג על מחיקה")
        return

    # Delete in batches to avoid timeout
    # First fetch all IDs, then delete in chunks
    all_ids = []
    offset = 0
    page = 1000
    while True:
        r = requests.get(
            f"{URL}/rest/v1/categories?user_id=eq.{uid}&select=id&limit={page}&offset={offset}",
            headers=h(token), timeout=30)
        r.raise_for_status()
        batch = r.json()
        all_ids.extend(c["id"] for c in batch)
        if len(batch) < page:
            break
        offset += page
        time.sleep(0.1)

    print(f"  [categories] נמצאו {len(all_ids)} קטגוריות — מוחק...")
    
    # Delete in chunks of 500
    CHUNK = 500
    deleted = 0
    for i in range(0, len(all_ids), CHUNK):
        chunk_ids = all_ids[i:i + CHUNK]
        ids_param = "in.(" + ",".join(chunk_ids) + ")"
        r = requests.delete(
            f"{URL}/rest/v1/categories?id={ids_param}",
            headers=h(token), timeout=30)
        if not r.ok:
            print(f"  [categories] שגיאה במחיקה: {r.status_code} {r.text[:200]}")
        else:
            deleted += len(chunk_ids)
        time.sleep(0.05)

    remaining = count_categories(token, uid)
    print(f"  [categories] נמחקו {deleted}. נותרו: {remaining}")


def fix_decks(token, uid, dry_run):
    """מוחק/משנה decks: deck ראשי → ש\"ס, שאר → נמחקים אם אין להם כרטיסים."""
    r = requests.get(f"{URL}/rest/v1/decks?user_id=eq.{uid}&select=id,name",
        headers=h(token), timeout=10)
    r.raise_for_status()
    decks = r.json()
    print(f"  [decks] נמצאו {len(decks)} decks")
    for d in decks:
        print(f"    - {d['name']} ({d['id']})")

    if not decks:
        print("  [decks] אין decks — לא צריך לתקן")
        return None

    # Use the first deck as ש"ס (already the one used by the import)
    primary = decks[0]
    others = decks[1:]

    if not dry_run:
        # Rename primary to ש"ס
        if primary["name"] != 'ש"ס':
            r2 = requests.patch(
                f"{URL}/rest/v1/decks?id=eq.{primary['id']}",
                json={"name": 'ש"ס', "description": "כל ש\"ס - שמש",
                      "category_ids": [], "include_sub_categories": True},
                headers=h(token), timeout=10)
            if r2.ok:
                print(f"  [decks] ✅ שונה שם: {primary['name']} → ש\"ס")
            else:
                print(f"  [decks] ❌ שגיאה בשינוי שם: {r2.status_code} {r2.text[:200]}")
        
        # Delete other decks (they have no cards since deck_id is nullable)
        for d in others:
            r3 = requests.delete(f"{URL}/rest/v1/decks?id=eq.{d['id']}",
                headers=h(token), timeout=10)
            if r3.ok:
                print(f"  [decks] ✅ נמחק deck: {d['name']}")
            else:
                print(f"  [decks] ⚠️  שגיאה במחיקת deck {d['name']}: {r3.status_code}")
    else:
        print(f"  [decks] dry-run — היה משנה {primary['name']} → ש\"ס ומוחק {len(others)} אחרים")

    return primary["id"]


def run_shemesh_import(dry_run):
    """מריץ את import_shemesh_to_categories.py."""
    import subprocess
    script_dir = Path(__file__).parent / "export_for_friend"
    script = script_dir / "scripts" / "import_shemesh_to_categories.py"
    cmd = [sys.executable, str(script)]
    if dry_run:
        cmd.append("--dry-run")
    
    print(f"\n  [import] מריץ: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True,
                            encoding="utf-8", errors="replace",
                            cwd=str(script_dir))
    
    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            print(f"    {line}")
    if result.stderr:
        for line in result.stderr.strip().split("\n"):
            print(f"    [ERR] {line}")
    
    if result.returncode != 0:
        print(f"  [import] ❌ יצא עם קוד {result.returncode}")
    else:
        print(f"  [import] ✅ הסתיים בהצלחה")
    return result.returncode == 0


def update_deck_category_ids(token, uid, deck_id, root_cat_name, dry_run):
    """מחפש את קטגוריית root תלמוד בבלי ומעדכן category_ids של ה-deck."""
    import urllib.parse
    encoded_name = urllib.parse.quote(root_cat_name)
    r = requests.get(
        f"{URL}/rest/v1/categories?user_id=eq.{uid}&name=eq.{encoded_name}&select=id",
        headers=h(token), timeout=10)
    r.raise_for_status()
    cats = r.json()
    if not cats:
        print(f"  [deck] ⚠️  לא נמצאה קטגוריה '{root_cat_name}' — לא מעדכן category_ids")
        return
    
    root_id = cats[0]["id"]
    print(f"  [deck] קטגוריית root '{root_cat_name}': {root_id}")
    
    if not dry_run:
        r2 = requests.patch(
            f"{URL}/rest/v1/decks?id=eq.{deck_id}",
            json={"category_ids": [root_id], "include_sub_categories": True},
            headers=h(token), timeout=10)
        if r2.ok:
            print(f"  [deck] ✅ עודכן category_ids של ש\"ס → [{root_id}]")
        else:
            print(f"  [deck] ❌ שגיאה: {r2.status_code} {r2.text[:200]}")
    else:
        print(f"  [deck] dry-run — היה מעדכן category_ids → [{root_id}]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("=" * 60)
    print("fix_everything.py" + (" [DRY-RUN]" if args.dry_run else ""))
    print("=" * 60)

    print("\n[1/5] מתחבר לסופאבייס...")
    token, uid = login()
    print(f"  user_id: {uid}")

    print("\n[2/5] מוחק את כל הקטגוריות הישנות...")
    delete_all_categories(token, uid, args.dry_run)

    print("\n[3/5] מתקן decks...")
    deck_id = fix_decks(token, uid, args.dry_run)

    print("\n[4/5] מריץ import_shemesh ליצירת היררכיה נכונה...")
    success = run_shemesh_import(args.dry_run)

    if not success:
        print("\n❌ import נכשל — עוצר כאן")
        return

    print("\n[5/5] מעדכן category_ids של ה-deck...")
    # Re-login in case token expired
    token, uid = login()
    if deck_id:
        update_deck_category_ids(token, uid, deck_id, "תלמוד בבלי", args.dry_run)
    
    print("\n[סיכום] בדיקת מצב סופי...")
    token, uid = login()
    cat_count = count_categories(token, uid)
    r = requests.get(f"{URL}/rest/v1/cards?user_id=eq.{uid}&select=id",
        headers={**h(token), "Prefer": "count=exact", "Range": "0-0"}, timeout=20)
    card_count = int(r.headers.get("content-range", "0/0").split("/")[1])
    r2 = requests.get(f"{URL}/rest/v1/decks?user_id=eq.{uid}&select=id,name,category_ids",
        headers=h(token), timeout=10)
    decks = r2.json()
    
    print(f"  קטגוריות: {cat_count}")
    print(f"  כרטיסים: {card_count}")
    print(f"  Decks: {[(d['name'], d.get('category_ids')) for d in decks]}")
    print("\n✅ סיום!")


if __name__ == "__main__":
    main()
