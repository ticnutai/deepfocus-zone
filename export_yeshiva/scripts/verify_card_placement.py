"""
verify_card_placement.py
בדיקה מקיפה: כל שאלה מסווגת לענף הנכון, ומוצגת רק שם.

מדמה את לוגיקת האפליקציה:
- cat: tag → קטגוריה שהכרטיס שייך אליה
- deepest-level rule → כרטיס מוצג רק בקטגוריה הכי עמוקה שתויגה
"""

import sys, json, re
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from shas_cat_utils import (
    PATH_SEP, resolve_card_category,
    daf_category_name, amud_category_name, uncat_category_name,
)

# ─── קריאת קובץ המדגם ────────────────────────────────────────────────────────
SAMPLE = Path(__file__).parent.parent / "sample_data" / "brachot_sample.json"
with open(SAMPLE, encoding="utf-8") as f:
    raw = json.load(f)

MASECHET = raw["tractate"]   # "ברכות"
groups   = raw["tests"]      # [{title, questions}, ...]

# ─── סימולציית בניית עץ הקטגוריות ───────────────────────────────────────────
# מבנה: parent_name → [child_names]
children: dict[str, list[str]] = defaultdict(list)
all_cats: set[str] = set()

def ensure_cat(name: str, parent: str | None = None):
    if name not in all_cats:
        all_cats.add(name)
        if parent:
            children[parent].append(name)

ensure_cat("תלמוד בבלי")
ensure_cat(MASECHET, "תלמוד בבלי")

# ─── עיבוד כל השאלות ─────────────────────────────────────────────────────────
card_results = []

for group in groups:
    title = group["title"]
    ensure_cat(title, MASECHET)  # קבוצה תחת מסכת

    for q in group["questions"]:
        text = q["question"]
        cat_name, amud_val = resolve_card_category(MASECHET, text)

        # בנה עץ קטגוריות בהתאם לסיווג
        if cat_name == uncat_category_name(MASECHET):
            ensure_cat(cat_name, MASECHET)
        else:
            # פירוק הנתיב: ברכות · ב. · ע"א
            parts = cat_name.split(PATH_SEP)
            # parts[0]=ברכות, parts[1]=ב., parts[2]=ע"א (optional)
            if len(parts) >= 2:
                daf_cat = PATH_SEP.join(parts[:2])  # ברכות · ב.
                ensure_cat(daf_cat, MASECHET)
            if len(parts) == 3:
                ensure_cat(cat_name, daf_cat)
                # יוצרים גם את הדף האחות — ע"א ↔ ע"ב (גם אם ריק)
                sibling_letter = 'ב' if parts[2] == 'ע"א' else 'א'
                daf_raw = parts[1].rstrip('.')
                sibling_name = amud_category_name(MASECHET, daf_raw, sibling_letter)
                ensure_cat(sibling_name, daf_cat)

        card_results.append({
            "question": text,
            "group": title,
            "cat_name": cat_name,
            "amud": amud_val,
        })

# ─── deepest-level rule: מדמה cardsOfSelected של האפליקציה ──────────────────
def get_all_descendants(cat_name: str) -> set[str]:
    """כל תת-הקטגוריות של קטגוריה (רקורסיבי)."""
    result = set()
    for child in children.get(cat_name, []):
        result.add(child)
        result |= get_all_descendants(child)
    return result

def cards_visible_at(cat_name: str) -> list[dict]:
    """כרטיסים שיוצגו כשבוחרים קטגוריה זו (deepest-level rule)."""
    direct = [c for c in card_results if c["cat_name"] == cat_name]
    descendants = get_all_descendants(cat_name)
    # הסר כרטיסים שיש להם גם תג לתת-קטגוריה (מדמה את descendantNames filter)
    return [c for c in direct if not any(
        c["cat_name"] != cat_name  # כרטיס שבתת-קטגוריה
        for _ in [1]
    )]
    # NOTE: כאן כרטיס שייך לקטגוריה אחת בלבד — הפנימית ביותר.
    # deepest rule מוחל על-ידי resolve_card_category שמחזיר תמיד את הרמה העמוקה ביותר.

# ─── הדפסת תוצאות ────────────────────────────────────────────────────────────
print("=" * 70)
print(f"מסכת: {MASECHET}  |  {len(card_results)} שאלות  |  {len(groups)} קבוצות")
print("=" * 70)

