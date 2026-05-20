"""Check bootstrap snapshot and get_unreviewed_cards_page function definitions."""
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
hdrs  = {'Authorization': f'Bearer {token}', 'apikey': ANON, 'Content-Type': 'application/json'}

# Get bootstrap function definition via exec_sql
def exec_sql(sql: str):
    r = requests.post(URL+'/rest/v1/rpc/exec_sql', headers=hdrs, json={"sql": sql})
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:200]}"
    return r.json()

# Check category count in bootstrap
print("=== Category counts ===")
result = exec_sql("""
    SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE parent_id IS NULL) as roots,
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as active,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
    FROM categories 
    WHERE user_id = '3e108a41-8da6-4f36-98cd-2b38916708b8'
""")
print(result)

# Check what get_bootstrap_snapshot returns for categories
print("\n=== get_bootstrap_snapshot function definition (categories part) ===")
func_def = exec_sql("""
    SELECT pg_get_functiondef(oid)
    FROM pg_proc
    WHERE proname = 'get_bootstrap_snapshot'
    LIMIT 1
""")
if isinstance(func_def, list) and func_def:
    full_def = func_def[0].get('pg_get_functiondef', '')
    # Print only the categories part
    lines = full_def.split('\n')
    in_cats = False
    for line in lines:
        if 'categor' in line.lower():
            in_cats = True
        if in_cats:
            print(line)
            if len(line.strip()) == 0 and in_cats:
                in_cats = False
else:
    print(func_def)

# Check total card count in bootstrap (categories_roots key)
print("\n=== Bootstrap categories count ===")
r2 = requests.post(URL+'/rest/v1/rpc/get_bootstrap_snapshot', headers=hdrs, json={})
if r2.status_code == 200:
    data = r2.json()
    cats = data.get('categories_roots', [])
    print(f"  Bootstrap returned {len(cats)} categories")
    # Count with/without parent
    roots = [c for c in cats if not c.get('parent_id')]
    non_roots = [c for c in cats if c.get('parent_id')]
    print(f"  Root (no parent): {len(roots)}")
    print(f"  Non-root (has parent): {len(non_roots)}")
