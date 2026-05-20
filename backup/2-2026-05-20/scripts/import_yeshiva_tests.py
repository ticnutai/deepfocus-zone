"""
import_yeshiva_tests.py
מחלץ מבחני גמרא (שאלות רב-ברירה) מאתר yeshiva.org.il ומכניס לסופאבייס.

API שבשימוש:
  GET /api/test/tests?catid=XX       — רשימת מבחנים בקטגוריה
  GET /api/test/SingleTest?testid=XX — שאלות המבחן

פורמט השאלה:
  american=True  → רב-ברירה (type="multiple")
  american=False → מבחן פתוח — מדולג כברירת-מחדל (ניתן לשנות עם --include-open)
  answers[N]     → 4 אפשרויות תשובה
  correct=[N]    → אינדקס 1-based של התשובה הנכונה

שימוש:
  python scripts/import_yeshiva_tests.py --masechet פסחים [--dry-run]
  python scripts/import_yeshiva_tests.py --masechet ברכות --deck-name "ברכות - מבחנים"
  python scripts/import_yeshiva_tests.py --masechet שבת --include-open

דרישות:
  pip install requests playwright
  python -m playwright install chromium
"""
import re, uuid, json, sys, argparse, time, asyncio
from datetime import datetime, timezone

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
YESHIVA_BASE   = "https://www.yeshiva.org.il"

# מיפוי שם מסכת → מזהה קטגוריה באתר ישיבה (גמרא)
CATEGORY_MAP = {
    "ברכות":       91,
    "שבת":         92,
    "עירובין":     93,
    "פסחים":       94,
    "שקלים":       95,
    "ראש השנה":    96,
    "יומא":        97,
    "כתובות":      98,
    "קידושין":     99,
    "בבא קמא":     100,
    "בבא מציעא":   101,
    "בבא בתרא":    102,
    "סנהדרין":     103,
    "מכות":        104,
    "שבועות":      105,
    "עבודה זרה":   106,
    "הוריות":      107,
    "זבחים":       108,
    "מנחות":       109,
    "חולין":       110,
    "בכורות":      111,
    "ערכין":       112,
    "תמורה":       113,
    "כריתות":      114,
    "מעילה":       115,
    "נידה":        116,
    "סוכה":        117,
    "ביצה":        118,
    "תענית":       122,
    "מגילה":       124,
    "מועד קטן":    126,
    "חגיגה":       128,
    "יבמות":       132,
    "גיטין":       136,
    "נדרים":       223,
    "נזיר":        224,
    "סוטה":        244,
}
# ───────────────────────────────────────────────────────────────────────────────

try:
    import requests as req_lib
except ImportError:
    sys.exit("❌  pip install requests  נדרש")

try:
    from playwright.async_api import async_playwright
except ImportError:
    sys.exit("❌  pip install playwright && python -m playwright install chromium  נדרשים")


# ─── Supabase helpers ──────────────────────────────────────────────────────────

def login() -> tuple:
    r = req_lib.post(
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
        "apikey":        ANON_KEY,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
    }


def create_deck(token: str, user_id: str, name: str, masechet: str) -> str:
    deck_id = str(uuid.uuid4())
    r = req_lib.post(
        f"{SUPABASE_URL}/rest/v1/decks",
        headers=sb_headers(token),
        json={
            "id":          deck_id,
            "user_id":     user_id,
            "name":        name,
            "description": f"שאלות רב-ברירה ממסכת {masechet} — yeshiva.org.il",
            "color":       "green",
        },
    )
    r.raise_for_status()
    return deck_id


def default_srs() -> dict:
    return {
        "interval":    1,
        "easeFactor":  2.5,
        "repetitions": 0,
        "due":         datetime.now(timezone.utc).isoformat(),
    }


def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}


def insert_cards(token: str, user_id: str, deck_id: str, cards: list, batch: int = 50) -> int:
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for c in cards:
        row = {
            "id":              str(uuid.uuid4()),
            "user_id":         user_id,
            "deck_id":         deck_id,
            "type":            c["type"],
            "question":        c["question"],
            "answer":          c.get("answer", ""),
            "options":         c.get("options"),
            "correct_indices": c.get("correct_indices"),
            "correct_boolean": None,
            "explanation":     c.get("explanation"),
            "tags":            c["tags"],
            "srs":             default_srs(),
            "stats":           default_stats(),
            "created_at":      now,
        }
        rows.append(row)

    inserted = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i: i + batch]
        r = req_lib.post(
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


# ─── yeshiva.org.il helpers (via Playwright) ──────────────────────────────────

async def fetch_json(page, url: str):
    """Fetch JSON from yeshiva.org.il via browser context (bypasses Cloudflare)."""
    result = await page.evaluate(f'''async () => {{
        const res = await fetch("{url}");
        if (!res.ok) return null;
        return await res.json();
    }}''')
    return result


async def get_tests_for_category(page, cat_id: int) -> list:
    raw = await page.evaluate(f'''async () => {{
        try {{
            const res = await fetch("/api/test/tests?catid={cat_id}");
            return {{ status: res.status, body: await res.text() }};
        }} catch(e) {{
            return {{ error: e.toString() }};
        }}
    }}''')
    if not raw or raw.get("status") not in (200, None):
        print(f"       ⚠️  API response: {raw}")
        return []
    try:
        data = json.loads(raw["body"])
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"       ⚠️  JSON parse error: {e}, body: {str(raw.get('body',''))[:200]}")
        return []


async def get_test_detail(page, test_id: int) -> dict:
    data = await fetch_json(page, f"/api/test/SingleTest?testid={test_id}")
    return data or {}


