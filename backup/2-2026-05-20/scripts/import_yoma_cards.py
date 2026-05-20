"""
import_yoma_cards.py
מחלץ שאלות חזרה מסכת יומא ממסמך TXT ומכניס לסופאבייס כ-flashcards.

שימוש:
  python scripts/import_yoma_cards.py [--dry-run] [--deck-name "שם הדק"]

דרישות: pip install requests
"""
import re, uuid, json, sys, argparse
from datetime import datetime, timezone

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
TXT_PATH       = "itzkovitzyoma2.txt"
# ───────────────────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    sys.exit("❌  pip install requests  נדרש")


def login() -> tuple[str, str]:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
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


def create_deck(token: str, user_id: str, name: str) -> str:
    deck_id = str(uuid.uuid4())
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/decks",
        headers=headers(token),
        json={
            "id": deck_id,
            "user_id": user_id,
            "name": name,
            "description": "שאלות חזרה מסכת יומא — ישראל יצחק הלוי איצקוביץ",
            "color": "gold",
        },
    )
    r.raise_for_status()
    return deck_id


def default_srs() -> dict:
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0, "due": datetime.now(timezone.utc).isoformat()}


def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}


# ─── Parser ────────────────────────────────────────────────────────────────────

CHAPTER_RE  = re.compile(r"פרק\s+([א-ת'\"]+)\s*$")
MISHNA_RE   = re.compile(r"משנה\s+([א-ת'\"]+)\s*$")
QUESTION_RE = re.compile(r"^([א-תa-z]+)\.\s+(.+)$")  # letter/num. question


def parse_questions(txt: str) -> list[dict]:
    """Return list of {chapter, mishna, question_text, tags}"""
    results = []
    current_chapter = ""
    current_mishna  = ""

    for raw_line in txt.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        cm = CHAPTER_RE.search(line)
        if cm:
            current_chapter = f"פרק {cm.group(1)}"
            current_mishna  = ""
            continue

        mm = MISHNA_RE.search(line)
        if mm:
            current_mishna = f"משנה {mm.group(1)}"
            continue

        qm = QUESTION_RE.match(line)
        if qm and current_chapter:
            q_text = qm.group(2).strip()
            tags = ["מסכת יומא"]
            if current_chapter:
                tags.append(current_chapter)
            if current_mishna:
                tags.append(current_mishna)
            results.append({
                "chapter":  current_chapter,
                "mishna":   current_mishna,
                "question": q_text,
                "tags":     tags,
            })

    return results


def insert_cards(token: str, user_id: str, deck_id: str, questions: list[dict], batch: int = 50):
    rows = []
    now  = datetime.now(timezone.utc).isoformat()
    for q in questions:
        rows.append({
            "id":             str(uuid.uuid4()),
            "user_id":        user_id,
            "deck_id":        deck_id,
            "type":           "flashcard",
            "question":       q["question"],
            "answer":         "",          # ניתן למלא אחר כך
            "options":        None,
            "correct_indices":None,
            "correct_boolean":None,
            "explanation":    None,
            "tags":           q["tags"],
            "srs":            default_srs(),
            "stats":          default_stats(),
            "created_at":     now,
        })

    inserted = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/cards",
            headers={**headers(token), "Prefer": "return=minimal"},
            data=json.dumps(chunk),
        )
        if not r.ok:
            print(f"  ❌ שגיאה batch {i//batch}: {r.status_code} {r.text[:200]}")
        else:
            inserted += len(chunk)
            print(f"  ✅ הוכנסו {inserted}/{len(rows)} כרטיסים…")

    return inserted


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run",   action="store_true", help="הצג בלבד, אל תכניס")
    ap.add_argument("--deck-name", default="מסכת יומא — שאלות חזרה", help="שם הדק")
    args = ap.parse_args()

    # Read + parse
    txt = open(TXT_PATH, encoding="utf-8").read()
    questions = parse_questions(txt)
    print(f"\n📋  נמצאו {len(questions)} שאלות")

    # Preview first 5
    for q in questions[:5]:
        print(f"  [{q['chapter']} › {q['mishna']}] {q['question'][:70]}")
    print("  ...")

    if args.dry_run:
        # Count by chapter
        from collections import Counter
        counts = Counter(q["chapter"] for q in questions)
        print("\n📊  לפי פרק:")
        for ch, n in sorted(counts.items()):
            print(f"  {ch}: {n} שאלות")
        print("\n✋  dry-run — לא הוכנס כלום. הסר --dry-run להכנסה בפועל.")
        return

    print(f"\n🔐  מתחבר כ-{ADMIN_EMAIL}…")
    token, user_id = login()
    print(f"✅  user_id: {user_id}")

    print(f"📂  יוצר דק: {args.deck_name!r}…")
    deck_id = create_deck(token, user_id, args.deck_name)
    print(f"✅  deck_id: {deck_id}")

    print(f"\n📥  מכניס {len(questions)} כרטיסים…")
    total = insert_cards(token, user_id, deck_id, questions)
    print(f"\n🎉  הסתיים! הוכנסו {total} כרטיסים לדק '{args.deck_name}'.")


if __name__ == "__main__":
    main()
