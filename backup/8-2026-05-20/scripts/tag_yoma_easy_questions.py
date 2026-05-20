"""
tag_yoma_easy_questions.py
מוסיף תגית diff:1 ל-10 השאלות הקיימות על יומא ב עמוד א
(אלה שיש להן source:custom ואין להן תגית diff כלל).
"""
import sys
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


def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"]


def hdrs(token):
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def main():
    print("🔐 מתחבר…")
    token = login()
    print("✅ מחובר")

    # Get all cards with source:custom and masechta=יומא, daf=2, amud=1
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/cards"
        f"?select=id,tags,masechta,daf,amud"
        f"&masechta=eq.יומא&daf=eq.2&amud=eq.1",
        headers={**hdrs(token), "Prefer": "count=none"},
        timeout=30,
    )
    r.raise_for_status()
    cards = r.json()
    print(f"נמצאו {len(cards)} כרטיסים על יומא ב עמוד א")

    # Filter: has source:custom, no diff: tag at all
    to_tag = [c for c in cards
              if "source:custom" in c["tags"]
              and not any(t.startswith("diff:") for t in c["tags"])]
    print(f"  מהם {len(to_tag)} ללא תגית diff — מוסיף diff:1")

    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    for card in to_tag:
        new_tags = card["tags"] + ["diff:1"]
        r2 = requests.patch(
            f"{SUPABASE_URL}/rest/v1/cards?id=eq.{card['id']}",
            headers=hdrs(token),
            json={"tags": new_tags, "updated_at": now},
            timeout=30,
        )
        if r2.ok:
            updated += 1
            print(f"  ✅ {card['id'][:8]}… → {new_tags}")
        else:
            print(f"  ❌ {card['id'][:8]}… שגיאה: {r2.status_code}: {r2.text[:200]}")

    print(f"\n✅ עודכנו {updated} כרטיסים עם diff:1")


if __name__ == "__main__":
    main()
