"""
import_shas_full.py  —  ייבוא מלא של ש"ס לסופאבייס
=======================================================
מבנה יעד:  תלמוד בבלי  →  37 מסכתות  →  דפים (ב' עד הסוף)
מקורות שאלות:
  1) output/shemesh_questions/*.json  (daf = מספר שלם, correct_answer_index = 0-based)
  2) scripts/yeshiva_all.json.gz      (correct = 1-based, דף מתוך הסוגריים בשאלה)

שימוש:
  python scripts/import_shas_full.py [--dry-run] [--skip-delete] [--skip-shemesh] [--skip-yeshiva]
"""

import argparse, gzip, json, os, re, sys, uuid, time
from datetime import datetime, timezone
from collections import defaultdict

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

# ─── Config ───────────────────────────────────────────────────────────────────
SUPABASE_URL   = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
                  "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
                  "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"

ROOT_CAT_NAME   = "תלמוד בבלי"
SHEMESH_DIR     = "output/shemesh_questions"
YESHIVA_GZ      = "scripts/yeshiva_all.json.gz"
BATCH_SIZE      = 500

# ─── Standard Bavli last-daf table ────────────────────────────────────────────
STANDARD_LAST_DAF: dict[str, int] = {
    "ברכות": 64,   "שבת": 157,    "עירובין": 105,  "פסחים": 121,
    "שקלים": 22,   "יומא": 88,    "סוכה": 56,      "ביצה": 40,
    "ראש השנה": 35,"תענית": 31,   "מגילה": 32,     "מועד קטן": 29,
    "חגיגה": 27,
    "יבמות": 122,  "כתובות": 112, "נדרים": 91,     "נזיר": 66,
    "סוטה": 49,    "גיטין": 90,   "קידושין": 82,
    "בבא קמא": 119,"בבא מציעא": 119,"בבא בתרא": 176,
    "סנהדרין": 113,"מכות": 24,    "שבועות": 49,    "עבודה זרה": 76,
    "הוריות": 14,
    "זבחים": 120,  "מנחות": 110,  "חולין": 142,    "בכורות": 61,
    "ערכין": 34,   "תמורה": 34,   "כריתות": 28,    "מעילה": 22,
    "תמיד": 33,    "נידה": 73,
}

# Canonical masechet order (for sort_order)
MASECHET_ORDER = list(STANDARD_LAST_DAF.keys())

# shemesh English key → Hebrew name
SHEMESH_KEY_TO_HEB: dict[str, str] = {
    "avodah_zarah": "עבודה זרה",  "bava_batra":  "בבא בתרא",
    "bava_kamma":   "בבא קמא",    "bava_metzia": "בבא מציעא",
    "beitzah":      "ביצה",       "brachot":     "ברכות",
    "chagigah":     "חגיגה",      "chullin":     "חולין",
    "eruvin":       "עירובין",    "kiddushin":   "קידושין",
    "makkot":       "מכות",       "megillah":    "מגילה",
    "shabbat":      "שבת",        "taanit":      "תענית",
    "yevamot":      "יבמות",      "zevachim":    "זבחים",
}

# ─── Hebrew numeral → int ──────────────────────────────────────────────────────
_HEB_VAL: dict[str, int] = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ל": 30, "מ": 40, "נ": 50, "ס": 60, "ע": 70, "פ": 80, "צ": 90,
    "ק": 100, "ר": 200, "ש": 300, "ת": 400,
    "ך": 20, "ם": 40, "ן": 50, "ף": 80, "ץ": 90,  # final letters
}

def heb_to_int(s: str) -> int | None:
    """Convert Hebrew numeral string (like 'כג' or 'קה') to integer. None if unparseable."""
    s = s.replace('"', "").replace("'", "")  # strip geresh / gershayim
    if not s:
        return None
    total = 0
    for ch in s:
        v = _HEB_VAL.get(ch)
        if v is None:
            return None
        total += v
    return total if total > 0 else None

# int → Hebrew numeral (for daf category names)
_HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"]
_TENS     = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_ONES     = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]

