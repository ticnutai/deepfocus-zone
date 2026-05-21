"""
shas_cat_utils.py
─────────────────
כלי עזר משותפים לסיווג כרטיסי ש"ס לפי דף ועמוד.
מיובא על ידי כל connector (yeshiva, משגבעון, ...).

כלל הסיווג (חובה לכל מקור):
  1. זוהה דף + עמוד  →  ברכות · ב. · ע"א   (הכי מדויק)
  2. זוהה דף בלבד    →  ברכות · ב.
  3. לא זוהה דף      →  ברכות · ללא סיווג

שמות הקטגוריות מאוחסנים כ-"נתיב מלא" (ייחודי בין מסכתות),
ו-displayCategoryName() של האפליקציה מציג רק את החלק האחרון.
"""

import re

# ─── PATH_SEP — תואם shasGen.ts של האפליקציה ────────────────────────────────
PATH_SEP = " \u00b7 "   # space + U+00B7 MIDDLE DOT + space

# ─── AMUD_LABELS — תואם AMUD_LABELS ב-shasGen.ts ─────────────────────────────
AMUD_LABELS = ('ע"א', 'ע"ב')  # amud א = index 0, amud ב = index 1

# ─── גמטריה — המרת מספר דף לאותיות עבריות ───────────────────────────────────
_GEM_HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"]
_GEM_TENS     = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
_GEM_ONES     = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]

def int_to_gematria(n: int) -> str:
    """ממיר מספר דף לאותיות גמטריה: 2→'ב', 18→'יח', 120→'קכ' (ללא שמות ה'/י"ו)."""
    if n <= 0:
        return str(n)
    result = _GEM_HUNDREDS[n // 100]
    remainder = n % 100
    if remainder == 15:
        result += "טו"
    elif remainder == 16:
        result += "טז"
    else:
        result += _GEM_TENS[remainder // 10] + _GEM_ONES[remainder % 10]
    return result

# ─── רגקס לחילוץ דף+עמוד מטקסט שאלה ─────────────────────────────────────────
# פורמט: (ב.) = דף ב עמוד א | (ג:) = דף ג עמוד ב
# תומך בגרש: (י"ח.) (ל"ג:) (ס"ד.)
_DAF_AMUD_RE = re.compile(r'\(([\u05d0-\u05ea][\u05d0-\u05ea"\']*)[.:]')


def extract_daf_amud(text: str) -> tuple[str, str] | None:
    """
    מחלץ (daf_str, amud_letter) מתוך טקסט שאלה.
    daf_str:   אותיות גמטריה של הדף, כגון 'ב', 'יח', 'לג'
    amud_letter: 'א' לנקודה (עמוד א), 'ב' לנקודותיים (עמוד ב)
    מחזיר None אם לא נמצא דף.
    """
    m = _DAF_AMUD_RE.search(text)
    if not m:
        return None
    daf = m.group(1)
    amud = 'א' if text[m.start(1) + len(daf)] == '.' else 'ב'
    return (daf, amud)


# ─── שמות קטגוריות ────────────────────────────────────────────────────────────

def daf_category_name(masechet: str, daf: str) -> str:
    """
    שם קטגוריית דף: 'ברכות · ב.'
    (displayCategoryName יציג: 'ב.')
    """
    return f'{masechet}{PATH_SEP}{daf}.'


def amud_category_name(masechet: str, daf: str, amud: str) -> str:
    """
    שם קטגוריית עמוד: 'ברכות · ב. · ע"א'
    (displayCategoryName יציג: 'ע"א')
    """
    return f'{daf_category_name(masechet, daf)}{PATH_SEP}{amud_tag(amud)}'


def uncat_category_name(masechet: str) -> str:
    """
    שם קטגוריית ברירת מחדל: 'ברכות · ללא סיווג'
    (displayCategoryName יציג: 'ללא סיווג')
    """
    return f'{masechet}{PATH_SEP}ללא סיווג'


def amud_tag(amud: str) -> str:
    """
    תג עמוד: ע"א / ע"ב  (פורמט AMUD_LABELS של האפליקציה, ASCII double-quote)
    """
    return f'ע"{amud}'


# ─── פונקציית סיווג מרכזית ────────────────────────────────────────────────────

def resolve_card_category(masechet: str, question_text: str) -> tuple[str, str | None]:
    """
    מחזיר (cat_full_name, amud_letter | None) לפי כלל הסיווג:
      - דף + עמוד זוהו  →  (amud_category_name, amud_letter)
      - דף בלבד          →  (daf_category_name, None)
      - לא זוהה          →  (uncat_category_name, None)

    שימוש:
        cat_name, amud = resolve_card_category('ברכות', q['question'])
    """
    daf_info = extract_daf_amud(question_text)
    if daf_info:
        daf, amud = daf_info
        return amud_category_name(masechet, daf, amud), amud
    return uncat_category_name(masechet), None
