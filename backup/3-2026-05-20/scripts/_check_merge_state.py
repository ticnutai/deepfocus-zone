"""
_check_merge_state.py
בודק את מצב המיזוג הנוכחי: כמה כרטיסים עדיין עם cat:תלמוד בבלי,
מצב עץ ש"ס, ושורש תלמוד בבלי.
"""
import sys, requests
sys.stdout.reconfigure(encoding='utf-8')

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

BAVLI_ROOT = "7a0151f6-27e0-4919-8927-f4f2e4708045"
SHAS_ROOT  = "c75a7f77-e9a0-4cf7-9530-18a9a0287dd2"

print("Logging in...")
r = requests.post(URL+"/auth/v1/token?grant_type=password",
    headers={"apikey": ANON, "Content-Type": "application/json"},
    json={"email": "jj1212t@gmail.com", "password": "543211"})
r.raise_for_status()
tok = r.json()["access_token"]
uid = r.json()["user"]["id"]
print(f"Logged in as {uid}")

H = {"Authorization": f"Bearer {tok}", "apikey": ANON}

def get_all(path, params=""):
    all_rows, offset = [], 0
    while True:
        sep = "&" if params else ""
        r = requests.get(URL+f"/rest/v1/{path}?{params}{sep}limit=1000&offset={offset}", headers=H)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows

# --- שורש תלמוד בבלי ---
row = requests.get(URL+f"/rest/v1/categories?id=eq.{BAVLI_ROOT}&select=id,name,deleted_at", headers=H).json()
print(f"\n=== שורש תלמוד בבלי ===")
if row:
    r0 = row[0]
    status = "נמחק (soft-deleted)" if r0.get("deleted_at") else "⚠️  עדיין ACTIVE"
    print(f"  {r0['name']}  →  {status}  (deleted_at={r0.get('deleted_at')})")
else:
    print("  לא נמצא")

# --- מסכתות פעילות תחת בבלי ---
active_bavli_children = requests.get(
    URL+f"/rest/v1/categories?parent_id=eq.{BAVLI_ROOT}&deleted_at=is.null&select=id,name",
    headers=H).json()
print(f"\n=== מסכתות פעילות תחת תלמוד בבלי: {len(active_bavli_children)} ===")
for c in active_bavli_children:
    print(f"  {c['name']}")

# --- שורש ש"ס ---
row2 = requests.get(URL+f"/rest/v1/categories?id=eq.{SHAS_ROOT}&select=id,name,deleted_at", headers=H).json()
print(f"\n=== שורש ש\"ס ===")
if row2:
    r0 = row2[0]
    status = "נמחק" if r0.get("deleted_at") else "✅ פעיל"
    print(f"  {r0['name']}  →  {status}")

# --- סדרים תחת ש"ס ---
sedarim = requests.get(
    URL+f"/rest/v1/categories?parent_id=eq.{SHAS_ROOT}&deleted_at=is.null&select=id,name&order=name",
    headers=H).json()
print(f"\n=== סדרים תחת ש\"ס ({len(sedarim)}) ===")
for s in sedarim:
    masechets = requests.get(
        URL+f"/rest/v1/categories?parent_id=eq.{s['id']}&deleted_at=is.null&select=id,name",
        headers=H).json()
    print(f"  {s['name']:20}  {len(masechets)} מסכתות")

# --- כרטיסים עם cat:תלמוד בבלי ---
print("\n=== ספירת כרטיסים עם cat:תלמוד בבלי ===")
all_cards = get_all("cards", f"user_id=eq.{uid}&select=id,tags")
bavli_cards = [c for c in all_cards if "cat:תלמוד בבלי" in (c.get("tags") or [])]
shas_cards  = [c for c in all_cards if 'cat:ש"ס' in (c.get("tags") or [])]
print(f"  סה\"כ כרטיסים: {len(all_cards)}")
print(f"  כרטיסים עם cat:תלמוד בבלי: {len(bavli_cards)}")
print(f"  כרטיסים עם cat:ש\"ס:        {len(shas_cards)}")

if bavli_cards:
    print(f"\n  דוגמה (5 ראשונים):")
    for c in bavli_cards[:5]:
        print(f"    id={c['id'][:8]}... tags={c['tags']}")

print("\n=== DONE ===")