def int_to_heb(n: int) -> str:
    result = _HUNDREDS[n // 100]
    r = n % 100
    if r == 15:   result += "טו"
    elif r == 16: result += "טז"
    else:         result += _TENS[r // 10] + _ONES[r % 10]
    return result

def daf_label(n: int) -> str:
    return f"דף {int_to_heb(n)}"

# ─── Daf extraction from yeshiva question text ────────────────────────────────
# Questions look like: "...מה הדין? (כג. רש"י ד"ה ...)" or just "(ה:)"
# Strategy: find last (...) group, look for HEB_NUM followed by . or :
_DAF_RE = re.compile(
    r"\(([א-ת\"']+)[.:]\s*[^)]*\)\s*$"   # (HEBNUM. ...) at end
    r"|"
    r"\(([א-ת\"']+)[.:]\)"                 # (HEBNUM.) anywhere
)

def extract_daf_from_question(text: str) -> int | None:
    """Try to extract daf number from parenthetical refs like (ב.) (כג:) at end of question."""
    # Try end of string first (most reliable)
    for m in re.finditer(r"\(([א-ת\"'ךםןףץ]+)[.:][^)]*\)", text):
        val = heb_to_int(m.group(1))
        if val and 2 <= val <= 200:
            last_match_val = val
    else:
        # return last match found
        found = re.findall(r"\(([א-ת\"'ךםןףץ]+)[.:][^)]*\)", text)
        if found:
            for s in reversed(found):
                v = heb_to_int(s)
                if v and 2 <= v <= 200:
                    return v
    return None

def extract_daf_safe(text: str) -> int | None:
    found = re.findall(r"\(([א-ת\"'ךםןףץ]+)[.:]", text)
    if not found:
        return None
    for s in reversed(found):
        v = heb_to_int(s)
        if v and 2 <= v <= 200:
            return v
    return None

def section_title_to_first_daf(title: str) -> int | None:
    """Extract first daf from title like 'דפים ב'-י"ז' → 2."""
    m = re.search(r"([א-ת\"'ךםןףץ]+)['\u05F3]?\s*[-–]", title)
    if not m:
        # single daf: "דף כ"
        m2 = re.search(r"דף\s+([א-ת\"'ךםןףץ]+)", title)
        if m2:
            return heb_to_int(m2.group(1))
        return None
    return heb_to_int(m.group(1))

# ─── HTTP helpers ─────────────────────────────────────────────────────────────
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
    }

def exec_sql(token: str, sql: str, label: str = "") -> None:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
        headers=hdrs(token),
        json={"query": sql},
        timeout=120,
    )
    if not r.ok:
        raise RuntimeError(f"exec_sql [{label}] {r.status_code}: {r.text[:400]}")
    body = r.json()
    if isinstance(body, dict) and not body.get("success", True):
        raise RuntimeError(f"exec_sql [{label}] SQL error: {body.get('error', body)}")

