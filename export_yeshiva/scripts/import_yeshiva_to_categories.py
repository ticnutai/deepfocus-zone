"""
import_yeshiva_to_categories.py
מייבא שאלות אמריקאיות מקובץ yeshiva_questions.json לסופאבייס
עם היררכיית קטגוריות: תלמוד בבלי → מסכת → קבוצת דפים

שימוש:
    python import_yeshiva_to_categories.py --json yeshiva_questions.json
    python import_yeshiva_to_categories.py --json yeshiva_questions.json --dry-run
    python import_yeshiva_to_categories.py --json yeshiva_questions.json --masechet ברכות

דרישות: pip install requests
"""

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone

# סיווג לפי דף+עמוד — הכלל המרכזי המשותף לכל המקורות
from shas_cat_utils import (
    extract_daf_amud,
    daf_category_name,
    amud_category_name,
    uncat_category_name,
)

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQi"
                  "OjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy"
                  "451NO0N37rz7yjcpXYc")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
ROOT_CAT_NAME  = "תלמוד בבלי"                         # שם קטגוריית-שורש
SOURCE_TAG     = "source:yeshiva"
# ─────────────────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    sys.exit("pip install requests")


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def login() -> tuple[str, str]:
    """מחזיר (access_token, user_id)."""
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=15,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def upsert_category(token: str, name: str, user_id: str, parent_id: str | None, sort_order: int = 0) -> str:
    """יוצר קטגוריה אם לא קיימת, מחזיר את ה-id שלה."""
    # בדוק אם קיימת
    params = {"name": f"eq.{name}", "user_id": f"eq.{user_id}", "select": "id"}
    if parent_id:
        params["parent_id"] = f"eq.{parent_id}"
    else:
        params["parent_id"] = "is.null"

    r = requests.get(f"{SUPABASE_URL}/rest/v1/categories", params=params, headers=headers(token), timeout=10)
    r.raise_for_status()
    existing = r.json()
    if existing:
        return existing[0]["id"]

    # צור חדשה
    cat_id = str(uuid.uuid4())
    payload = {
        "id": cat_id,
        "user_id": user_id,
        "name": name,
        "parent_id": parent_id,
        "sort_order": sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(f"{SUPABASE_URL}/rest/v1/categories", json=payload, headers=headers(token), timeout=10)
    r.raise_for_status()
    return cat_id


def insert_cards(token: str, cards: list[dict]) -> int:
    if not cards:
        return 0
    r = requests.post(f"{SUPABASE_URL}/rest/v1/cards", json=cards, headers=headers(token), timeout=30)
    if r.status_code not in (200, 201):
        print(f"    שגיאת insert: {r.status_code} {r.text[:200]}")
        return 0
    return len(r.json())


def ensure_deck(token: str, user_id: str, dry_run: bool = False) -> str:
    """מחזיר deck_id קיים או יוצר deck חדש 'ש\"ס'."""
    if dry_run:
        return "DRY_DECK_ID"
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/decks?user_id=eq.{user_id}&select=id,name",
        headers=headers(token), timeout=10,
    )
    r.raise_for_status()
    decks = r.json()
    if decks:
        for d in decks:
            if d["name"] == 'ש"ס':
                return d["id"]
        print(f"  [deck] משתמש ב-deck קיים: {decks[0]['name']} ({decks[0]['id']})")
        return decks[0]["id"]
    # צור deck חדש
    deck_id = str(uuid.uuid4())
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/decks",
        json={"id": deck_id, "user_id": user_id, "name": 'ש"ס', "description": "ייבוא אוטומטי"},
        headers=headers(token), timeout=10,
    )
    r.raise_for_status()
    print(f"  [deck] נוצר deck חדש: ש\"ס (id={deck_id})")
    return deck_id


def default_srs() -> dict:
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0,
            "due": datetime.now(timezone.utc).isoformat()}


def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}


