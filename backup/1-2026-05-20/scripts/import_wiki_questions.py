"""
import_wiki_questions.py
מחלץ שאלות חזרה מויקי jewishbooks.org.il ומכניס לסופאבייס כ-flashcards.
כל שאלה כוללת גם תשובה (נלקחת מה-[Expand] בעמוד הויקי).

שימוש:
  python scripts/import_wiki_questions.py [--dry-run] [--masechet פסחים]

דרישות: pip install requests
"""
import re, uuid, json, sys, argparse, time
from datetime import datetime, timezone

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
WIKI_BASE      = "https://wiki.jewishbooks.org.il/mediawiki"
# ───────────────────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    sys.exit("❌  pip install requests  נדרש")


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def login() -> tuple:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def sb_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def create_deck(token: str, user_id: str, name: str, masechet: str) -> str:
    deck_id = str(uuid.uuid4())
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/decks",
        headers=sb_headers(token),
        json={
            "id": deck_id,
            "user_id": user_id,
            "name": name,
            "description": f"שאלות חזרה מסכת {masechet} — wiki.jewishbooks.org.il",
            "color": "blue",
        },
    )
    r.raise_for_status()
    return deck_id


def default_srs() -> dict:
    return {
        "interval": 1,
        "easeFactor": 2.5,
        "repetitions": 0,
        "due": datetime.now(timezone.utc).isoformat(),
    }


def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}


def insert_cards(token: str, user_id: str, deck_id: str, cards: list, batch: int = 50) -> int:
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for c in cards:
        rows.append({
            "id":              str(uuid.uuid4()),
            "user_id":         user_id,
            "deck_id":         deck_id,
            "type":            "flashcard",
            "question":        c["question"],
            "answer":          c["answer"],
            "options":         None,
            "correct_indices": None,
            "correct_boolean": None,
            "explanation":     None,
            "tags":            c["tags"],
            "srs":             default_srs(),
            "stats":           default_stats(),
            "created_at":      now,
        })

    inserted = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i: i + batch]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/cards",
            headers={**sb_headers(token), "Prefer": "return=minimal"},
            data=json.dumps(chunk),
        )
        if not r.ok:
            print(f"  ❌ שגיאה batch {i // batch}: {r.status_code} {r.text[:200]}")
        else:
            inserted += len(chunk)
            print(f"  ✅ הוכנסו {inserted}/{len(rows)} כרטיסים…")

    return inserted


# ─── Wiki helpers ─────────────────────────────────────────────────────────────

def wiki_api_list_pages(masechet: str) -> list:
    """List all subpages under שאלות_חזרה/{masechet}/ via MediaWiki API."""
    prefix = f"שאלות_חזרה/{masechet}/"
    url = f"{WIKI_BASE}/api.php"
    params = {
        "action":    "query",
        "list":      "allpages",
        "apprefix":  prefix,
        "aplimit":   "max",
        "format":    "json",
    }
    pages = []
    while True:
        r = requests.get(url, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
        for p in data["query"]["allpages"]:
            pages.append(p["title"])
        if "continue" in data:
            params["apcontinue"] = data["continue"]["apcontinue"]
        else:
            break
        time.sleep(0.3)
    return pages


def is_daf_page(title: str) -> bool:
    """Return True only for individual-daf pages (not chapter summary pages)."""
    suffix = title.split("/")[-1]
    return "פרק" not in suffix


def fetch_raw_wikitext(page_title: str) -> str:
    url = f"{WIKI_BASE}/index.php"
    r = requests.get(url, params={"title": page_title, "action": "raw"}, timeout=20)
    if r.status_code == 404:
        return ""
    r.raise_for_status()
    return r.text


# ─── Parser ──────────────────────────────────────────────────────────────────

def find_closing(text: str, pos: int) -> int:
    """
    Given text and pos AFTER the opening {{, return the position of the
    matching closing }}.  Handles nested {{ }} properly.
    Returns -1 if not found.
    """
    depth = 0
    i = pos
    while i < len(text) - 1:
        if text[i:i + 2] == "{{":
            depth += 1
            i += 2
        elif text[i:i + 2] == "}}":
            if depth == 0:
                return i
            depth -= 1
            i += 2
        else:
            i += 1
    return -1


def clean_wiki_text(text: str) -> str:
    """Strip wiki markup, keeping plain Hebrew text."""
    text = text.replace("{{ש}}", "\n")          # line-break template → newline
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)  # remove simple templates
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)  # wiki links
    text = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", text)     # ext links
    text = re.sub(r"\[https?://\S+\]", "", text)
    text = re.sub(r"'{2,}", "", text)            # bold/italic
    text = re.sub(r"  +", " ", text)
    return text.strip()


# Template structure in wikitext:
#   {{פרטים נגללים|{{גופן|3||QUESTION}}|{{גופן|2||ANSWER}}}}

