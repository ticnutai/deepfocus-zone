"""
import_shemesh_to_categories.py
מחלץ שאלות אמריקאיות מ-output/shemesh_questions/ ומכניס לסופאבייס עם
היררכיית קטגוריות: תלמוד בבלי → מסכת → דף

שימוש:
  python scripts/import_shemesh_to_categories.py [--dry-run] [--masechet avodah_zarah]
"""
import json, uuid, os, sys, argparse, time
from datetime import datetime, timezone

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
INPUT_DIR      = "output/shemesh_questions"
ROOT_CAT_NAME  = "תלמוד בבלי"
# ───────────────────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    sys.exit("pip install requests  נדרש")

# ─── Hebrew tractate names ─────────────────────────────────────────────────────
TRACTATE_HEBREW = {
    "avodah_zarah": "עבודה זרה",
    "bava_batra":   "בבא בתרא",
    "bava_kamma":   "בבא קמא",
    "bava_metzia":  "בבא מציעא",
    "beitzah":      "ביצה",
    "brachot":      "ברכות",
    "chagigah":     "חגיגה",
    "chullin":      "חולין",
    "eruvin":       "עירובין",
    "kiddushin":    "קידושין",
    "makkot":       "מכות",
    "megillah":     "מגילה",
    "shabbat":      "שבת",
    "taanit":       "תענית",
    "yevamot":      "יבמות",
    "zevachim":     "זבחים",
}

# Canonical order of tractates (for sort_order)
TRACTATE_ORDER = list(TRACTATE_HEBREW.keys())

# ─── Hebrew numeral helper ─────────────────────────────────────────────────────
_HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"]
_TENS     = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_ONES     = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]

def to_hebrew_numeral(n: int) -> str:
    """Convert positive integer to Hebrew numeral (standard gematria, no divine-name)."""
    if n <= 0:
        return str(n)
    result = ""
    h = n // 100
    remainder = n % 100
    result += _HUNDREDS[h]
    # Special cases to avoid יה / יו
    if remainder == 15:
        result += "טו"
    elif remainder == 16:
        result += "טז"
    else:
        t = remainder // 10
        o = remainder % 10
        result += _TENS[t] + _ONES[o]
    return result

def daf_name(n: int) -> str:
    """Return 'דף ב', 'דף ג', etc."""
    return f"דף {to_hebrew_numeral(n)}"

# ─── Auth + HTTP helpers ───────────────────────────────────────────────────────

def login() -> tuple[str, str]:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]

def hdrs(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

def get_all(token: str, table: str, select: str = "*") -> list[dict]:
    """Fetch all rows (handles pagination via Range header)."""
    rows, offset, page_size = [], 0, 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?select={select}",
            headers={**hdrs(token), "Range": f"{offset}-{offset + page_size - 1}",
                     "Prefer": "count=none"},
            timeout=30,
        )
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows

def insert_rows(token: str, table: str, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**hdrs(token), "Prefer": "return=representation"},
        data=json.dumps(rows),
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"[{table}] insert failed {r.status_code}: {r.text[:300]}")
    return r.json()

def upsert_rows(token: str, table: str, rows: list[dict], on_conflict: str) -> list[dict]:
    if not rows:
        return []
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**hdrs(token),
                 "Prefer": f"return=representation,resolution=merge-duplicates"},
        params={"on_conflict": on_conflict},
        data=json.dumps(rows),
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"[{table}] upsert failed {r.status_code}: {r.text[:300]}")
    return r.json()

# ─── SRS / stats defaults ─────────────────────────────────────────────────────

def default_srs() -> dict:
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0,
            "due": datetime.now(timezone.utc).isoformat()}

def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}

# ─── Category manager ─────────────────────────────────────────────────────────

class CatManager:
    """Maintains an in-memory map of (name, parent_id) -> category_id."""

    def __init__(self, token: str, user_id: str, dry_run: bool):
        self.token   = token
        self.user_id = user_id
        self.dry_run = dry_run
        # (name, parent_id_or_None) -> id
        self._map: dict[tuple[str, str | None], str] = {}
        self._load_existing()

    def _load_existing(self):
        rows = get_all(self.token, "categories", "id,name,parent_id")
        for r in rows:
            key = (r["name"], r.get("parent_id"))
            self._map[key] = r["id"]
        print(f"  [cats] loaded {len(rows)} existing categories")

    def ensure(self, name: str, parent_id: str | None, sort_order: int = 0) -> str:
        """Return existing or create new category id."""
        key = (name, parent_id)
        if key in self._map:
            return self._map[key]

        new_id = str(uuid.uuid4())
        if not self.dry_run:
            insert_rows(self.token, "categories", [{
                "id":        new_id,
                "user_id":   self.user_id,
                "name":      name,
                "parent_id": parent_id,
                "sort_order": sort_order,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }])
        self._map[key] = new_id
        return new_id

    def get(self, name: str, parent_id: str | None) -> str | None:
        return self._map.get((name, parent_id))