def build_card(
    q: dict,
    masechet: str,
    user_id: str,
    deck_id: str,
    cat_name: str | None = None,
) -> dict:
    """בונה כרטיס בפורמט סופאבייס — תג יחיד לרמה העמוקה ביותר."""
    tags = []
    if cat_name:
        tags.append(f"cat:{cat_name}")
    tags.append(SOURCE_TAG)

    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "deck_id": deck_id,
        "type": "multiple",
        "question": q["question"],
        "answer": q["answers"][q["correct_index"]] if q["answers"] else "",
        "options": q["answers"],
        "correct_indices": [q["correct_index"]],
        "correct_boolean": None,
        "explanation": None,
        "tags": tags,
        "srs": default_srs(),
        "stats": default_stats(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── Main logic ───────────────────────────────────────────────────────────────

def import_all(data: dict, dry_run: bool, only_masechet: str | None):
    print("מתחבר לסופאבייס..." if not dry_run else "[DRY-RUN] לא ייכתב לבסיס הנתונים")
    token, user_id = ("DRY_TOKEN", "DRY_USER") if dry_run else login()
    deck_id = ensure_deck(token, user_id, dry_run)
    print(f"deck_id: {deck_id}")

    root_id = None if dry_run else upsert_category(token, ROOT_CAT_NAME, user_id, None, 0)
    print(f"קטגוריית שורש: {ROOT_CAT_NAME} (id={root_id})")

    total_cards = 0
    for mi, (masechet, groups) in enumerate(data.items()):
        if only_masechet and masechet != only_masechet:
            continue

        masechet_id = None if dry_run else upsert_category(token, masechet, user_id, root_id, mi)
        print(f"\n  מסכת {masechet} ({len(groups)} קבוצות):")

        # מטמון קטגוריות: נוצרות לפי סדר הופעתן (ייצור טבעי של הש"ס)
        daf_cat_cache: dict[str, str] = {}         # daf_letters → daf_cat_id
        amud_cat_cache: dict[str, str] = {}        # f"{daf}_{amud}" → amud_cat_id
        uncat_cat_id: str | None = None             # id של ברכות · ללא סיווג (נוצר בפעם הראשונה)

        for gi, group in enumerate(groups):
            title = group.get("title", f"קבוצה {gi+1}")
            qs = group.get("questions", [])

            print(f"    {title}: {len(qs)} שאלות", end="")

            if dry_run:
                print(" [DRY]")
                total_cards += len(qs)
                continue

            cards = []
            for q in qs:
                cat_name: str | None = None

                daf_info = extract_daf_amud(q["question"])
                if daf_info:
                    daf, amud_val = daf_info

                    # 1. קטגוריית דף: ברכות · ב.
                    if daf not in daf_cat_cache:
                        sort_ord = 1000 + len(daf_cat_cache)
                        daf_cat_cache[daf] = upsert_category(
                            token, daf_category_name(masechet, daf), user_id, masechet_id, sort_ord
                        )
                    daf_id = daf_cat_cache[daf]

                    # 2. קטגוריית עמוד: יוצרים תמיד את שניהם (ע"א + ע"ב) ביחד
                    #    כך שגם עמוד ריק מוצג בממשק
                    amud_key = f"{daf}_{amud_val}"
                    if amud_key not in amud_cat_cache:
                        for ai, aletter in enumerate(['א', 'ב']):
                            akey = f"{daf}_{aletter}"
                            if akey not in amud_cat_cache:
                                amud_cat_cache[akey] = upsert_category(
                                    token, amud_category_name(masechet, daf, aletter),
                                    user_id, daf_id, ai
                                )
                    cat_name = amud_category_name(masechet, daf, amud_val)

                else:
                    # לא זוהה דף — כרטיס נכנס לתת-קטגוריה "ללא סיווג" של המסכת
                    if uncat_cat_id is None:
                        uncat_cat_id = upsert_category(
                            token, uncat_category_name(masechet), user_id, masechet_id, 9999
                        )
                    cat_name = uncat_category_name(masechet)

                cards.append(build_card(q, masechet, user_id, deck_id, cat_name))

            # הכנס ב-batches של 50
            inserted = 0
            for i in range(0, len(cards), 50):
                inserted += insert_cards(token, cards[i:i+50])
                time.sleep(0.1)
            print(f" → הוכנסו {inserted} (דפים: {len(daf_cat_cache)}, עמודים: {len(amud_cat_cache)})")
            total_cards += inserted

    print(f"\nסה\"כ כרטיסים: {total_cards}")


def main():
    parser = argparse.ArgumentParser(description="ייבוא שאלות ישיבה לסופאבייס")
    parser.add_argument("--json", required=True, help="קובץ yeshiva_questions.json")
    parser.add_argument("--dry-run", action="store_true", help="הדפס בלבד, אל תכתוב")
    parser.add_argument("--masechet", help="ייבא רק מסכת אחת")
    args = parser.parse_args()

    with open(args.json, encoding="utf-8") as f:
        data = json.load(f)

    # תמיכה בשני פורמטים:
    # פורמט A (מרובה מסכתות): {"ברכות": [tests], "שבת": [tests], ...}
    # פורמט B (מסכת יחידה):   {"tractate": "ברכות", "tests": [tests]}
    if isinstance(data, dict) and "tractate" in data and "tests" in data:
        data = {data["tractate"]: data["tests"]}

    import_all(data, dry_run=args.dry_run, only_masechet=args.masechet)


if __name__ == "__main__":
    main()