OUTER_MARKER = "{{פרטים נגללים|"
Q_INNER      = "{{גופן|3||"
A_INNER      = "{{גופן|2||"


def parse_wiki_qa(wikitext: str, masechet: str, daf_name: str) -> list:
    text = wikitext.replace("\r\n", "\n").replace("\r", "\n")
    results = []
    pos = 0

    while True:
        outer_idx = text.find(OUTER_MARKER, pos)
        if outer_idx == -1:
            break

        inner_start = outer_idx + len(OUTER_MARKER)

        # Expect first argument to be {{גופן|3||...}}
        if not text[inner_start:].startswith(Q_INNER):
            pos = outer_idx + 1
            continue

        q_content_start = inner_start + len(Q_INNER)
        q_close = find_closing(text, q_content_start)
        if q_close == -1:
            pos = outer_idx + 1
            continue

        question_raw = text[q_content_start:q_close]

        # After closing }} of question, expect |{{גופן|2||...}}
        after_q = q_close + 2  # skip }}
        if not text[after_q:].startswith("|" + A_INNER):
            pos = outer_idx + 1
            continue

        a_content_start = after_q + 1 + len(A_INNER)
        a_close = find_closing(text, a_content_start)
        if a_close == -1:
            pos = outer_idx + 1
            continue

        answer_raw = text[a_content_start:a_close]

        question = clean_wiki_text(question_raw)
        answer   = clean_wiki_text(answer_raw)

        if question:
            results.append({
                "question": question,
                "answer":   answer,
                "tags":     [f"cat:{masechet}", f"דף {daf_name}"],
                "daf":      daf_name,
            })

        pos = a_close + 2  # advance past answer closing }}

    return results


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="ייבוא שאלות חזרה מויקי jewishbooks.org.il לסופאבייס"
    )
    ap.add_argument("--dry-run",   action="store_true", help="הצג בלבד, אל תכניס")
    ap.add_argument("--masechet",  default="פסחים",     help="שם המסכת בעברית")
    ap.add_argument("--deck-name", default="",          help="שם הדק (ברירת מחדל: מסכת X — שאלות חזרה)")
    args = ap.parse_args()

    masechet  = args.masechet
    deck_name = args.deck_name or f"מסכת {masechet} — שאלות חזרה"

    print(f"🔍  מחפש דפי גמרא עבור מסכת {masechet}…")
    all_pages = wiki_api_list_pages(masechet)
    daf_pages = [p for p in all_pages if is_daf_page(p)]
    print(f"  נמצאו {len(all_pages)} דפים סה\"כ, מהם {len(daf_pages)} דפי גמרא בודדים")

    if not daf_pages:
        print("❌  לא נמצאו דפים. ודא שם המסכת נכון.")
        return

    # Fetch + parse
    all_cards = []
    for page_title in sorted(daf_pages):
        daf_name = page_title.split("/")[-1]
        print(f"  📖 {page_title}…", end=" ", flush=True)
        try:
            wikitext = fetch_raw_wikitext(page_title)
        except Exception as e:
            print(f"שגיאה: {e}")
            continue
        if not wikitext:
            print("(ריק)")
            continue
        cards = parse_wiki_qa(wikitext, masechet, daf_name)
        print(f"{len(cards)} שאלות")
        all_cards.extend(cards)
        time.sleep(0.3)

    print(f"\n📋  סה\"כ: {len(all_cards)} שאלות ב-{len(daf_pages)} דפים")

    if not all_cards:
        print("❌  לא נמצאו שאלות.")
        return

    # Preview first 3
    print("\n👀  דוגמאות:")
    for c in all_cards[:3]:
        print(f"  [{c['daf']}] ש: {c['question'][:70]}")
        print(f"          ת: {c['answer'][:70]}")
        print()

    if args.dry_run:
        # Distribution by daf
        from collections import Counter
        counts = Counter(c["daf"] for c in all_cards)
        print("📊  לפי דף:")
        for daf, n in sorted(counts.items()):
            print(f"  דף {daf}: {n} שאלות")
        print("\n✋  dry-run — לא הוכנס כלום. הסר --dry-run להכנסה בפועל.")
        return

    print(f"\n🔐  מתחבר לסופאבייס כ-{ADMIN_EMAIL}…")
    token, user_id = login()
    print(f"✅  user_id: {user_id}")

    print(f"📂  יוצר דק: {deck_name!r}…")
    deck_id = create_deck(token, user_id, deck_name, masechet)
    print(f"✅  deck_id: {deck_id}")

    print(f"\n📥  מכניס {len(all_cards)} כרטיסים…")
    total = insert_cards(token, user_id, deck_id, all_cards)
    print(f"\n🎉  הסתיים! הוכנסו {total} כרטיסים לדק '{deck_name}'.")


if __name__ == "__main__":
    main()
