"""
import_yoma_hard_questions.py
מכניס 10 שאלות קשות (diff:5) על יומא דף ב עמוד א לסופאבייס.
קטגוריות: תלמוד בבלי → יומא → ב → א
תגיות: source:custom, diff:5
"""
import json, uuid, sys
from datetime import datetime, timezone

SUPABASE_URL   = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON_KEY       = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
                  "InJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQi"
                  "OjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy"
                  "451NO0N37rz7yjcpXYc")
ADMIN_EMAIL    = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"

try:
    import requests
except ImportError:
    sys.exit("pip install requests  נדרש")

# ─── Auth ──────────────────────────────────────────────────────────────────────

def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]

def hdrs(token):
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

# ─── Category helpers ──────────────────────────────────────────────────────────

def get_categories(token):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/categories?select=id,name,parent_id",
        headers={**hdrs(token), "Prefer": "count=none"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

def find_category(token, name, parent_id):
    """חפש קטגוריה לפי שם + parent (לפי parent_id מפורש)."""
    if parent_id is None:
        url = (f"{SUPABASE_URL}/rest/v1/categories"
               f"?select=id&name=eq.{requests.utils.quote(name)}&parent_id=is.null")
    else:
        url = (f"{SUPABASE_URL}/rest/v1/categories"
               f"?select=id&name=eq.{requests.utils.quote(name)}"
               f"&parent_id=eq.{parent_id}")
    r = requests.get(url, headers={**hdrs(token), "Prefer": "count=none"}, timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0]["id"] if rows else None


def ensure_category(token, user_id, name, parent_id, cat_map, sort_order=0):
    key = (name, parent_id)
    if key in cat_map:
        return cat_map[key]
    # Try to find existing first (list may have been truncated)
    existing = find_category(token, name, parent_id)
    if existing:
        cat_map[key] = existing
        print(f"  📂 קטגוריה קיימת: {name} (id={existing[:8]}…)")
        return existing
    new_id = str(uuid.uuid4())
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/categories",
        headers={**hdrs(token), "Prefer": "return=representation"},
        json=[{
            "id":         new_id,
            "user_id":    user_id,
            "name":       name,
            "parent_id":  parent_id,
            "sort_order": sort_order,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }],
        timeout=30,
    )
    if r.status_code == 409:
        # Race condition — fetch what's there
        existing = find_category(token, name, parent_id)
        if existing:
            cat_map[key] = existing
            print(f"  📂 קטגוריה קיימת (409): {name} (id={existing[:8]}…)")
            return existing
        raise RuntimeError(f"create category 409 but can't find it: {r.text[:300]}")
    if not r.ok:
        raise RuntimeError(f"create category failed {r.status_code}: {r.text[:300]}")
    created = r.json()
    actual_id = created[0]["id"] if created else new_id
    cat_map[key] = actual_id
    print(f"  ✅ נוצרה קטגוריה: {name} (id={actual_id[:8]}…)")
    return actual_id

# ─── SRS / stats defaults ──────────────────────────────────────────────────────

def default_srs():
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0,
            "due": datetime.now(timezone.utc).isoformat()}

def default_stats():
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}

# ─── 10 שאלות קשות ────────────────────────────────────────────────────────────

