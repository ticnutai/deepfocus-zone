"""
fix_daf_names_batch.py
מתקן שמות קטגוריות דפים ותגיות קלפים ב-BATCH (קריאה אחת לכל דף)

ישן:  קטגוריה "דף ב" | תגית "cat:דף ב"
חדש:  קטגוריה "ברכות · ב." | תגית "cat:ברכות · ב."
"""
import sys, json, time
sys.stdout.reconfigure(encoding="utf-8")

SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
PATH_SEP       = " · "
BAVLI_TAG      = "cat:תלמוד בבלי"

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

# ─── Gematria (same logic as shasGen.ts) ───────────────────────────────────────
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
        result += _TENS[remainder // 10]
        result += _ONES[remainder % 10]
    return result

def daf_label(n):
    return f"{to_gematria(n)}."          # e.g. "ב."

def old_daf_cat_name(n):
    return f"דף {to_gematria(n)}"        # e.g. "דף ב"

def new_daf_cat_name(masechet, n):
    return f"{masechet}{PATH_SEP}{daf_label(n)}"  # e.g. "ברכות · ב."

# ─── Auth ───────────────────────────────────────────────────────────────────────
def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY}, timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]

def hdrs(token, prefer="return=minimal"):
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": prefer,
    }

def patch(token, path, params, body, prefer="return=minimal"):
    url = SUPABASE_URL + path
    r = requests.patch(url, params=params, json=body, headers=hdrs(token, prefer), timeout=60)
    return r

# ─── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("מתחבר...")
    token, uid = login()
    H = hdrs(token)

    # 1. Find root "תלמוד בבלי"
    r = requests.get(f"{SUPABASE_URL}/rest/v1/categories",
        params={"name": "eq.תלמוד בבלי", "user_id": f"eq.{uid}", "select": "id,name"},
        headers=H, timeout=30)
    bavli_cats = r.json()
    if not bavli_cats:
        sys.exit("❌ לא נמצאה קטגוריית 'תלמוד בבלי'")
    bavli_id = bavli_cats[0]["id"]
    print(f"✓ תלמוד בבלי id={bavli_id[:8]}")

    # 2. Get all masechet categories (direct children of תלמוד בבלי)
    r = requests.get(f"{SUPABASE_URL}/rest/v1/categories",
        params={"parent_id": f"eq.{bavli_id}", "user_id": f"eq.{uid}", "select": "id,name"},
        headers=H, timeout=30)
    masechtot = r.json()
    print(f"✓ {len(masechtot)} מסכתות")

    total_cats = 0
    total_cards = 0
    errors = 0

    for ms in masechtot:
        ms_id   = ms["id"]
        ms_name = ms["name"]

        # 3. Get all daf categories under this masechet that are in OLD format (start with "דף ")
        r = requests.get(f"{SUPABASE_URL}/rest/v1/categories",
            params={"parent_id": f"eq.{ms_id}", "user_id": f"eq.{uid}",
                    "name": "like.דף *", "select": "id,name", "limit": "300"},
            headers=H, timeout=30)
        old_daf_cats = r.json()

        if not old_daf_cats:
            print(f"  ✓ {ms_name}: כבר מעודכן (אין 'דף *')")
            continue

        ms_cats = 0
        ms_cards = 0

        for daf_cat in old_daf_cats:
            daf_cat_id = daf_cat["id"]
            old_name   = daf_cat["name"]  # e.g. "דף ב"

            # Parse gematria part: "דף ב" → "ב"
            if not old_name.startswith("דף "):
                continue
            gematria = old_name[len("דף "):]  # e.g. "ב"
            new_name  = f"{ms_name}{PATH_SEP}{gematria}."  # e.g. "ברכות · ב."
            old_tag   = f"cat:{old_name}"    # "cat:דף ב"
            new_tag   = f"cat:{new_name}"    # "cat:ברכות · ב."
            ms_tag    = f"cat:{ms_name}"     # "cat:ברכות"

            # ── Rename category (one API call per daf) ──
            rcat = patch(token, f"/rest/v1/categories",
                         {"id": f"eq.{daf_cat_id}"},
                         {"name": new_name})
            if rcat.status_code not in (200, 204):
                print(f"    ❌ קטגוריה {old_name}: {rcat.text[:80]}")
                errors += 1
                continue
            ms_cats += 1

            # ── Update cards: batch update all cards with ms_tag + old_daf_tag ──
            # PostgREST: tags @> '["cat:ברכות","cat:דף ב"]'
            filter_val = json.dumps([ms_tag, old_tag])
            new_tags = [BAVLI_TAG, ms_tag, new_tag]

            rcards = patch(token, f"/rest/v1/cards",
                           {"tags": f"cs.{filter_val}", "user_id": f"eq.{uid}"},
                           {"tags": new_tags})
            if rcards.status_code not in (200, 204):
                print(f"    ❌ קלפים {old_name}: {rcards.text[:80]}")
                errors += 1
            else:
                ms_cards += 1  # count dafim updated (card count not returned with return=minimal)

        total_cats  += ms_cats
        total_cards += ms_cards
        print(f"  ✓ {ms_name}: {ms_cats} דפים עודכנו")

    print(f"\n{'✅' if not errors else '⚠'} סה\"כ: {total_cats} קטגוריות, {total_cards} קלפים | שגיאות: {errors}")

if __name__ == "__main__":
    main()
