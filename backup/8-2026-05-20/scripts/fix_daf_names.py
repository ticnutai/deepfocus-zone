"""
fix_daf_names.py
מתקן שמות קטגוריות דפים ותגיות קלפים מהפורמט הישן
  "דף ב"  →  פורמט חדש  "ברכות · ב."
ותגיות:
  "cat:דף ב"  →  "cat:ברכות · ב."

הסקריפט:
1. מאתר כל קטגוריות-דף (parent = מסכת תחת תלמוד בבלי)
2. משנה שמן לפורמט המלא
3. מעדכן תגיות קלפים בהתאם
"""
import json, sys, time
from datetime import datetime, timezone

SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
PATH_SEP       = " · "

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

# ─── Auth ───────────────────────────────────────────────────────────────────────
def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]

def hdrs(token):
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

# ─── Hebrew gematria (same as shasGen.ts) ──────────────────────────────────────
_HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"]
_TENS     = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_ONES     = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]

def to_gematria(n):
    if n <= 0:
        return str(n)
    result = ""
    h = n // 100
    remainder = n % 100
    result += _HUNDREDS[h]
    if remainder == 15:
        result += "טו"
    elif remainder == 16:
        result += "טז"
    else:
        t = remainder // 10
        o = remainder % 10
        result += _TENS[t] + _ONES[o]
    return result

def daf_label(n):
    """e.g. 2 → 'ב.'"""
    return f"{to_gematria(n)}."

def old_daf_name(n):
    """Old format: 'דף ב'"""
    return f"דף {to_gematria(n)}"

def new_daf_name(masechet, n):
    """New format: 'ברכות · ב.'"""
    return f"{masechet}{PATH_SEP}{daf_label(n)}"

# ─── Main ───────────────────────────────────────────────────────────────────────
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print("מתחבר...")
    token, uid = login()
    H = hdrs(token)

    # 1. Find the root category "תלמוד בבלי"
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/categories",
        params={"name": "eq.תלמוד בבלי", "user_id": f"eq.{uid}", "select": "id,name"},
        headers=H, timeout=30
    )
    roots = r.json()
    if not roots:
        print("❌ לא נמצאה קטגוריית 'תלמוד בבלי'")
        return
    bavli_id = roots[0]["id"]
    print(f"✓ תלמוד בבלי id={bavli_id[:8]}")

    # 2. Get all masechet categories (direct children of תלמוד בבלי)
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/categories",
        params={"parent_id": f"eq.{bavli_id}", "user_id": f"eq.{uid}", "select": "id,name"},
        headers=H, timeout=30
    )
    masechtot = r.json()
    print(f"✓ נמצאו {len(masechtot)} מסכתות")

    total_cats_renamed = 0
    total_cards_updated = 0

    for masechet in masechtot:
        masechet_id   = masechet["id"]
        masechet_name = masechet["name"]

        # 3. Get all daf categories (children of this masechet)
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/categories",
            params={
                "parent_id": f"eq.{masechet_id}",
                "user_id": f"eq.{uid}",
                "select": "id,name",
                "limit": "200"
            },
            headers=H, timeout=30
        )
        daf_cats = r.json()
        if not daf_cats:
            print(f"  ⚠ {masechet_name}: אין קטגוריות דף")
            continue

        cat_renamed = 0
        card_updated = 0

        for daf_cat in daf_cats:
            daf_cat_id   = daf_cat["id"]
            old_name     = daf_cat["name"]  # e.g. "דף ב"

            # Parse the daf number from old name "דף X"
            # We'll rebuild by mapping old tag → new tag
            # Old name format: "דף <gematria>"
            # We need to find which number this corresponds to

            # Detect if it's in old format (starts with "דף ")
            if not old_name.startswith("דף "):
                # Already in new format or unknown
                continue

            gematria_part = old_name[len("דף "):]  # e.g. "ב"
            new_name = f"{masechet_name}{PATH_SEP}{gematria_part}."  # e.g. "ברכות · ב."

            # Rename the category
            r_upd = requests.patch(
                f"{SUPABASE_URL}/rest/v1/categories?id=eq.{daf_cat_id}",
                json={"name": new_name, "updated_at": datetime.now(timezone.utc).isoformat()},
                headers=H, timeout=30
            )
            if r_upd.status_code not in (200, 204):
                print(f"    ❌ שגיאה בעדכון קטגוריה {old_name}: {r_upd.text[:100]}")
                continue
            cat_renamed += 1

            # 4. Find all cards with both cat:masechet_name AND cat:old_daf_name
            old_daf_tag = f"cat:{old_name}"      # e.g. "cat:דף ב"
            new_daf_tag = f"cat:{new_name}"      # e.g. "cat:ברכות · ב."

            # Fetch cards matching masechet AND old daf tag
            # Use PostgREST array containment: tags @> ["cat:masechet", "cat:דף X"]
            filter_val = json.dumps([f"cat:{masechet_name}", old_daf_tag])
            r_cards = requests.get(
                f"{SUPABASE_URL}/rest/v1/cards",
                params={
                    "tags": f"cs.{filter_val}",
                    "user_id": f"eq.{uid}",
                    "select": "id,tags",
                    "limit": "500"
                },
                headers=H, timeout=30
            )
            cards = r_cards.json()
            if not isinstance(cards, list):
                print(f"    ⚠ בעיה בשליפת קלפים: {cards}")
                continue

            # Update tags in batches
            for card in cards:
                card_id  = card["id"]
                old_tags = card["tags"] or []
                # Replace old daf tag with new daf tag
                new_tags = [new_daf_tag if t == old_daf_tag else t for t in old_tags]
                if new_tags == old_tags:
                    continue
                r_card_upd = requests.patch(
                    f"{SUPABASE_URL}/rest/v1/cards?id=eq.{card_id}",
                    json={"tags": new_tags, "updated_at": datetime.now(timezone.utc).isoformat()},
                    headers=H, timeout=30
                )
                if r_card_upd.status_code not in (200, 204):
                    print(f"      ❌ שגיאה בעדכון קלף {card_id[:8]}: {r_card_upd.text[:80]}")
                else:
                    card_updated += 1

        total_cats_renamed += cat_renamed
        total_cards_updated += card_updated
        print(f"  ✓ {masechet_name}: {cat_renamed} קטגוריות, {card_updated} קלפים")

    print(f"\n✅ סה\"כ: {total_cats_renamed} קטגוריות שונמו, {total_cards_updated} קלפים עודכנו")

if __name__ == "__main__":
    main()