QUESTIONS = [
    {
        "question": "מי הם שני האמוראים שנחלקו אם מקור פרישת ז' ימים לכהן גדול הוא מג\"ש או מגזירה שווה מסיני?",
        "options": [
            "רב חסדא ורב פפא",
            "רב מניומי בר חלקיה ורב חסדא בר מניומי",
            "אביי ורבא",
            "עולא ורב נחמן",
        ],
        "correct_index": 1,
        "explanation": "הגמרא (ב ע\"א) מביאה את רב מניומי בר חלקיה ורב חסדא בר מניומי שנחלקו אם הפסוק 'כַּאֲשֶׁר עָשָׂה בַּיּוֹם הַזֶּה' הוא המקור, או שמא מג\"ש 'ביום' 'ביום' ממשה בסיני.",
    },
    {
        "question": "מהי הג\"ש שמביאה הגמרא לפרישת ז' ימים לכהן גדול מסיני?",
        "options": [
            "ביום–ביום: מ'מִמָּחֳרַת הַשַּׁבָּת' לפרשת המלואים",
            "ביום–ביום: מ'וּבַיּוֹם הַשְּׁמִינִי' בפרשת שמיני לפרשת אחרי מות",
            "ויקם–ויקם: ממשה ובני ישראל",
            "קדשת–קדשת: משבת ליום כיפור",
        ],
        "correct_index": 1,
        "explanation": "הגמרא לומדת ג\"ש 'בַּיּוֹם' 'בַּיּוֹם' מ'וּבַיּוֹם הַשְּׁמִינִי' (ויקרא ט, א) לפרשת 'בַּיּוֹם הַזֶּה' (ויקרא טז, ב) — כשם שמשה הפריש את אהרן ז' ימים, כך לדורות.",
    },
    {
        "question": "הגמרא שואלת מדוע לא נלמד מ'ויהי ביום השמיני' שנזכר פעמיים. מה תשובת הגמרא?",
        "options": [
            "כי הפסוק השני עוסק בסיני ולא בדורות",
            "כי שניהם נאמרו בפרשה אחת ואין גזירה שווה מפרשה לעצמה",
            "כי 'ויהי' מיותר ואינו לג\"ש",
            "כי הג\"ש נאמרה למשה הלכה למשה מסיני ולא מפסוק",
        ],
        "correct_index": 1,
        "explanation": "הגמרא מסבירה שאין למדים מ'ויהי' (בדרך כלל לשון צרה) ושלא דורשים ג\"ש ממקום למקום בפרשה אחת — כי שני המקומות שייכים לאותה פרשת מלואים.",
    },
    {
        "question": "מה הסברה הפנימית שנותנת הגמרא לכך שמפרישים דווקא שבעה ימים ולא פחות?",
        "options": [
            "כדי שיחזור בתשובה שלמה",
            "שמא תראה אשתו כנידה ויצטרך ז' ימי טהרה",
            "כנגד שבעת ימי הסוכות",
            "כנגד שבעה כוהנים שמסייעים לו ביום כיפור",
        ],
        "correct_index": 1,
        "explanation": "רב יוסף בר מניומי אמר משמיה דרב נחמן: 'שֶׁמָּא תִּרְאֶה אִשְׁתּוֹ כְּנִדָּה וְיִצְטָרֵךְ לְהַפְרִישׁוֹ שִׁבְעָה' — ז' ימי ספירה לנידה.",
    },
    {
        "question": "מה הקשר שמביאה הגמרא בין פרישת כהן גדול לסדר מלואים בפרק 'ויהי ביום השמיני'?",
        "options": [
            "שניהם כוללים חמישה קורבנות",
            "משה הפריש את אהרן ובניו שבעת ימים — כמכשיר ליום השמיני",
            "שניהם דורשים לבישת ח' בגדים",
            "שניהם מחייבים שמירת ז' ימי אבל לפני",
        ],
        "correct_index": 1,
        "explanation": "הגמרא (ב ע\"א) מקישה: 'מָה לְהַלָּן מָשֶׁה הִפְרִישׁ אֶת אַהֲרֹן וּבָנָיו שִׁבְעַת יָמִים לְמַה שֶּׁהֵם עֲתִידִין לַעֲשׂוֹת — אַף כָּאן מַפְרִישִׁין'.",
    },
    {
        "question": "מי הוא הכהן שנוצר תחת הכהן הגדול שנפסל, ומה מעמדו אחרי יום הכיפורים?",
        "options": [
            "חוזר לכהונה גדולה כשהראשון ייפגע",
            "אינו חוזר לא לכהונה גדולה ולא לכהונה הדיוטית",
            "חוזר לכהונה הדיוטית בלבד",
            "נשאר כהן גדול לצמיתות",
        ],
        "correct_index": 2,
        "explanation": "הגמרא: 'מוֹשִׁיבִין אוֹתוֹ אֶלָּא אֵינוֹ עוֹשֶׂה כְּלוּם... לֹא כְּכֹהֵן גָּדוֹל וְלֹא כְּכֹהֵן הֶדְיוֹט'. אבל הרמב\"ם והראשונים נחלקו — חלקם אומרים שחוזר לכהונה הדיוטית.",
    },
    {
        "question": "מה הטעם שנתנה הגמרא לכך שלשכת פרהדרין (ולא מקום אחר) היא מקום פרישת הכהן הגדול?",
        "options": [
            "כי היא נמצאת בחצר המקדש הפנימי",
            "כי פרהדרין הם שומרי הכהן הגדול",
            "לא נתנה הגמרא טעם — זו גזירת חכמים",
            "כי נמצאת בצפון ועתיד לכפר על שבטי הצפון",
        ],
        "correct_index": 2,
        "explanation": "הגמרא על יומא ב ע\"א אינה מנמקת מדוע דווקא לשכת פרהדרין — הדבר הוא תקנת חכמים, ורש\"י מפרש שם שהיא ליד בית אבטינס.",
    },
    {
        "question": "מהי ה'לשכת הגזית' ומה קשרה ללשכת פרהדרין לפי הגמרא?",
        "options": [
            "הן אותה לשכה — כינויים שונים לאותו מקום",
            "לשכת הגזית היא לסנהדרין ולשכת פרהדרין לכהן גדול — שתיהן בהר הבית",
            "לשכת הגזית הפכה ללשכת פרהדרין אחרי החורבן",
            "לשכת הגזית היא ביהודה ולשכת פרהדרין בגליל",
        ],
        "correct_index": 1,
        "explanation": "הגמרא ביומא ב ע\"א מבחינה בין לשכות שונות; הסנהדרין ישבה בלשכת הגזית (בחצר ישראל), ואילו לשכת פרהדרין הוקצתה לכהן הגדול לפרישתו שנמצאת בחצר הכהנים.",
    },
    {
        "question": "על אלו שני מקרים של 'פסול' חוששת המשנה כשאומרת 'שמא יארע בו פסול'?",
        "options": [
            "שיחלה או יפסל מחמת טומאה",
            "שיגרש אשתו או שישתגע",
            "שישבות ממלאכה או שיאבל",
            "שיטמא או שיחלוק על הסנהדרין",
        ],
        "correct_index": 0,
        "explanation": "הגמרא (ב ע\"א) מפרשת 'פסול' בשני פנים: (א) טומאת מת בשוגג/אונס, (ב) חולי שמונעו מהכניסה לקודש. שני הפסולים מחייבים כהן אחר זמין.",
    },
    {
        "question": "מהו מקור הדין שהכהן השורף את הפרה האדומה צריך טבילה ביום, ומה הייתה מחלוקת הצדוקים?",
        "options": [
            "תורה שבכתב: 'ורחץ בשרו במים' — הצדוקים אמרו שאינו צריך טבילה כלל",
            "תורה שבעל פה — הצדוקים אמרו שהשורף צריך להיות טהור לגמרי כבר לפני הדלקה",
            "הצדוקים דרשו שרק 'הערב שמש' כשר לשרוף — ולא 'טבול יום'; חכמים חלקו",
            "הצדוקים אמרו שהשורף פסול לעולם; חכמים אמרו שכשר",
        ],
        "correct_index": 2,
        "explanation": "הצדוקים אמרו שהפרה נשרפת רק עם 'הערב שמש' (שהשמש שקעה לגמרי = טהור גמור), ולא ע\"י 'טבול יום'. חכמים מכוונים לטמאות את הכהן ולהטבילו כדי להוכיח שהדין הוא שטבול יום כשר.",
    },
]

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("🔐 מתחבר לסופאבייס…")
    token, user_id = login()
    print(f"✅ מחובר (user_id={user_id[:8]}…)")

    print("📂 טוען קטגוריות…")
    cats = get_categories(token)
    cat_map = {}
    for c in cats:
        key = (c["name"], c.get("parent_id"))
        cat_map[key] = c["id"]
    print(f"  נטענו {len(cats)} קטגוריות")

    # Build hierarchy: תלמוד בבלי → יומא → ב → א
    root_id = ensure_category(token, user_id, "תלמוד בבלי", None,    cat_map, sort_order=0)
    yoma_id = ensure_category(token, user_id, "יומא",       root_id, cat_map, sort_order=6)
    daf_id  = ensure_category(token, user_id, "ב",           yoma_id, cat_map, sort_order=2)
    amud_id = ensure_category(token, user_id, "א",           daf_id,  cat_map, sort_order=1)

    print(f"\n📁 היררכיה:")
    print(f"  תלמוד בבלי → {root_id[:8]}…")
    print(f"  יומא        → {yoma_id[:8]}…")
    print(f"  ב            → {daf_id[:8]}…")
    print(f"  א            → {amud_id[:8]}…")

    now = datetime.now(timezone.utc).isoformat()
    cards = []
    for q in QUESTIONS:
        cards.append({
            "id":              str(uuid.uuid4()),
            "user_id":         user_id,
            "deck_id":         None,
            "type":            "multiple",
            "question":        q["question"],
            "answer":          None,
            "options":         q["options"],
            "correct_indices": [q["correct_index"]],
            "correct_boolean": None,
            "explanation":     q["explanation"],
            "tags":            [f"cat:{amud_id}", "source:custom", "diff:5"],
            "srs":             default_srs(),
            "stats":           default_stats(),
            "sort_order":      0,
            "masechta":        "יומא",
            "daf":             2,
            "amud":            1,
            "created_at":      now,
        })

    print(f"\n📤 מכניס {len(cards)} כרטיסים קשים (diff:5)…")
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/cards",
        headers=hdrs(token),
        json=cards,
        timeout=60,
    )
    if not r.ok:
        print(f"❌ שגיאה: {r.status_code}: {r.text[:400]}")
        sys.exit(1)

    print(f"\n✅ הוכנסו {len(cards)} שאלות קשות על יומא ב עמוד א!")
    print("   תגיות: source:custom, diff:5")

if __name__ == "__main__":
    main()
