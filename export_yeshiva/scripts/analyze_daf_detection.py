"""
analyze_daf_detection.py
ניתוח כמה שאלות מזהים מסכת / דף / עמוד
"""

import json, re, sys
from pathlib import Path

# ─── regex לזיהוי דף+עמוד בתוך הטקסט ───────────────────────────────────────
# דוגמאות מהנתונים: (ב.), (ג:), (יח.), (י"ח:), (לה.), (מט:), (נ.), (ס"ד.)
# תבנית: סוגר עגול + אותיות עבריות (עם גרשיים אפשריים) + נקודה (ע"א) או נקודותיים (ע"ב)
# אם יש רק אותיות ללא נקודה/ד"נ → דף בלי עמוד (נדיר)

DAF_AMUD_RE = re.compile(
    r'\('                        # פתיחת סוגר
    r'([א-ת][א-ת"\']*)'         # אותיות עבריות (כולל גרש")
    r'([.:])'                    # נקודה = ע"א, נ"ד = ע"ב
)

DAF_ONLY_RE = re.compile(
    r'\('                        # פתיחת סוגר
    r'([א-ת][א-ת"\']*)'         # אותיות עבריות
    r'(?![.:\u05d0-\u05ea])'    # לא אחריו נקודה/ד"נ/אות
)

def classify_question(text: str) -> str:
    """
    מחזיר:
      'daf+amud'  — זוהה דף ועמוד
      'daf_only'  — זוהה דף בלי עמוד
      'none'      — לא זוהה כלום
    """
    if DAF_AMUD_RE.search(text):
        return "daf+amud"
    # בדוק אם יש סוגר עם אותיות עבריות בלבד
    m = re.search(r'\(([א-ת][א-ת"\']*)\)', text)
    if m:
        # וודא שזה לא מילה ארוכה (כגון רש"י, ד"ה וכו')
        val = m.group(1)
        if len(val) <= 4:  # דפים עד ד' אותיות (ג', י"ח, ק"ח)
            return "daf_only"
    return "none"

def extract_daf(text: str) -> tuple[str, str] | None:
    """מחזיר (daf_str, amud) אם נמצא, אחרת None."""
    m = DAF_AMUD_RE.search(text)
    if not m:
        return None
    daf = m.group(1)
    amud = "א" if m.group(2) == "." else "ב"
    return (daf, amud)