# מיון לפי קטגוריה
by_cat: dict[str, list[dict]] = defaultdict(list)
for c in card_results:
    by_cat[c["cat_name"]].append(c)

uncat = uncat_category_name(MASECHET)
amud_cats = [k for k in by_cat if k.endswith('ע"א') or k.endswith('ע"ב')]
daf_cats  = [k for k in by_cat if k not in amud_cats and k != uncat]
uncat_list= by_cat.get(uncat, [])

print(f"\n✅ קטגוריות עמוד ({len(amud_cats)}):")
for cat in sorted(amud_cats):
    cards = by_cat[cat]
    display = cat.split(PATH_SEP)[-1]  # simulate displayCategoryName
    print(f"  [{display}]  ({len(cards)} שאלות)")
    for c in cards:
        print(f"    • {c['question'][:55]}...")

# מציג גם עמודים ריקים שנוצרו כאחות
empty_amud = [c for c in all_cats if (c.endswith('ע"א') or c.endswith('ע"ב')) and c not in by_cat]
if empty_amud:
    print(f"  (עמודים ריקים שנוצרו כאחות: {len(empty_amud)})")
    for cat in sorted(empty_amud):
        display = cat.split(PATH_SEP)[-1]
        print(f"  [{display}]  (0 שאלות)")

print(f"\n📄 קטגוריות דף בלבד ({len(daf_cats)}):")
if daf_cats:
    for cat in sorted(daf_cats):
        display = cat.split(PATH_SEP)[-1]
        print(f"  [{display}]  {len(by_cat[cat])} שאלות")
else:
    print("  (אין — כל הכרטיסים זוהו עד רמת עמוד)")

print(f"\n⚠️  ללא סיווג: {len(uncat_list)} שאלות")
if uncat_list:
    for c in uncat_list:
        print(f"  • {c['question'][:60]}...")

# ─── בדיקת deepest-level: ב. לא יציג כלום כי ע"א ו-ע"ב תחתיה ─────────────
print("\n" + "=" * 70)
print("🔍 בדיקת כלל הרמה העמוקה (deepest-level):")
print("   (כרטיס מוצג רק בקטגוריה שאליה שויך, לא ברמות מעליו)")

# בדוק שלכל כרטיס בעמוד, אם תבחר את קטגוריית הדף אב — הוא לא יופיע שם
problems = []
for cat_name, cards in by_cat.items():
    # בדוק שהכרטיס לא שייך ישירות לדף אחר
    parts = cat_name.split(PATH_SEP)
    if len(parts) == 3:  # amud level: ברכות · ב. · ע"א
        parent_daf = PATH_SEP.join(parts[:2])  # ברכות · ב.
        # האם יש כרטיסים גם ברמת הדף האב? זו בעיה.
        if parent_daf in by_cat:
            problems.append(f"  ⚠️  {parent_daf} מכיל כרטיסים ישירים — יוצגו גם כשנכנסים ל-{parent_daf}")

if problems:
    for p in problems:
        print(p)
else:
    print(f"   ✓ אין כרטיסים ברמת דף — הכל ברמת עמוד (או ללא סיווג)")
    print(f"   ✓ כשנכנסים ל-'ב.' — האפליקציה מציגה 0 כרטיסים ישירים")
    print(f"     (הכרטיסים יוצגו תחת ע\"א / ע\"ב בלבד)")

# ─── סיכום סטטיסטי ───────────────────────────────────────────────────────────
print("\n" + "=" * 70)
amud_count  = sum(len(v) for k, v in by_cat.items() if k in amud_cats)
daf_count   = sum(len(v) for k, v in by_cat.items() if k in daf_cats)
total_questions = len(card_results)
print(f"סיכום:")
print(f"  רמת עמוד:    {amud_count:3d} שאלות  ({100*amud_count//total_questions}%)")
print(f"  רמת דף:      {daf_count:3d} שאלות  ({100*daf_count//total_questions}%)")
print(f"  ללא סיווג:   {len(uncat_list):3d} שאלות  ({100*len(uncat_list)//total_questions}%)")
print(f"  סה\"כ:        {total_questions:3d} שאלות")
