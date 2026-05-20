import requests, json

SUPABASE_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co'
ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'

r = requests.post(
    SUPABASE_URL + '/auth/v1/token?grant_type=password',
    json={'email': 'jj1212t@gmail.com', 'password': '543211'},
    headers={'apikey': ANON_KEY}, timeout=30
)
token = r.json()['access_token']
h = {'Authorization': 'Bearer ' + token, 'apikey': ANON_KEY}

# 1. Find ברכות category
r2 = requests.get(
    SUPABASE_URL + '/rest/v1/categories?name=eq.ברכות&select=id,name,parent_id',
    headers=h, timeout=30
)
print('=== קטגוריות ברכות ===')
brachot_cats = r2.json()
for c in brachot_cats:
    print(c)

# 2. Find child dafim under each ברכות
for brachot in brachot_cats:
    brachot_id = brachot['id']
    r3 = requests.get(
        SUPABASE_URL + f'/rest/v1/categories?parent_id=eq.{brachot_id}&select=id,name&order=name&limit=20',
        headers=h, timeout=30
    )
    dafim = r3.json()
    print(f'=== דפים תחת ברכות id={brachot_id[:8]} ({len(dafim)} דפים) ===')
    for d in dafim[:10]:
        print(' ', d)

# 3. Sample cards for ברכות - check exact tags
r4 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&select=id,tags&limit=5',
    headers={**h, 'Range': '0-4'}, timeout=30
)
print('\n=== 5 קלפים אחרונים (multiple) ===')
for c in r4.json():
    print(' ', c['id'][:8], c['tags'])

# 4. Count cards per tag pattern
r5 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&select=tags&limit=1',
    headers={**h, 'Prefer': 'count=exact', 'Range': '0-0'}, timeout=30
)
print('\n=== סה"כ קלפים multiple ===', r5.headers.get('content-range'))

# 5. Check if any card has 'דף' in tags
r6 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&tags=like.*דף*&select=id,tags&limit=3',
    headers=h, timeout=30
)
print('\n=== קלפים עם דף בטאג ===')
print(r6.status_code, r6.text[:500])
