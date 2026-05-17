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

# ─── CONFIG — ערוך את הפרטים שלך ────────────────────────────────────────────
SUPABASE_URL   = "https://YOUR_PROJECT.supabase.co"   # ← שנה!
ANON_KEY       = "eyJ..."                              # ← anon key מסופאבייס
ADMIN_EMAIL    = "your@email.com"                      # ← משתמש קיים
ADMIN_PASSWORD = "yourpassword"                        # ← סיסמתו
ROOT_CAT_NAME  = "תלמוד בבלי"                         # שם קטגוריית-שורש
SOURCE_TAG     = "yeshiva.org.il"
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


def build_card(q: dict, group: dict, masechet: str, user_id: str, deck_id: str) -> dict:
    """בונה כרטיס בפורמט סופאבייס מ-שאלה מנורמלת."""
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "deck_id": deck_id,
        "type": "multiple",
        "question": q["question"],
        "answer": q["answers"][q["correct_index"]] if q["answers"] else "",
        "options": json.dumps(q["answers"], ensure_ascii=False),
        "correct_indices": json.dumps([q["correct_index"]]),
        "correct_boolean": None,
        "tags": json.dumps([f"מסכת:{masechet}", f"מבחן:{group['title']}", SOURCE_TAG]),
        "source": SOURCE_TAG,
        "notes": group.get("mekorot", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── Main logic ───────────────────────────────────────────────────────────────

def import_all(data: dict, dry_run: bool, only_masechet: str | None):
    print("מתחבר לסופאבייס..." if not dry_run else "[DRY-RUN] לא ייכתב לבסיס הנתונים")
    token, user_id = ("DRY_TOKEN", "DRY_USER") if dry_run else login()

    root_id = None if dry_run else upsert_category(token, ROOT_CAT_NAME, user_id, None, 0)
    print(f"קטגוריית שורש: {ROOT_CAT_NAME} (id={root_id})")

    total_cards = 0
    for mi, (masechet, groups) in enumerate(data.items()):
        if only_masechet and masechet != only_masechet:
            continue

        masechet_id = None if dry_run else upsert_category(token, masechet, user_id, root_id, mi)
        print(f"\n  מסכת {masechet} ({len(groups)} קבוצות):")

        for gi, group in enumerate(groups):
            title = group.get("title", f"קבוצה {gi+1}")
            mekorot = group.get("mekorot", "")
            qs = group.get("questions", [])

            group_id = None if dry_run else upsert_category(token, title, user_id, masechet_id, gi)
            print(f"    {title}: {len(qs)} שאלות", end="")

            if dry_run:
                print(" [DRY]")
                total_cards += len(qs)
                continue

            cards = [build_card(q, group, masechet, user_id, group_id) for q in qs]
            # הכנס ב-batches של 50
            inserted = 0
            for i in range(0, len(cards), 50):
                inserted += insert_cards(token, cards[i:i+50])
                time.sleep(0.1)
            print(f" → הוכנסו {inserted}")
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

    import_all(data, dry_run=args.dry_run, only_masechet=args.masechet)


if __name__ == "__main__":
    main()
