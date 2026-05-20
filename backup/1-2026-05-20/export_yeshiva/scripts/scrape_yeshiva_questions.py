"""
scrape_yeshiva_questions.py
גורד שאלות רב-ברירה (אמריקאיות) מאתר yeshiva.org.il לכל המסכתות.

האתר מכיל מבחנים לפי קטגוריות. כל מסכת = קטגוריה עם מספר מבחנים.
כל מבחן מכיל 20-25 שאלות על טווח דפים מסוים.

שימוש:
    python scrape_yeshiva_questions.py
    python scrape_yeshiva_questions.py --masechet ברכות
    python scrape_yeshiva_questions.py --output my_output.json

פלט: yeshiva_questions.json
"""

import argparse
import json
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("חסר: pip install requests")

# ─── API ──────────────────────────────────────────────────────────────────────
YESHIVA_BASE = "https://www.yeshiva.org.il"

# מיפוי שם מסכת ← מזהה קטגוריה באתר ישיבה
# (ניתן להוסיף עוד מסכתות לפי הצורך)
CATEGORY_MAP = {
    "ברכות":     91,
    "עירובין":   93,
    "פסחים":     94,
    "שקלים":     95,
    "ראש השנה":  96,
    "יומא":      97,
    "סוכה":      170,
    "ביצה":      171,
    "תענית":     172,
    "מגילה":     173,
    "מועד קטן":  174,
    "חגיגה":     175,
    "יבמות":     176,
    "כתובות":    98,
    "נדרים":     177,
    "נזיר":      178,
    "סוטה":      179,
    "גיטין":     180,
    "קידושין":   99,
    "בבא קמא":   100,
    "בבא מציעא": 101,
    "בבא בתרא":  102,
    "סנהדרין":   103,
    "מכות":      104,
    "שבועות":    105,
    "עבודה זרה": 106,
    "הוריות":    107,
    "זבחים":     108,
    "מנחות":     109,
    "חולין":     110,
    "בכורות":    111,
    "ערכין":     112,
    "תמורה":     181,
    "כריתות":    182,
    "מעילה":     183,
    "נידה":      184,
}


def fetch_tests_in_category(cat_id: int) -> list[dict]:
    """מחזיר רשימת מבחנים בקטגוריה (רק אמריקאיים)."""
    url = f"{YESHIVA_BASE}/api/test/tests"
    resp = requests.get(url, params={"catid": cat_id}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    tests = data if isinstance(data, list) else data.get("tests", [])
    # סנן רק מבחנים אמריקאיים (רב-ברירה)
    return [t for t in tests if t.get("american") or t.get("type") == "american"]


def fetch_test_questions(test_id: int) -> list[dict]:
    """מחזיר שאלות מבחן ומנרמל לפורמט אחיד."""
    url = f"{YESHIVA_BASE}/api/test/SingleTest"
    resp = requests.get(url, params={"testid": test_id}, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    raw_questions = data.get("questions", [])
    questions = []
    for q in raw_questions:
        # התשובות נמצאות ב-answers[0]..answers[3]
        answers = [q.get(f"answers{i}", "") for i in range(4) if q.get(f"answers{i}")]
        if not answers:
            # פורמט אחר: מפתחות answer1..answer4
            answers = [q.get(f"answer{i}", "") for i in range(1, 5) if q.get(f"answer{i}")]

        correct_raw = q.get("correct", [])
        if isinstance(correct_raw, int):
            correct_raw = [correct_raw]
        # האתר מחזיר 1-based, נמיר ל-0-based
        correct_0based = [c - 1 for c in correct_raw if isinstance(c, int) and c >= 1]

        questions.append({
            "question": q.get("question", ""),
            "answers": answers,
            "correct_index": correct_0based[0] if correct_0based else 0,
        })
    return questions


def scrape_tractate(tractate_name: str, cat_id: int, verbose: bool = True) -> list[dict]:
    """גורד את כל מבחני המסכת ומחזיר רשימת קבוצות שאלות."""
    if verbose:
        print(f"  גורד {tractate_name} (קטגוריה {cat_id})...", end=" ", flush=True)

    try:
        tests = fetch_tests_in_category(cat_id)
    except Exception as e:
        print(f"שגיאה: {e}")
        return []

    groups = []
    for test in tests:
        tid = test.get("id") or test.get("testid")
        if not tid:
            continue
        try:
            questions = fetch_test_questions(int(tid))
        except Exception as e:
            print(f"\n    שגיאה במבחן {tid}: {e}")
            continue

        if not questions:
            continue

        groups.append({
            "test_id": int(tid),
            "title": test.get("title", ""),
            "mekorot": test.get("mekorot", ""),
            "num_questions": len(questions),
            "questions": questions,
        })
        time.sleep(0.3)  # נימוס לשרת

    total = sum(g["num_questions"] for g in groups)
    if verbose:
        print(f"{len(groups)} מבחנים, {total} שאלות")
    return groups


def main():
    parser = argparse.ArgumentParser(description="גרידת שאלות ישיבה")
    parser.add_argument("--masechet", help="שם מסכת בעברית (ברירת מחדל: כולן)")
    parser.add_argument("--output", default="yeshiva_questions.json", help="קובץ פלט")
    args = parser.parse_args()

    if args.masechet:
        if args.masechet not in CATEGORY_MAP:
            sys.exit(f"מסכת לא מוכרת: {args.masechet}\nאפשרויות: {', '.join(CATEGORY_MAP)}")
        tractates_to_scrape = {args.masechet: CATEGORY_MAP[args.masechet]}
    else:
        tractates_to_scrape = CATEGORY_MAP

    result = {}
    print(f"גורד {len(tractates_to_scrape)} מסכתות מ-{YESHIVA_BASE}...")

    for name, cat_id in tractates_to_scrape.items():
        groups = scrape_tractate(name, cat_id)
        if groups:
            result[name] = groups

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    total_q = sum(
        g["num_questions"] for groups in result.values() for g in groups
    )
    print(f"\nנשמר ל-{args.output}")
    print(f"סה\"כ: {len(result)} מסכתות, {total_q} שאלות")


if __name__ == "__main__":
    main()