# ─── Card builder ──────────────────────────────────────────────────────────────

def build_card(question: dict, test_info: dict, masechet: str) -> dict:
    """Convert a yeshiva.org.il question object to a Supabase card dict."""
    test_id    = test_info["id"]
    test_title = test_info.get("title", "")
    mekorot    = test_info.get("mekorot", "")
    is_mc      = test_info.get("american", False)

    tags = [
        f"cat:{masechet}",
        f"yeshiva-test:{test_id}",
    ]
    if mekorot:
        tags.append(f"מקור:{mekorot}")

    q_text = (question.get("question") or "").strip()

    if is_mc and question.get("answers") and question.get("correct"):
        answers         = question["answers"]
        correct_1based  = question["correct"][0]         # 1-based
        correct_0based  = correct_1based - 1             # 0-based for Supabase

        # Validate
        if correct_0based < 0 or correct_0based >= len(answers):
            # Fallback to flashcard if data is malformed
            return {
                "type":     "flashcard",
                "question": q_text,
                "answer":   "",
                "tags":     tags,
            }

        return {
            "type":            "multiple",
            "question":        q_text,
            "answer":          answers[correct_0based],
            "options":         answers,
            "correct_indices": [correct_0based],
            "explanation":     None,
            "tags":            tags,
        }
    else:
        # Open-ended test — store as flashcard (no answer)
        return {
            "type":     "flashcard",
            "question": q_text,
            "answer":   "",
            "tags":     tags,
        }


# ─── Main ──────────────────────────────────────────────────────────────────────

async def run(args):
    masechet = args.masechet
    cat_id   = CATEGORY_MAP.get(masechet)

    if cat_id is None:
        known = ", ".join(sorted(CATEGORY_MAP.keys()))
        sys.exit(f"❌  מסכת לא מוכרת: {masechet}\nמסכתות זמינות:\n{known}")

    print(f"\n📖  מסכת {masechet}  (קטגוריה {cat_id})")
    print("─" * 50)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page    = await browser.new_page()

        # Navigate to the category page once — establishes Cloudflare cookies
        print(f"🌐  טוען דף קטגוריה…")
        await page.goto(f"{YESHIVA_BASE}/test/category/{cat_id}", wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(2)  # Allow Angular/CF scripts to initialize

        # Fetch list of tests
        tests = await get_tests_for_category(page, cat_id)
        pub_tests = [t for t in tests if t.get("pub", True)]
        print(f"🗂️   נמצאו {len(pub_tests)} מבחנים")

        all_cards = []

        for test in pub_tests:
            is_mc = test.get("american", False)
            if not is_mc and not args.include_open:
                print(f"  ⏭️  מדלג מבחן פתוח: {test['id']} — {test.get('title', '')}")
                continue

            print(f"  📋  מבחן {test['id']}: {test.get('title', '')}  ({'רב-ברירה' if is_mc else 'פתוח'})")
            detail = await get_test_detail(page, test["id"])

            questions = detail.get("questions") or []
            if not questions:
                print(f"       ⚠️  אין שאלות")
                continue

            for q in questions:
                card = build_card(q, detail, masechet)
                if card["question"]:   # skip empty questions
                    all_cards.append(card)

            print(f"       ✅ {len(questions)} שאלות")
            await asyncio.sleep(0.4)  # Rate-limit courtesy

        await browser.close()

    print(f"\n📊  סה\"כ כרטיסים: {len(all_cards)}")

    if not all_cards:
        print("⚠️  לא נמצאו כרטיסים לייבוא.")
        return

    if args.dry_run:
        print("\n🔍  DRY RUN — הצגת 3 כרטיסים לדוגמה:")
        for card in all_cards[:3]:
            print(json.dumps(card, ensure_ascii=False, indent=2))
        return

    # ── Import to Supabase ──────────────────────────────────────────────────
    print("\n🔐  מתחבר לסופאבייס…")
    token, user_id = login()
    print("   ✅ מחובר")

    deck_name = args.deck_name or f"מסכת {masechet} — מבחנים"
    deck_id   = create_deck(token, user_id, deck_name, masechet)
    print(f"📦  נוצר deck: {deck_name}  ({deck_id})")

    print(f"\n⬆️  מעלה {len(all_cards)} כרטיסים…")
    inserted = insert_cards(token, user_id, deck_id, all_cards)

    print(f"\n🎉  הושלם! יובאו {inserted} כרטיסים לדק '{deck_name}'")


def main():
    parser = argparse.ArgumentParser(
        description="ייבוא מבחני גמרא מ-yeshiva.org.il לסופאבייס",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--masechet",    required=True,
                        help="שם המסכת בעברית (למשל: פסחים, ברכות, שבת)")
    parser.add_argument("--deck-name",   default=None,
                        help="שם הדק (ברירת-מחדל: 'מסכת X — מבחנים')")
    parser.add_argument("--dry-run",     action="store_true",
                        help="הדפסה בלבד, ללא שמירה בבסיס נתונים")
    parser.add_argument("--include-open", action="store_true",
                        help="כולל מבחנים פתוחים (ללא תשובות — כרטיסיות flashcard)")
    parser.add_argument("--list-masachtot", action="store_true",
                        help="הצג רשימת מסכתות זמינות ויצא")

    args = parser.parse_args()

    if args.list_masachtot:
        print("מסכתות זמינות:")
        for name, cid in sorted(CATEGORY_MAP.items(), key=lambda x: x[1]):
            print(f"  {name:15} (קטגוריה {cid})")
        return

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