def _pg_literal(val) -> str:
    """Convert a Python value to a PostgreSQL literal string."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        escaped = val.replace("'", "''")
        return f"'{escaped}'"
    if isinstance(val, list):
        # JSON array literal
        escaped = json.dumps(val, ensure_ascii=False).replace("'", "''")
        return f"'{escaped}'::jsonb"
    if isinstance(val, dict):
        escaped = json.dumps(val, ensure_ascii=False).replace("'", "''")
        return f"'{escaped}'::jsonb"
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"

# Columns to upsert (update on conflict) for cards — excludes srs/stats to preserve progress
_CARD_UPSERT_COLS = ["tags", "options", "correct_indices"]
# Exact conflict target matching the cards_unique_question_per_deck expression index
_CARDS_CONFLICT = ("user_id, "
                   "(COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid)), "
                   "(md5(trim(question)))")

def insert_batch_sql(token: str, table: str, rows: list[dict],
                     upsert: bool = False) -> int:
    """Insert rows using exec_sql.  For cards, upsert=True updates tags/options/answer on conflict."""
    if not rows:
        return 0
    cols = list(rows[0].keys())
    col_list = ", ".join(f'"{c}"' for c in cols)
    value_rows = []
    for row in rows:
        vals = ", ".join(_pg_literal(row[c]) for c in cols)
        value_rows.append(f"  ({vals})")
    if upsert and table == "cards":
        update_set = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in _CARD_UPSERT_COLS)
        conflict = (f"ON CONFLICT ({_CARDS_CONFLICT})\n"
                    f"DO UPDATE SET {update_set}")
    else:
        conflict = "ON CONFLICT DO NOTHING"
    sql = (f'INSERT INTO {table} ({col_list})\nVALUES\n'
           + ",\n".join(value_rows)
           + f"\n{conflict};")
    exec_sql(token, sql, f"insert-{table}")
    return len(rows)

def insert_batch(token: str, table: str, rows: list[dict]) -> int:
    """Insert rows via REST API (for tables without expression-based unique indexes)."""
    if not rows:
        return 0
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**hdrs(token), "Prefer": "return=minimal"},
        data=json.dumps(rows),
        timeout=120,
    )
    if not r.ok:
        raise RuntimeError(f"insert [{table}] {r.status_code}: {r.text[:400]}")
    return len(rows)

def get_rows(token: str, table: str, select: str = "*",
             params: dict | None = None) -> list[dict]:
    rows, offset = [], 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**hdrs(token), "Range": f"{offset}-{offset+999}",
                     "Prefer": "count=none"},
            params={"select": select, **(params or {})},
            timeout=30,
        )
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    return rows

# ─── Phase 1: Delete existing tree ────────────────────────────────────────────
def delete_existing_tree(token: str, dry_run: bool) -> None:
    print(f"\n{'[DRY-RUN] ' if dry_run else ''}מוחק עץ קיים תחת '{ROOT_CAT_NAME}'...")
    # Step 1: delete all cards with the root tag (tags is jsonb, must use jsonb literal)
    _tag_json = json.dumps([f"cat:{ROOT_CAT_NAME}"]).replace("'", "''")
    sql_cards = f"""
        DELETE FROM cards
        WHERE tags @> '{_tag_json}'::jsonb;
    """
    # Step 2: delete entire category subtree recursively
    sql_cats = f"""
        WITH RECURSIVE subtree AS (
          SELECT id FROM categories WHERE name = '{ROOT_CAT_NAME}'
          UNION ALL
          SELECT c.id FROM categories c
          JOIN subtree s ON c.parent_id = s.id
        )
        DELETE FROM categories WHERE id IN (SELECT id FROM subtree);
    """
    if dry_run:
        print("  (dry-run: SQL not executed)")
    else:
        exec_sql(token, sql_cards, "delete-cards")
        print("  ✓ cards מחוקים")
        exec_sql(token, sql_cats, "delete-categories")
        print("  ✓ categories מחוקים")

# ─── Phase 2: Build category tree ─────────────────────────────────────────────
def build_category_tree(token: str, user_id: str,
                        dry_run: bool) -> dict[tuple[str, int], str]:
    """
    Returns dap_cat_ids: {(masechet_heb, daf_num): category_id}
    Also returns (root_id, {masechet_heb: masechet_id}) in a side dict.
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"\n{'[DRY-RUN] ' if dry_run else ''}בונה עץ קטגוריות...")

    root_id = str(uuid.uuid4())
    masechet_ids: dict[str, str] = {}   # heb → id
    daf_cat_ids:  dict[tuple[str, int], str] = {}  # (heb, daf_num) → id

    cat_rows: list[dict] = []
    # Root
    cat_rows.append({
        "id": root_id, "user_id": user_id, "name": ROOT_CAT_NAME,
        "parent_id": None, "sort_order": 0, "created_at": now,
    })

    for m_order, mas_heb in enumerate(MASECHET_ORDER):
        last_daf = STANDARD_LAST_DAF[mas_heb]
        mas_id = str(uuid.uuid4())
        masechet_ids[mas_heb] = mas_id
        cat_rows.append({
            "id": mas_id, "user_id": user_id, "name": mas_heb,
            "parent_id": root_id, "sort_order": m_order, "created_at": now,
        })
        # Dapim ב' → last_daf
        for daf_num in range(2, last_daf + 1):
            daf_id = str(uuid.uuid4())
            daf_cat_ids[(mas_heb, daf_num)] = daf_id
            cat_rows.append({
                "id": daf_id, "user_id": user_id, "name": daf_label(daf_num),
                "parent_id": mas_id, "sort_order": daf_num, "created_at": now,
            })

    total_cats = len(cat_rows)
    print(f"  {total_cats:,} קטגוריות: 1 שורש + {len(MASECHET_ORDER)} מסכתות + דפים")

    SQL_BATCH = 200  # smaller batches for SQL VALUES clauses
    if not dry_run:
        for i in range(0, len(cat_rows), SQL_BATCH):
            insert_batch_sql(token, "categories", cat_rows[i:i+SQL_BATCH])
            print(f"  ↑ categories {min(i+SQL_BATCH, total_cats)}/{total_cats}", end="\r")
        print()
        print("  ✓ קטגוריות הוכנסו")

    return daf_cat_ids, root_id, masechet_ids

