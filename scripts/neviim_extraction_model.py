from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Optional


NACH_BOOK_ALIASES: dict[str, list[str]] = {
    "יהושע": ["יהושע"],
    "שופטים": ["שופטים"],
    "שמואל א": ["שמואל א", "שמואל א'", "שמואל א׳", "שמואל א."],
    "שמואל ב": ["שמואל ב", "שמואל ב'", "שמואל ב׳", "שמואל ב."],
    "מלכים א": ["מלכים א", "מלכים א'", "מלכים א׳", "מלכים א."],
    "מלכים ב": ["מלכים ב", "מלכים ב'", "מלכים ב׳", "מלכים ב."],
    "ישעיה": ["ישעיה", "ישעיהו"],
    "ירמיה": ["ירמיה", "ירמיהו"],
    "יחזקאל": ["יחזקאל"],
    "הושע": ["הושע"],
    "יואל": ["יואל"],
    "עמוס": ["עמוס"],
    "עובדיה": ["עובדיה"],
    "יונה": ["יונה"],
    "מיכה": ["מיכה"],
    "נחום": ["נחום"],
    "חבקוק": ["חבקוק"],
    "צפניה": ["צפניה"],
    "חגי": ["חגי"],
    "זכריה": ["זכריה"],
    "מלאכי": ["מלאכי"],
    "תהלים": ["תהלים", "תהילים"],
    "משלי": ["משלי"],
    "איוב": ["איוב"],
    "שיר השירים": ["שיר השירים"],
    "רות": ["רות"],
    "איכה": ["איכה"],
    "קהלת": ["קהלת"],
    "אסתר": ["אסתר"],
    "דניאל": ["דניאל"],
    "עזרא": ["עזרא"],
    "נחמיה": ["נחמיה"],
    "דברי הימים א": ["דברי הימים א", "דברי הימים א'", "דברי הימים א׳"],
    "דברי הימים ב": ["דברי הימים ב", "דברי הימים ב'", "דברי הימים ב׳"],
}

ALIAS_TO_BOOK: dict[str, str] = {}
for canonical, aliases in NACH_BOOK_ALIASES.items():
    for alias in aliases:
        ALIAS_TO_BOOK[alias] = canonical

BOOK_ALIAS_PATTERN = "|".join(sorted((re.escape(a) for a in ALIAS_TO_BOOK), key=len, reverse=True))
# תומך גם באותיות יחס צמודות לשם הספר: ב/ל/כ/מ/ו/ש (לדוגמה: בשמואל, בירמיהו)
BOOK = rf"(?<![א-ת])(?:[בלכמשו])?(?P<book>(?:{BOOK_ALIAS_PATTERN}))(?![א-ת])"
NUM = r"(?P<{name}>[0-9א-ת\"׳״']+)"

HEB_LETTER_VALUES = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
    "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200,
    "ש": 300, "ת": 400,
}


@dataclass
class ExtractionResult:
    canonical_book: Optional[str]
    chapter: Optional[int]
    verse_start: Optional[int]
    verse_end: Optional[int]
    confidence: float
    strategy: Optional[str]
    options: list[str]


def _normalize_num_token(token: str) -> str:
    token = token.strip()
    return token.replace('"', "").replace("׳", "").replace("״", "").replace("'", "")


def hebrew_numeral_to_int(token: str) -> Optional[int]:
    token = _normalize_num_token(token)
    if not token:
        return None
    if token.isdigit():
        return int(token)
    total = 0
    for ch in token:
        val = HEB_LETTER_VALUES.get(ch)
        if val is None:
            return None
        total += val
    return total if total > 0 else None


def extract_options(question_text: str) -> list[str]:
    text = re.sub(r"\s+", " ", question_text)
    pattern = re.compile(r"(?:^|\s)([אבגדה])\s*[\)\].:-]?\s*(.{1,160}?)(?=(?:\s[אבגדה]\s*[\)\].:-]?\s)|$)")
    options = [m.group(2).strip() for m in pattern.finditer(text)]
    return options[:5] if len(options) >= 2 else []


def extract_reference(question_text: str) -> ExtractionResult:
    text = re.sub(r"\s+", " ", question_text)
    options = extract_options(text)

    patterns = [
        (
            re.compile(rf"{BOOK}\s+" + NUM.format(name="chapter") + r"\s*[:.,]\s*" + NUM.format(name="verse") + r"(?:\s*[-–]\s*" + NUM.format(name="verse2") + r")?"),
            "book_chapter_verse_colon",
            0.96,
        ),
        (
            re.compile(rf"{BOOK}.{{0,40}}?פרק\s+" + NUM.format(name="chapter") + r".{{0,25}}?פסוק(?:ים)?\s+" + NUM.format(name="verse") + r"(?:\s*[-–]\s*" + NUM.format(name="verse2") + r")?"),
            "book_perek_pasuk",
            0.94,
        ),
        (
            re.compile(rf"{BOOK}.{{0,25}}?\(" + NUM.format(name="chapter") + r"\s*[,.:]\s*" + NUM.format(name="verse") + r"(?:\s*[-–]\s*" + NUM.format(name="verse2") + r")?\)"),
            "book_parenthesized_ref",
            0.92,
        ),
        (
            re.compile(rf"{BOOK}.{{0,35}}?פרק\s+" + NUM.format(name="chapter")),
            "book_perek_only",
            0.65,
        ),
        (
            re.compile(rf"{BOOK}"),
            "book_only",
            0.3,
        ),
    ]

    for regex, strategy, confidence in patterns:
        m = regex.search(text)
        if not m:
            continue

        alias = m.group("book")
        canonical_book = ALIAS_TO_BOOK.get(alias)

        chapter = hebrew_numeral_to_int(m.groupdict().get("chapter")) if m.groupdict().get("chapter") else None
        verse_start = hebrew_numeral_to_int(m.groupdict().get("verse")) if m.groupdict().get("verse") else None
        verse_end = hebrew_numeral_to_int(m.groupdict().get("verse2")) if m.groupdict().get("verse2") else verse_start

        return ExtractionResult(
            canonical_book=canonical_book,
            chapter=chapter,
            verse_start=verse_start,
            verse_end=verse_end,
            confidence=confidence,
            strategy=strategy,
            options=options,
        )

    return ExtractionResult(
        canonical_book=None,
        chapter=None,
        verse_start=None,
        verse_end=None,
        confidence=0.0,
        strategy=None,
        options=options,
    )
