"""
import_yoma_2a_questions.py
מכניס 10 שאלות אמריקאיות על יומא דף ב עמוד א ישירות לסופאבייס.
קטגוריות: תלמוד בבלי → יומא → ב → א
תגית: source:custom
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

def ensure_category(token, user_id, name, parent_id, cat_map, sort_order=0):
    """מחזיר ID של קטגוריה קיימת או יוצר חדשה."""
    key = (name, parent_id)
    if key in cat_map:
        return cat_map[key]

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

# ─── 10 שאלות ─────────────────────────────────────────────────────────────────

QUESTIONS = [
    {
        "question": "כמה ימים לפני יום הכיפורים מפרישים את הכהן הגדול מביתו?",
        "options": ["יום אחד", "שלושה ימים", "שבעה ימים", "ארבעה עשר ימים"],
        "correct_index": 2,
        "explanation": "המשנה פותחת: 'שִׁבְעַת יָמִים קוֹדֶם יוֹם הַכִּפּוּרִים מַפְרִישִׁין כֹּהֵן גָּדוֹל מִבֵּיתוֹ'."
    },
    {
        "question": "לאן מעבירים את הכהן הגדול בשבעת הימים שלפני יום כיפור?",
        "options": ["ללשכת בית האבן", "ללשכת פרהדרין", "לצפון מזרח העזרה", "לביתו של הנשיא"],
        "correct_index": 1,
        "explanation": "המשנה קובעת שמפרישים את הכהן הגדול 'לְלִשְׁכַּת פַּרְהֶדְרִין'."
    },
    {
        "question": "מדוע מתקינים כהן אחר תחת הכהן הגדול לפני יום כיפור?",
        "options": ["כדי שיסייע לו בעבודה", "שמא יארע בו פסול", "כי כן הלכה מסיני", "כדי שהעם יבחר בו"],
        "correct_index": 1,
        "explanation": "המשנה: 'וּמַתְקִינִין לוֹ כֹּהֵן אַחֵר תַּחְתָּיו שֶׁמָּא יֶאֱרַע בּוֹ פְּסוּל'."
    },
    {
        "question": "מה היא דעת רבי יהודה לגבי הכנות נוספות לכהן הגדול לפני יום כיפור?",
        "options": ["שיכינו לו בגדי כהונה נוספים", "שיתקינו לו אישה אחרת שמא תמות אשתו", "שיכינו לו כהן גדול שני כגיבוי", "שיישאר בביתו עד יום כיפור"],
        "correct_index": 1,
        "explanation": "ר' יהודה: 'אַף אִשָּׁה אַחֶרֶת מַתְקִינִין לוֹ, שֶׁמָּא תָּמוּת אִשְׁתּוֹ'."
    },
    {
        "question": "מה פירוש 'ביתו' בפסוק 'וְכִפֶּר בַּעֲדוֹ וּבְעַד בֵּיתוֹ'?",
        "options": ["בית המגורים שלו", "משפחתו הרחבה", "אשתו", "בית המקדש"],
        "correct_index": 2,
        "explanation": "הגמרא דורשת: '\"בֵּיתוֹ\" — זוֹ אִשְׁתּוֹ' (ויקרא טז, ו)."
    },
    {
        "question": "מה תשובת חכמים לשיטת רבי יהודה בדבר הכנת אישה נוספת?",
        "options": ["הסכימו לדבריו לגמרי", "אמרו שאם כן אין לדבר סוף", "אמרו שאסור להכין אישה נוספת", "אמרו שצריך להכין שתי נשים נוספות"],
        "correct_index": 1,
        "explanation": "חכמים השיבו: 'אִם כֵּן, אֵין לַדָּבָר סוֹף' — שמא גם האישה הנוספת תמות."
    },
    {
        "question": "מדוע נקראת הלשכה של כהן שורף הפרה 'לשכת בית האבן'?",
        "options": ["כי קירותיה בנויים מאבנים גדולות", "כי כל מעשי הפרה בכלי גללים, אבנים ואדמה", "כי נמצאת ליד שער האבן", "כי הכהן ישב שם על ספסל אבן"],
        "correct_index": 1,
        "explanation": "הגמרא: 'שֶׁכׇּל מַעֲשֶׂיהָ בִּכְלֵי גְלָלִים, בִּכְלֵי אֲבָנִים, וּבִכְלֵי אֲדָמָה' — כלים שאין מקבלים טומאה."
    },
    {
        "question": "מדוע טימאו חכמים את הכהן השורף את הפרה ואחר כך הטבילוהו?",
        "options": ["כדי לקיים מצוות הטבילה", "להוציא מלבם של הצדוקים", "כי היה טמא מן התורה", "כי כך מצוות שריפת הפרה"],
        "correct_index": 1,
        "explanation": "הגמרא: 'מְטַמְּאִין הָיוּ... לְהוֹצִיא מִלִּבָּן שֶׁל צַדּוּקִין' שאמרו שרק מי שהעריב שמשו כשר."
    },
    {
        "question": "איפה הייתה ממוקמת הלשכה שבה שהה כהן שורף הפרה?",
        "options": ["דרום מערב המקדש", "צפון מזרח המקדש", "מזרח ירושלים", "ליד שער יפו"],
        "correct_index": 1,
        "explanation": "הגמרא: 'תַּקִּינוּ לַהּ רַבָּנַן לִשְׁכָּה צָפוֹנָה מִזְרָחָה' — כי פרה חטאת היא (צפון) ו'אל נוכח פני אוהל מועד' (מזרח)."
    },
    {
        "question": "מה המקור לדין פרישת שבעת ימים לכהן הגדול לפני יום כיפור?",
        "options": ["פרשת פרה אדומה", "הפסוק 'כַּאֲשֶׁר עָשָׂה בַּיּוֹם הַזֶּה צִוָּה ה' לַעֲשׂוֹת לְכַפֵּר עֲלֵיכֶם'", "גזירת חכמים בלבד", "פרשת כהן גדול"],
        "correct_index": 1,
        "explanation": "רב מניומי בר חלקיה: '\"לַעֲשׂוֹת\" — אֵלּוּ מַעֲשֵׂי פָרָה, \"לְכַפֵּר\" — אֵלּוּ מַעֲשֵׂי יוֹם הַכִּפּוּרִים'."
    },
]

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("🔐 מתחבר לסופאבייס…")
    token, user_id = login()
    print(f"✅ מחובר (user_id={user_id[:8]}…)")

    # Load all existing categories
    print("📂 טוען קטגוריות…")
    cats = get_categories(token)
    cat_map = {}
    for c in cats:
        key = (c["name"], c.get("parent_id"))
        cat_map[key] = c["id"]
    print(f"  נטענו {len(cats)} קטגוריות")

    # Build hierarchy: תלמוד בבלי → יומא → ב → א
    root_id     = ensure_category(token, user_id, "תלמוד בבלי", None,      cat_map, sort_order=0)
    yoma_id     = ensure_category(token, user_id, "יומא",       root_id,   cat_map, sort_order=6)
    daf_id      = ensure_category(token, user_id, "ב",           yoma_id,   cat_map, sort_order=2)
    amud_id     = ensure_category(token, user_id, "א",           daf_id,    cat_map, sort_order=1)

    print(f"\n📁 היררכיה:")
    print(f"  תלמוד בבלי  → {root_id[:8]}…")
    print(f"  יומא         → {yoma_id[:8]}…")
    print(f"  ב             → {daf_id[:8]}…")
    print(f"  א             → {amud_id[:8]}…")

    # Build cards
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
            "tags":            [f"cat:{amud_id}", "source:custom"],
            "srs":             default_srs(),
            "stats":           default_stats(),
            "sort_order":      0,
            "created_at":      now,
            "masechta":        "יומא",
            "daf":             2,
            "amud":            1,
        })

    print(f"\n📝 מכניס {len(cards)} כרטיסים…")
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/cards",
        headers={**hdrs(token), "Prefer": "return=minimal"},
        data=json.dumps(cards),
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"insert cards failed {r.status_code}: {r.text[:400]}")

    print(f"✅ הוכנסו {len(cards)} כרטיסים בהצלחה!")
    print(f"\nהשאלות נמצאות עכשיו תחת:")
    print(f"  קטגוריות → תלמוד בבלי → יומא → ב → א")

if __name__ == "__main__":
    main()