# ─── SRS defaults ─────────────────────────────────────────────────────────────
def srs_default() -> dict:
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0,
            "due": datetime.now(timezone.utc).isoformat()}

def stats_default() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}

# ─── Phase 3: Import Shemesh questions ────────────────────────────────────────
import hashlib

def _q_hash(question: str) -> str:
    """Hash of trimmed question text — matches the DB unique constraint md5(trim(question))."""
    return hashlib.md5(question.strip().encode()).hexdigest()

SQL_BATCH = 100  # rows per exec_sql VALUES clause (cards can be large)

def import_shemesh(token: str, user_id: str,
                   daf_cat_ids: dict[tuple[str, int], str],
                   dry_run: bool,
                   seen_q: set[str]) -> int:
    print(f"\n{'[DRY-RUN] ' if dry_run else ''}מייבא שאלות Shemesh...")
    now = datetime.now(timezone.utc).isoformat()
    total = 0
    skipped = 0
    duped = 0

    for fname in sorted(os.listdir(SHEMESH_DIR)):
        if not fname.endswith(".json") or fname == "questions_by_tractate.json":
            continue
        key = fname.replace(".json", "")
        mas_heb = SHEMESH_KEY_TO_HEB.get(key)
        if not mas_heb:
            print(f"  [skip] {fname} — no Hebrew mapping")
            continue

        pages: list[dict] = json.load(open(
            os.path.join(SHEMESH_DIR, fname), encoding="utf-8"))

        # Group by daf
        by_daf: dict[int, list[dict]] = defaultdict(list)
        for page in pages:
            by_daf[page["daf"]].extend(page["questions"])

        cards: list[dict] = []
        for daf_num, questions in by_daf.items():
            daf_id = daf_cat_ids.get((mas_heb, daf_num))
            if not daf_id:
                skipped += len(questions)
                continue

            tags = [f"cat:{ROOT_CAT_NAME}", f"cat:{mas_heb}",
                    f"cat:{daf_label(daf_num)}", "מקור:shemesh"]

            for q in questions:
                qh = _q_hash(q["question"])
                if qh in seen_q:
                    duped += 1
                    continue
                seen_q.add(qh)
                cards.append({
                    "id":              str(uuid.uuid4()),
                    "user_id":         user_id,
                    "deck_id":         None,
                    "type":            "multiple",
                    "question":        q["question"],
                    "answer":          None,
                    "options":         q["choices"],
                    "correct_indices": [q["correct_answer_index"]],  # 0-based
                    "correct_boolean": None,
                    "explanation":     None,
                    "tags":            tags,
                    "srs":             srs_default(),
                    "stats":           stats_default(),
                    "sort_order":      0,
                    "created_at":      now,
                })

        if not dry_run:
            for i in range(0, len(cards), SQL_BATCH):
                insert_batch_sql(token, "cards", cards[i:i+SQL_BATCH], upsert=True)

        print(f"  {mas_heb}: {len(by_daf)} דפים, {len(cards)} שאלות"
              + (f" [dry-run]" if dry_run else ""))
        total += len(cards)

    print(f"  ✓ Shemesh: {total:,} שאלות | {skipped} מחוץ לטווח | {duped} כפילויות")
    return total

