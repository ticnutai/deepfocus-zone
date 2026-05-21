import requests

URL = 'https://hgjfpwdugvvtrfhycejv.supabase.co'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc'
tok = requests.post(f'{URL}/auth/v1/token?grant_type=password',
    json={'email': 'jj1212t@gmail.com', 'password': '543211'},
    headers={'apikey': KEY}, timeout=15).json()
token, uid = tok['access_token'], tok['user']['id']
hdrs = {'Authorization': f'Bearer {token}', 'apikey': KEY}

# Total categories count
r = requests.get(f'{URL}/rest/v1/categories?user_id=eq.{uid}&select=id',
    headers={**hdrs, 'Prefer': 'count=exact', 'Range': '0-0'}, timeout=20)
print('Total categories:', r.headers.get('content-range'))

# All root categories
all_roots = []
offset = 0
while True:
    r = requests.get(
        f'{URL}/rest/v1/categories?user_id=eq.{uid}&parent_id=is.null&select=id,name&limit=1000&offset={offset}',
        headers=hdrs, timeout=30)
    batch = r.json()
    if not batch:
        break
    all_roots.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

print(f'Total root categories: {len(all_roots)}')

# Classify
garbage_daf = [c for c in all_roots if c['name'].startswith('דף ')]
proper = [c for c in all_roots if not c['name'].startswith('דף ')]

print(f'Starts with "דף " (garbage): {len(garbage_daf)}')
print(f'Other roots: {len(proper)}')
print('Other root names:')
for c in proper[:40]:
    print(' ', repr(c['name']))
