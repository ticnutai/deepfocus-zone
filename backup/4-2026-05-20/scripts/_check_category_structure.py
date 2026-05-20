"""Check root categories and tag structure in the DB."""
import requests

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

r = requests.post(URL+'/auth/v1/token?grant_type=password',
    headers={'apikey': ANON, 'Content-Type': 'application/json'},
    json={'email': 'jj1212t@gmail.com', 'password': '543211'})
token = r.json()['access_token']
uid   = r.json()['user']['id']
hdrs  = {'Authorization': f'Bearer {token}', 'apikey': ANON}

# Root categories
r2 = requests.get(URL+'/rest/v1/categories?select=id,name&user_id=eq.'+uid+'&parent_id=is.null&order=name', headers=hdrs)
roots = r2.json()
print("=== ROOT CATEGORIES ===")
for c in roots:
    print(f"  {c['name']}  (id: {c['id']})")

# Card tag breakdown
r3 = requests.get(URL+'/rest/v1/cards?select=tags&user_id=eq.'+uid+'&limit=20', headers=hdrs)
print("\n=== SAMPLE CARD TAGS ===")
for c in r3.json():
    print("  ", c['tags'])

# Tags that appear most often (first tag element)
from collections import Counter
all_rows, offset = [], 0
while True:
    batch = requests.get(URL+'/rest/v1/cards?select=tags&user_id=eq.'+uid+'&limit=1000&offset='+str(offset), headers=hdrs).json()
    all_rows.extend(batch)
    if len(batch) < 1000: break
    offset += 1000
print(f"\nTotal cards: {len(all_rows)}")
first_tags = Counter()
for c in all_rows:
    tags = c.get('tags') or []
    for t in tags:
        if t.startswith('cat:') and len(t) < 20:
            first_tags[t] += 1
print("Most common short cat: tags:")
for tag, cnt in first_tags.most_common(15):
    print(f"  {tag}: {cnt}")
