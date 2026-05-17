"""
import_yeshiva_all.py
מייבא שאלות אמריקאיות (multiple-choice) מכל המסכתות מאתר yeshiva.org.il לסופאבייס.

שימוש:
  python scripts/import_yeshiva_all.py --data-file scripts/yeshiva_all.json [--dry-run]

פורמט קובץ הנתונים:
  {
    "masechet_name_hebrew": {
      "test_id": {
        "id": ..., "title": ..., "mekorot": ..., "cat_id": ...,
        "questions": [{"question": ..., "answers": [...], "correct": [1-based]}]
      }
    }
  }

דרישות: pip install requests
"""
import json, sys, time, uuid, argparse
from datetime import datetime, timezone

SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
SOURCE_TAG     = "yeshiva.org.il"

try:
    import requests
except ImportError:
    sys.exit("pip install requests נדרש")


def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def sb_headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def insert_cards(token, cards):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/cards",
        json=cards,
        headers=sb_headers(token),
    )
    if r.status_code not in (200, 201):
        print("  insert error", r.status_code, r.text[:300])
        return 0
    return len(r.json())


def build_card(masechet, test_data, q, user_id):
    answers = q["answers"]
    correct_indices = [c - 1 for c in q["correct"]]
    test_title = test_data["title"]
    mekorot = test_data.get("mekorot", "")

    tags = [
        "מסכת:" + masechet,
        "מבחן:" + test_title,
        SOURCE_TAG,
    ]
    if mekorot:
        tags.insert(2, "מקורות:" + mekorot)

    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "type": "multiple",
        "question": q["question"],
        "answer": answers[correct_indices[0]] if correct_indices else "",
        "options": answers,
        "correct_indices": correct_indices,
        "correct_boolean": None,
        "explanation": None,
        "tags": tags,
        "srs": {"interval": 1, "ease": 2.5, "due": now, "reviews": 0, "lapses": 0},
        "stats": {"correct": 0, "incorrect": 0, "streak": 0},
        "created_at": now,
        "updated_at": now,
        "user_id": user_id,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-file", required=True, help="JSON file with all masechot data")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--masechet", help="Import only this masechet (Hebrew name)")
    args = parser.parse_args()

    with open(args.data_file, encoding="utf-8") as f:
        all_data = json.load(f)

    print("מתחבר לסופאבייס...")
    token, user_id = login()
    print("מחובר")

    total_inserted = 0
    masechot = {args.masechet: all_data[args.masechet]} if args.masechet and args.masechet in all_data else all_data

    for masechet, tests in masechot.items():
        all_cards = []
        for test_id, test_data in tests.items():
            questions = test_data.get("questions", [])
            if not questions:
                continue
            for q in questions:
                all_cards.append(build_card(masechet, test_data, q, user_id))
            print("  מסכת", masechet, "- מבחן", test_id, test_data.get("title", ""), "-", len(questions), "שאלות")

        if not all_cards:
            print("  מסכת", masechet, "- אין שאלות, מדלג")
            continue

        print("  סה\"כ", len(all_cards), "כרטיסיות למסכת", masechet)

        if args.dry_run:
            print("  Dry run - לא מכניס")
            print(json.dumps(all_cards[0], ensure_ascii=False, indent=2))
            continue

        BATCH = 50
        inserted = 0
        for i in range(0, len(all_cards), BATCH):
            batch = all_cards[i:i+BATCH]
            n = insert_cards(token, batch)
            inserted += n
            time.sleep(0.3)

        print("  הוכנסו", inserted, "כרטיסיות ממסכת", masechet)
        total_inserted += inserted

    print("\nהושלם! סה\"כ הוכנסו", total_inserted, "כרטיסיות")


if __name__ == "__main__":
    main()