# ─── Phase 4: Import Yeshiva questions ────────────────────────────────────────
def import_yeshiva(token: str, user_id: str,
                   daf_cat_ids: dict[tuple[str, int], str],
                   dry_run: bool,
                   seen_q: set[str]) -> int:
    print(f"\n{'[DRY-RUN] ' if dry_run else ''}מייבא שאלות Yeshiva.org.il...")
    now = datetime.now(timezone.utc).isoformat()

    with gzip.open(YESHIVA_GZ, "rt", encoding="utf-8") as f:
        data: dict[str, dict] = json.load(f)

    total = 0
    no_daf = 0
    out_of_range = 0

    for mas_heb, sections in data.items():
        if mas_heb not in STANDARD_LAST_DAF:
            print(f"  [skip-mas] '{mas_heb}' not in standard list")
            continue

        # cards grouped by daf
        by_daf: dict[int, list[dict]] = defaultdict(list)
        # fallback daf from section title
        sec_fallback: dict[str, int | None] = {}

        for sec_id, sec in sections.items():
            # section-level fallback daf
            fb = section_title_to_first_daf(sec.get("title", ""))
            sec_fallback[sec_id] = fb

            questions = sec.get("questions") or []
            for q in questions:
                daf_num = extract_daf_safe(q.get("question", ""))
                if daf_num is None:
                    daf_num = fb  # fallback to section first-daf
                if daf_num is None:
                    no_daf += 1
                    continue
                # correct: 1-based list → 0-based
                correct_raw = q.get("correct", [1])
                correct_indices = [max(0, c - 1) for c in correct_raw]
                by_daf[daf_num].append({
                    "question":        q["question"],
                    "options":         q["answers"],
                    "correct_indices": correct_indices,
                })

        cards: list[dict] = []
        for daf_num, qs in by_daf.items():
            daf_id = daf_cat_ids.get((mas_heb, daf_num))
            if not daf_id:
                out_of_range += len(qs)
                continue

            tags = [f"cat:{ROOT_CAT_NAME}", f"cat:{mas_heb}",
                    f"cat:{daf_label(daf_num)}", "מקור:yeshiva"]

            for q in qs:
                qh = _q_hash(q["question"])
                if qh in seen_q:
                    continue
                seen_q.add(qh)
                cards.append({
                    "id":              str(uuid.uuid4()),
                    "user_id":         user_id,
                    "deck_id":         None,
                    "type":            "multiple",
                    "question":        q["question"],
                    "answer":          None,
                    "options":         q["options"],
                    "correct_indices": q["correct_indices"],
                    "correct_boolean": None,
                    "explanation":     None,
                    "tags":            tags,
                    "srs":             srs_default(),
                    "stats":           stats_default(),
                    "sort_order":      0,
                    "created_at":      now,
                })

        if not dry_run:
            for i in range(0, len(cards), SQL_BATCH):
                insert_batch_sql(token, "cards", cards[i:i+SQL_BATCH], upsert=True)

        print(f"  {mas_heb}: {len(by_daf)} דפים, {len(cards)} שאלות"
              + (" [dry-run]" if dry_run else ""))
        total += len(cards)

    print(f"  ✓ Yeshiva: {total:,} שאלות | ללא דף: {no_daf} | מחוץ לטווח: {out_of_range}")
    return total

# ─── Main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="ייבוא מלא של ש\"ס לסופאבייס")
    ap.add_argument("--dry-run",       action="store_true", help="סימולציה — ללא כתיבה")
    ap.add_argument("--skip-delete",   action="store_true", help="אל תמחק עץ קיים")
    ap.add_argument("--skip-shemesh",  action="store_true", help="דלג על שאלות Shemesh")
    ap.add_argument("--skip-yeshiva",  action="store_true", help="דלג על שאלות Yeshiva")
    args = ap.parse_args()

    t0 = time.time()
    print("=" * 60)
    print("  ייבוא מלא של ש\"ס לסופאבייס")
    print("=" * 60)
    if args.dry_run:
        print("  *** DRY-RUN — לא יתבצע כתיבה ***")

    print(f"\nמתחבר כ-{ADMIN_EMAIL}...")
    token, user_id = login()
    print(f"✓ user_id: {user_id}")

    if not args.skip_delete:
        delete_existing_tree(token, args.dry_run)

    daf_cat_ids, root_id, masechet_ids = build_category_tree(
        token, user_id, args.dry_run)

    total_cards = 0
    seen_q: set[str] = set()  # cross-source dedup by md5(trim(question))
    if not args.skip_shemesh:
        total_cards += import_shemesh(token, user_id, daf_cat_ids, args.dry_run, seen_q)
    if not args.skip_yeshiva:
        total_cards += import_yeshiva(token, user_id, daf_cat_ids, args.dry_run, seen_q)

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"  ✅ הושלם {'(dry-run) ' if args.dry_run else ''}ב-{elapsed:.1f}s")
    print(f"  קטגוריות: 1 שורש + {len(MASECHET_ORDER)} מסכתות + {sum(STANDARD_LAST_DAF[m]-1 for m in MASECHET_ORDER):,} דפים")
    print(f"  שאלות שהוכנסו: {total_cards:,}")
    print("=" * 60)

if __name__ == "__main__":
    main()
