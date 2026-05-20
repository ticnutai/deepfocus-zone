# מדריך: ייבוא שאלות שמש לסופאבייס
### (Shemesh B'Givon → Supabase Questions Import)

---

## מה יש כאן

```
export_for_friend/
├── scripts/
│   ├── scrape_shemesh_questions.py     ← שלב 1: גרד מ-Firestore של שמש
│   └── import_shemesh_to_categories.py ← שלב 2: העלה לסופאבייס
└── sample_data/
    ├── brachot.json                    ← דוגמה לפלט מברכות (דפים ב-סד)
    └── questions_by_tractate.json      ← אינדקס כולל של כל המסכתות
```

---

## רקע – מאיפה מגים הנתונים

האתר **shemeshbegivon.com** מחזיק שאלות אמריקאיות על הש"ס בתוך Firestore של Google.

### מבנה ה-Firestore:
```
tractates/{masechet}_b                         ← מטה-דאטה על המסכת (שם, סה"כ דפים)
tractates/{masechet}_b/pages/{dף}/questions/q{n}  ← תשובה נכונה (1-based)
hebrew_strings/{masechet}_b_{dף}               ← טקסט השאלה ותשובות הבחירה
  fields: q1, q1_a1, q1_a2, q1_a3, q1_a4, q2, q2_a1, ...
```