def run_analysis(data_path: Path):
    with open(data_path, encoding="utf-8") as f:
        raw = json.load(f)

    # תמיכה בכל הפורמטים:
    #  1. { "tractate": "...", "tests": [...] }  — אובייקט בודד
    #  2. [ { "tractate": "...", "tests": [...] }, ... ]  — רשימה
    #  3. { "ברכות": [...tests...], "עירובין": [...] }  — מילון ישיר
    if isinstance(raw, dict):
        if "tractate" in raw and "tests" in raw:
            # פורמט 1: בוד
            tractate_map = {raw["tractate"]: raw["tests"]}
        else:
            # פורמט 3
            tractate_map = raw
    elif isinstance(raw, list):
        if raw and isinstance(raw[0], dict) and "tractate" in raw[0]:
            # פורמט 2
            tractate_map = {item["tractate"]: item.get("tests", []) for item in raw}
        else:
            sys.exit("פורמט לא מוכר")
    else:
        sys.exit("פורמט לא מוכר")

    # ─── סטטיסטיקות גלובליות ─────────────────────────────────────────────────
    total_q      = 0
    has_daf_amud = 0
    has_daf_only = 0
    has_none     = 0

    per_tractate = {}
    fail_examples = []   # דוגמאות שלא זוהו
    ok_examples   = []   # דוגמאות שזוהו

    for tractate, tests in tractate_map.items():
        t_total = t_daf_amud = t_daf_only = t_none = 0

        for test in (tests if isinstance(tests, list) else [tests]):
            for q in test.get("questions", []):
                text = q.get("question", "")
                t_total += 1
                res = classify_question(text)

                if res == "daf+amud":
                    t_daf_amud += 1
                    daf_info = extract_daf(text)
                    if len(ok_examples) < 3 and daf_info:
                        ok_examples.append((tractate, text[:60], daf_info))
                elif res == "daf_only":
                    t_daf_only += 1
                else:
                    t_none += 1
                    if len(fail_examples) < 5:
                        fail_examples.append((tractate, text[:80]))

        per_tractate[tractate] = (t_total, t_daf_amud, t_daf_only, t_none)
        total_q      += t_total
        has_daf_amud += t_daf_amud
        has_daf_only += t_daf_only
        has_none     += t_none

    # ─── הדפסת דוח ────────────────────────────────────────────────────────────
    sep = "─" * 65
    print(sep)
    print("דוח זיהוי מסכת / דף / עמוד")
    print(sep)
    print(f"{'קובץ:':<20} {data_path.name}")
    print(f"{'מסכתות:':<20} {len(tractate_map)}")
    print(f"{'סה\"כ שאלות:':<20} {total_q}")
    print()

    # ── טבלת מסכתות ──
    print(f"{'מסכת':<14} {'סה\"כ':>5}  {'דף+עמוד':>9}  {'דף בלבד':>9}  {'לא זוהה':>9}")
    print("─" * 55)
    for t, (tot, da, d, n) in per_tractate.items():
        pct_da = f"{100*da/tot:.0f}%" if tot else "-"
        pct_n  = f"{100*n/tot:.0f}%" if tot else "-"
        print(f"{t:<14} {tot:>5}  {da:>5} ({pct_da:>4})  {d:>5} ({'-':>3})  {n:>5} ({pct_n:>4})")

    print(sep)
    print()

    # ── סיכום כולל ──
    pct_full = 100 * has_daf_amud / total_q if total_q else 0
    pct_daf  = 100 * (has_daf_amud + has_daf_only) / total_q if total_q else 0
    pct_none = 100 * has_none / total_q if total_q else 0

    print("סיכום:")
    print(f"  ✅ זוהו מסכת + דף + עמוד:  {has_daf_amud:>4}  ({pct_full:.1f}%)")
    print(f"  🔶 זוהו מסכת + דף בלבד:    {has_daf_only:>4}  ({(has_daf_only*100/total_q if total_q else 0):.1f}%)")
    print(f"  ❌ לא זוהה אפילו דף:        {has_none:>4}  ({pct_none:.1f}%)")
    print()

    print("הערה: המסכת תמיד ידועה מהמבנה של ה-JSON (לא צריך לזהות מהטקסט).")
    print()

    # ── דוגמאות מזוהות ──
    if ok_examples:
        print("דוגמאות שזוהו בהצלחה (מסכת + דף + עמוד):")
        for tractate, snippet, (daf, amud) in ok_examples:
            print(f"  [{tractate}]  דף {daf} עמוד {amud}  ← \"{snippet}...\"")
        print()

    # ── דוגמאות כישלון ──
    if fail_examples:
        print("דוגמאות שלא זוהו:")
        for tractate, snippet in fail_examples:
            print(f"  [{tractate}]  \"{snippet}\"")
        print()

    print(sep)
    print("מסקנות:")
    if pct_full >= 90:
        print("  ✅ הזיהוי עובד מצוין — מעל 90% מהשאלות מכילות הפניה לדף+עמוד בטקסט.")
    elif pct_full >= 70:
        print("  🔶 הזיהוי סביר — כ-70-90% מהשאלות מכילות הפניה.")
    else:
        print("  ❌ הזיהוי חלש — מתחת ל-70% מהשאלות מכילות הפניה.")
    print()
    print("  הקוד הנוכחי (import_yeshiva_to_categories.py) לא מחלץ דף/עמוד בכלל.")
    print("  הוא שומר רק תג מסכת:XXX ומבחן:XXX — ללא פרט הדף/העמוד.")
    print(sep)


if __name__ == "__main__":
    # ברירת מחדל: קובץ הדגימה
    default = Path(__file__).parent.parent / "sample_data" / "brachot_sample.json"
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    if not path.exists():
        sys.exit(f"קובץ לא נמצא: {path}")
    run_analysis(path)
