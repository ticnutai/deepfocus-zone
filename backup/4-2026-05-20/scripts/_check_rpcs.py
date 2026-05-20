"""Check if required RPCs exist and if IDB would have all cards."""
import requests, json

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

r = requests.post(URL+'/auth/v1/token?grant_type=password',
    headers={'apikey': ANON, 'Content-Type': 'application/json'},
    json={'email': 'jj1212t@gmail.com', 'password': '543211'})
d = r.json()
token = d['access_token']
uid   = d['user']['id']
hdrs  = {'Authorization': f'Bearer {token}', 'apikey': ANON, 'Content-Type': 'application/json'}

print("=== TEST 1: get_bootstrap_snapshot ===")
r1 = requests.post(URL+'/rest/v1/rpc/get_bootstrap_snapshot', headers=hdrs, json={})
print(f"  Status: {r1.status_code}")
if r1.status_code == 200:
    data = r1.json()
    if isinstance(data, dict):
        cards = data.get('cards', [])
        total = data.get('cards_total_count', 0)
        cats  = data.get('categories_roots', [])
        print(f"  cards returned: {len(cards)}, cards_total_count: {total}")
        print(f"  categories_roots: {len(cats)}")
        print(f"  Keys: {list(data.keys())}")
    else:
        print(f"  Response type: {type(data)}, preview: {str(data)[:200]}")
else:
    print(f"  Error: {r1.text[:300]}")

print()
print("=== TEST 2: get_unreviewed_cards_page ===")
r2 = requests.post(URL+'/rest/v1/rpc/get_unreviewed_cards_page', headers=hdrs,
                   json={"p_offset": 0, "p_limit": 10})
print(f"  Status: {r2.status_code}")
if r2.status_code == 200:
    rows = r2.json()
    print(f"  Rows returned: {len(rows) if isinstance(rows, list) else 'not a list'}")
    if rows:
        print(f"  Sample keys: {list(rows[0].keys()) if isinstance(rows, list) else 'N/A'}")
else:
    print(f"  Error: {r2.text[:300]}")

print()
print("=== TEST 3: Direct card count ===")
r3 = requests.get(URL+'/rest/v1/cards?select=id&user_id=eq.'+uid+'&limit=1',
    headers={**hdrs, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'})
print(f"  Status: {r3.status_code}")
print(f"  Content-Range: {r3.headers.get('content-range', 'N/A')}")
print(f"  Total cards in cloud: {r3.headers.get('content-range', 'N/A')}")
