# מדריך: ייבוא שאלות ישיבה לסופאבייס
### (Yeshiva.org.il → Supabase Questions Import)

---

## מה יש כאן

```
export_yeshiva/
├── scripts/
│   ├── scrape_yeshiva_questions.py      ← שלב 1: גרד מאתר ישיבה
│   └── import_yeshiva_to_categories.py  ← שלב 2: העלה לסופאבייס
└── sample_data/
    ├── brachot_sample.json              ← דוגמה לפלט מברכות (5 שאלות ראשונות)
    └── tractates_index.json             ← אינדקס כולל: 35 מסכתות, 3,525 שאלות
```

---

## רקע – מאיפה מגיעים הנתונים

האתר **yeshiva.org.il** מכיל מבחני גמרא רב-ברירה (אמריקאיים) לכל הש"ס.

### מבנה הנתונים באתר:
```
GET /api/test/tests?catid=91        ← רשימת מבחנים לקטגוריה (מסכת)
GET /api/test/SingleTest?testid=290 ← שאלות מבחן מסוים
```

- כל **מסכת** = קטגוריה עם `catid` ייחודי (ראה `CATEGORY_MAP` בסקריפט)
- כל מסכת מחולקת ל**קבוצות דפים** (מבחנים), למשל: "דפים ב'-י"ז", "דפים י"ח-ל"ב"
- כל קבוצה מכילה **20–25 שאלות** רב-ברירה עם 4 אפשרויות

### סטטיסטיקות (נכון למאי 2026):
| נתון | ערך |
|------|-----|
| מסכתות | 35 |
| קבוצות דפים (מבחנים) | ~175 |
| סה"כ שאלות | **3,525** |
| מקור | גמרא + רש"י |

---

## מבנה ה-JSON שנוצר

```json
{
  "ברכות": [
    {
      "test_id": 290,
      "title": "דפים ב'-י\"ז",
      "mekorot": "גמרא ורש\"י על מסכת ברכות, דפים ב'-י\"ז",
      "num_questions": 20,
      "questions": [
        {
          "question": "הקטר חלבים ואיברים - עד אימת זמן מצותן?",
          "answers": [
            "עד חצות.",
            "עד שיעלה עמוד השחר.",
            "מדאורייתא עד שיעלה עמוד השחר וחכמים אמרו עד חצות.",
            "עד הנץ החמה."
          ],
          "correct_index": 2
        }
      ]
    }
  ]
}
```

**שדות השאלה:**
- `question` — טקסט השאלה (כולל ציון מקום בגמרא)
- `answers` — 4 תשובות אפשריות
- `correct_index` — אינדקס 0-based של התשובה הנכונה

---

## שלב 1 – גרידת השאלות

### התקנה:
```bash
pip install requests
```

### הרצה:
```bash
# כל המסכתות (לוקח ~5 דקות)
python scripts/scrape_yeshiva_questions.py

# מסכת אחת בלבד
python scripts/scrape_yeshiva_questions.py --masechet ברכות

# שמור לקובץ שם אחר
python scripts/scrape_yeshiva_questions.py --output my_data.json
```

### פלט:
קובץ `yeshiva_questions.json` עם כל השאלות לכל המסכתות.

### מסכתות זמינות:
```
ברכות, עירובין, פסחים, שקלים, ראש השנה, יומא, סוכה, ביצה, תענית,
מגילה, מועד קטן, חגיגה, יבמות, כתובות, נדרים, נזיר, סוטה, גיטין,
קידושין, בבא קמא, בבא מציעא, בבא בתרא, סנהדרין, מכות, שבועות,
עבודה זרה, הוריות, זבחים, מנחות, חולין, בכורות, ערכין, תמורה,
כריתות, מעילה, נידה
```

---

## שלב 2 – ייבוא לסופאבייס

### הכנה — ערוך את `import_yeshiva_to_categories.py`:

```python
SUPABASE_URL   = "https://YOUR_PROJECT.supabase.co"   # ← שנה זאת!
ANON_KEY       = "eyJ..."                              # ← anon/service key
ADMIN_EMAIL    = "your@email.com"                      # ← משתמש קיים
ADMIN_PASSWORD = "yourpassword"                        # ← סיסמתו
ROOT_CAT_NAME  = "תלמוד בבלי"                          # ← שם קטגוריית-השורש
```

### טבלאות שחייבות להיות בסופאבייס:

```sql
-- קטגוריות (היררכיה: שורש → מסכת → קבוצת דפים)
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users,
  name text NOT NULL,
  parent_id uuid REFERENCES categories(id),
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- כרטיסי לימוד
CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users,
  deck_id uuid REFERENCES categories(id),
  type text CHECK (type IN ('flashcard', 'multiple', 'boolean')),
  question text,
  answer text,                  -- התשובה הנכונה בטקסט
  options jsonb,                -- מערך 4 תשובות אפשריות
  correct_indices jsonb,        -- [2] (0-based index)
  correct_boolean boolean,
  tags jsonb,
  source text,
  notes text,
  created_at timestamptz DEFAULT now()
);
```

### הרצה:
```bash
# בדיקת יובש (לא כותב לבסיס הנתונים)
python scripts/import_yeshiva_to_categories.py --json yeshiva_questions.json --dry-run

# ייבוא מלא
python scripts/import_yeshiva_to_categories.py --json yeshiva_questions.json

# ייבוא מסכת אחת בלבד
python scripts/import_yeshiva_to_categories.py --json yeshiva_questions.json --masechet ברכות
```

### מה נוצר בסופאבייס:
```
categories:
  תלמוד בבלי              ← שורש
    ├── ברכות              ← מסכת
    │     ├── דפים ב'-י"ז  ← קבוצת שאלות (deck_id עבור הכרטיסים)
    │     ├── דפים י"ח-ל"ב
    │     └── ...
    ├── עירובין
    └── ...

cards (לכל שאלה):
  type = "multiple"
  question = "טקסט השאלה"
  options = ["א","ב","ג","ד"]
  correct_indices = [2]
  tags = ["מסכת:ברכות", "מבחן:דפים ב'-י\"ז", "yeshiva.org.il"]
```

---

## מבנה ה-JSON המלא (tractates_index.json)

קובץ `sample_data/tractates_index.json` מכיל אינדקס מלא של כל המסכתות והמבחנים שנאספו, ללא תוכן השאלות עצמן — שימושי לסקירה מהירה.

```json
[
  {
    "tractate": "ברכות",
    "total_questions": 80,
    "test_groups": [
      { "test_id": 290, "title": "דפים ב'-י\"ז", "num_questions": 20 },
      { "test_id": 291, "title": "דפים י\"ח-ל\"ב", "num_questions": 20 },
      ...
    ]
  },
  ...
]
```

---

## הערות חשובות

1. **זכויות יוצרים**: תוכן השאלות שייך לאתר yeshiva.org.il. השתמש לצרכים אישיים/לימודיים בלבד.
2. **קצב גרידה**: הסקריפט מחכה 0.3 שניות בין בקשות כדי לא להעמיס על השרת.
3. **זמינות API**: ה-API ציבורי אך לא מתועד רשמית — ייתכן שישתנה.
4. **תשובה נכונה**: השדה `correct_index` הוא **0-based** (0=ראשונה, 1=שנייה...).
5. **מקור הנתונים**: כל שאלה מציינת את מקומה בגמרא (לדוגמה: "ב. רש"י ד"ה...").