- ה-`_b` הסיומת = בבלי (כדי להבדיל מירושלמי)
- דפים מתחילים מ-**2** (אין דף א' בגמרא)

---

## שלב 1 – גרידת השאלות

```bash
pip install requests
python scripts/scrape_shemesh_questions.py
```

**פלט:** תיקייה `output/shemesh_questions/` עם קובץ JSON לכל מסכת.

### מבנה ה-JSON שנוצר:
```json
[
  {
    "tractate": "brachot",
    "daf": 2,
    "questions": [
      {
        "id": "q1",
        "question": "על פי איזה עיקרון...",
        "choices": ["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"],
        "correct_answer_index": 1
      }
    ]
  }
]
```

---

## שלב 2 – ייבוא לסופאבייס

### הכנה – ערוך את `import_shemesh_to_categories.py`:

```python
SUPABASE_URL   = "https://YOUR_PROJECT.supabase.co"   # ← שנה זאת!
ANON_KEY       = "eyJ..."                              # ← anon/service key
ADMIN_EMAIL    = "your@email.com"                      # ← משתמש קיים
ADMIN_PASSWORD = "yourpassword"                        # ← סיסמתו
ROOT_CAT_NAME  = "תלמוד בבלי"                          # ← שם קטגוריית-השורש
```

### טבלאות שחייבות להיות בסופאבייס:
```sql
-- קטגוריות (היררכיה)
CREATE TABLE categories (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  name text NOT NULL,
  parent_id uuid REFERENCES categories(id),
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- כרטיסי לימוד
CREATE TABLE cards (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  deck_id uuid,
  type text CHECK (type IN ('flashcard','multiple','boolean','combo')),
  question text,
  answer text,
  options jsonb,           -- מערך תשובות לשאלות multiple choice
  correct_indices jsonb,   -- [0] / [1] / [2] / [3] (0-based)
  correct_boolean boolean,
  explanation text,
  tags jsonb,              -- ["cat:תלמוד בבלי","cat:ברכות","cat:דף ב"]
  srs jsonb,
  stats jsonb,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

### הרצה:
```bash
# הכל
python scripts/import_shemesh_to_categories.py

# סימולציה בלבד (לא מכניס לDB)
python scripts/import_shemesh_to_categories.py --dry-run

# מסכת אחת בלבד
python scripts/import_shemesh_to_categories.py --masechet brachot
```

### היררכיית הקטגוריות שנוצרת:
```
תלמוד בבלי
├── ברכות
│   ├── דף ב
│   ├── דף ג
│   └── ...
├── שבת
│   ├── דף ב
│   └── ...
└── ...
```

---

## בעיות שנתקלנו בהן ופתרונות

### 1. בעיית שמות הדפים – "ב" מול "ברכות ב"

**הבעיה:**
הדף השני בכל מסכת נשמר בקטגוריה בשם **"דף ב"** בלבד (ללא שם המסכת).
כשיש לך `ברכות > דף ב` ו-`שבת > דף ב`, שם הקטגוריה **"דף ב"** מופיע בשתיהן.

**ההשלכה:**
- ה-**תגיות (tags)** על הכרטיסים נשמרות כ-`"cat:דף ב"` – בלי הפניה למסכת האם.
  אם מחפשים לפי תג בלבד, מקבלים דף ב של **כל** המסכתות.
- ה-**קטגוריות** עצמן בסדר – כי הן מובחנות לפי `parent_id` (ברכות vs שבת).

**הפתרון שיושם:**
`CatManager` שומר את המיפוי `(name, parent_id) → id`, ולכן "דף ב" תחת ברכות ו"דף ב" תחת שבת הם שני רשומות שונות ב-DB.

**פתרון אלטרנטיבי (לא יושם):**
לקרוא לדף "ברכות דף ב" כדי שהתגים יהיו חד-משמעיים.

---

### 2. שמות מסכתות – אנגלית מול עברית

**הבעיה:**
ה-Firestore מחזיר את שם המסכת בשדה `name` כאנגלית רוסית (`brachot`, `bava_kamma` וכו').
בתוך ה-JSON שנוצר, שדה `tractate` הוא האנגלי.

**הפתרון:**
מיפוי קשיח ב-`TRACTATE_HEBREW`:
```python
TRACTATE_HEBREW = {
    "brachot":      "ברכות",
    "shabbat":      "שבת",
    "eruvin":       "עירובין",
    "bava_kamma":   "בבא קמא",
    "bava_metzia":  "בבא מציעא",
    "bava_batra":   "בבא בתרא",
    ...
}
```

⚠️ אם שמש יוסיף מסכת חדשה, צריך להוסיף אותה ידנית למיפוי הזה.

---

### 3. ספירה 1-based מול 0-based בתשובות הנכונות

**הבעיה:**
ה-Firestore שומר את `correct_answer` **1-based** (1=תשובה ראשונה).
המערכת שלנו שומרת **0-based** בשדה `correct_indices`.

**הפתרון בסקריפט:**
```python
# correct_answer is 1-based in Firestore
answers[q_id] = int_val(ca) - 1  # ← מחסר 1
```

---

### 4. דפי גמרא מתחילים מ-2

**הבעיה:**
בגמרא אין דף א – הדף הראשון הוא ב'. הסקריפט חייב לדעת להתחיל מ-2.

**הפתרון:**
```python
for page in range(2, 2 + total_pages):
```

---

### 5. מספרים עבריים – טו / טז במקום יה / יו

**הבעיה:**
בגמטריה סטנדרטית:
- 15 = ט"ו (לא י"ה – כדי לא לכתוב שם ה')
- 16 = ט"ז (לא י"ו)

**הפתרון בפונקציה `to_hebrew_numeral`:**
```python
if remainder == 15:
    result += "טו"
elif remainder == 16:
    result += "טז"
else:
    t = remainder // 10
    o = remainder % 10
    result += _TENS[t] + _ONES[o]
```

---

### 6. כפילויות קטגוריות בריצות חוזרות

**הבעיה:**
בכל הרצה חדשה של הסקריפט, יכלו להיווצר קטגוריות כפולות.

**הפתרון:**
`CatManager` טוען **את כל הקטגוריות הקיימות** בתחילת הריצה ומייצר מפה:
```python
key = (r["name"], r.get("parent_id"))
self._map[key] = r["id"]
```
לפני כל יצירה – בודק אם הצמד `(שם, parent_id)` כבר קיים.

---

### 7. Timeout בהכנסת כרטיסים בכמויות גדולות

**הבעיה:**
מסכת כמו שבת יש בה 150+ דפים × ~5 שאלות = 750+ כרטיסים.
שליחה אחת גדולה לסופאבייס גרמה ל-timeout.

**הפתרון:**
```python
for i in range(0, len(cards), batch_size):  # batch_size=200
    chunk = cards[i:i + batch_size]
    insert_rows(token, "cards", chunk)
```

---

### 8. מסכתות חסרות מ-Firestore

**הבעיה:**
לא כל מסכתות הש"ס קיימות ב-Firestore של שמש.
הסקריפט שולח בקשה ואם חוזר 404 – פשוט ממשיך.

**מסכתות שנמצאו (16 בלבד מתוך 37):**
עבודה זרה, בבא בתרא, בבא קמא, בבא מציעא, ביצה, ברכות,
חגיגה, חולין, עירובין, קידושין, מכות, מגילה, שבת, תענית, יבמות, זבחים

---

## דרישות סביבה

```bash
pip install requests
python 3.10+
```

---

## לוגיקת SRS (Spaced Repetition)

כל כרטיס מתחיל עם מצב ברירת מחדל:
```json
{
  "srs": {
    "interval": 1,
    "easeFactor": 2.5,
    "repetitions": 0,
    "due": "<now>"
  },
  "stats": {
    "totalReviews": 0,
    "correct": 0,
    "incorrect": 0
  }
}
```

אלגוריתם SM-2 (SuperMemo 2) – ה-`interval` וה-`easeFactor` מתעדכנים אחרי כל חזרה.

---

## שאלות נפוצות

**ש: האם הסקריפט יוצר כרטיסים כפולים בהרצה שנייה?**
ת: קטגוריות לא יכופלו (CatManager), אבל **כרטיסים כן** – אין בדיקת כפילות על הכרטיסים עצמם. תריץ רק פעם אחת, או תמחק ידנית לפני הרצה חוזרת.

**ש: איך הדפים ממוינים?**
ת: `sort_order = daf_num` – כלומר דף ב=2, דף ג=3 וכו'. מסכתות ממוינות לפי `TRACTATE_ORDER`.

**ש: מה הפורמט של `options` בטבלת cards?**
ת: מערך JSON של מחרוזות: `["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"]`

**ש: מה הפורמט של `correct_indices`?**
ת: מערך JSON עם אינדקס אחד 0-based: `[0]` / `[1]` / `[2]` / `[3]`
