from __future__ import annotations

from neviim_extraction_model import extract_reference


TEST_QUESTIONS = [
    {
        "text": "לפי יהושע א:ט, מה מצווה ה' את יהושע? א) לברוח ב) להתחזק ג) לבנות מזבח ד) לשתוק",
        "expected": ("יהושע", 1, 9),
    },
    {
        "text": "בשמואל א פרק יז פסוק ד מתואר גלית כ: א) כהן ב) גיבור פלשתי ג) נביא ד) מלך",
        "expected": ("שמואל א", 17, 4),
    },
    {
        "text": "על פי מלכים ב יט:טו, מה עושה חזקיהו? א) מתפלל ב) בורח ג) שותק ד) כובש",
        "expected": ("מלכים ב", 19, 15),
    },
    {
        "text": "לפי ישעיהו פרק ו פסוק ג, מה אומרים השרפים? א) שמע ישראל ב) קדוש ג) אמן ד) הללויה",
        "expected": ("ישעיה", 6, 3),
    },
    {
        "text": "בירמיהו לא:ב נאמר: א) מצא חן במדבר ב) חרב ג) בצורת ד) גלות",
        "expected": ("ירמיה", 31, 2),
    },
    {
        "text": "בחבקוק ב,ד מה נאמר על הצדיק? א) יתעשר ב) באמונתו יחיה ג) ינצח ד) ימלוך",
        "expected": ("חבקוק", 2, 4),
    },
    {
        "text": "לפי תהלים כג:א, מהו היחס בין ה' לדובר? א) מלך ב) רועה ג) שופט ד) חבר",
        "expected": ("תהלים", 23, 1),
    },
    {
        "text": "באסתר פרק ד פסוק יד, מרדכי אומר לאסתר: א) לשתוק ב) לפעול ג) לברוח ד) להתפטר",
        "expected": ("אסתר", 4, 14),
    },
    {
        "text": "בנחמיה פרק ב פסוקים יז-יח, מה עושה נחמיה? א) בונה חומה ב) עוזב ג) כותב שיר ד) נרדם",
        "expected": ("נחמיה", 2, 17),
    },
    {
        "text": "בדברי הימים ב לו:כג, מה מצהיר כורש? א) עלייה לבבל ב) בניין בית ה' בירושלים ג) מלחמה ד) מפקד",
        "expected": ("דברי הימים ב", 36, 23),
    },
]


def main() -> None:
    success = 0

    for i, item in enumerate(TEST_QUESTIONS, start=1):
        expected_book, expected_ch, expected_vs = item["expected"]
        result = extract_reference(item["text"])

        is_ok = (
            result.canonical_book == expected_book
            and result.chapter == expected_ch
            and result.verse_start == expected_vs
        )

        if is_ok:
            success += 1

        status = "OK" if is_ok else "MISS"
        print(
            f"[{i:02}] {status} | "
            f"book={result.canonical_book} ch={result.chapter} verse={result.verse_start} "
            f"conf={result.confidence:.2f} strategy={result.strategy} options={len(result.options)}"
        )

    print("\n=== Summary ===")
    print(f"Matched: {success}/{len(TEST_QUESTIONS)}")


if __name__ == "__main__":
    main()