# ─── Main import logic ────────────────────────────────────────────────────────

def load_json(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def import_file(path: str, token: str, user_id: str,
                cats: CatManager, root_id: str,
                masechet_order: int, dry_run: bool, batch_size: int = 200):
    data = load_json(path)
    if not data:
        return 0, 0

    tractate_key = data[0]["tractate"]
    masechet_heb = TRACTATE_HEBREW.get(tractate_key, tractate_key)

    # Ensure masechet category
    masechet_id = cats.ensure(masechet_heb, root_id, sort_order=masechet_order)

    # Group by daf
    by_daf: dict[int, list[dict]] = {}
    for page in data:
        daf = page["daf"]
        by_daf.setdefault(daf, []).extend(page["questions"])

    total_cards = 0
    now = datetime.now(timezone.utc).isoformat()

    for daf_num in sorted(by_daf.keys()):
        questions = by_daf[daf_num]
        daf_label = daf_name(daf_num)

        # Ensure daf category
        daf_id = cats.ensure(daf_label, masechet_id, sort_order=daf_num)

        # Build tags (cat: prefix for all 3 levels)
        tags = [f"cat:{ROOT_CAT_NAME}", f"cat:{masechet_heb}", f"cat:{daf_label}"]

        cards = []
        for q in questions:
            cards.append({
                "id":              str(uuid.uuid4()),
                "user_id":         user_id,
                "deck_id":         None,
                "type":            "multiple",
                "question":        q["question"],
                "answer":          None,
                "options":         q["choices"],
                "correct_indices": [q["correct_answer_index"]],
                "correct_boolean": None,
                "explanation":     None,
                "tags":            tags,
                "srs":             default_srs(),
                "stats":           default_stats(),
                "sort_order":      0,
                "created_at":      now,
            })

        if not dry_run:
            for i in range(0, len(cards), batch_size):
                chunk = cards[i:i + batch_size]
                insert_rows(token, "cards", chunk)
        total_cards += len(cards)

    print(f"    {masechet_heb}: {len(by_daf)} דפים, {total_cards} שאלות "
          + ("(dry-run)" if dry_run else "(הוכנסו)"))
    return len(by_daf), total_cards

# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run",   action="store_true", help="סימולציה בלבד, אל תכניס")
    ap.add_argument("--masechet",  default=None,
                    help="הכנס מסכת אחת בלבד (e.g. bava_batra)")
    args = ap.parse_args()

    # Discover JSON files
    files: list[tuple[str, str]] = []  # (tractate_key, path)
    for fname in os.listdir(INPUT_DIR):
        if not fname.endswith(".json") or fname == "questions_by_tractate.json":
            continue
        key = fname.replace(".json", "")
        if args.masechet and key != args.masechet:
            continue
        path = os.path.join(INPUT_DIR, fname)
        files.append((key, path))

    if not files:
        sys.exit(f"לא נמצאו קבצים ב-{INPUT_DIR}")

    # Sort by canonical tractate order (unknown ones go at end)
    files.sort(key=lambda x: TRACTATE_ORDER.index(x[0]) if x[0] in TRACTATE_ORDER else 999)

    print(f"נמצאו {len(files)} קבצים: {[k for k,_ in files]}")
    if args.dry_run:
        print("=== DRY-RUN ===")

    print(f"\nמתחבר כ-{ADMIN_EMAIL}...")
    token, user_id = login()
    print(f"user_id: {user_id}")

    # Load / build category tree
    cats = CatManager(token, user_id, args.dry_run)

    # Ensure root category
    root_id = cats.ensure(ROOT_CAT_NAME, None, sort_order=0)
    print(f"root '{ROOT_CAT_NAME}' id: {root_id}")

    total_dafs = total_cards = 0
    for order_idx, (key, path) in enumerate(files):
        masechet_order = TRACTATE_ORDER.index(key) if key in TRACTATE_ORDER else 999
        d, c = import_file(path, token, user_id, cats, root_id,
                           masechet_order, args.dry_run)
        total_dafs  += d
        total_cards += c

    print(f"\nסה\"כ: {total_dafs} דפים, {total_cards} שאלות"
          + (" (dry-run)" if args.dry_run else " הוכנסו"))

if __name__ == "__main__":
    main()
