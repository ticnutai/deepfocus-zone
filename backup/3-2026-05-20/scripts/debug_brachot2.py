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

# 1. Get first 5 multiple cards (oldest) to see their tags
r2 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&select=id,front,tags&order=created_at.asc&limit=5',
    headers=h, timeout=30
)
print('=== 5 קלפים ישנים (multiple) ===')
for c in r2.json():
    front = (c.get('front') or '')[:60]
    tags = c['tags']
    print('  id=%s tags=%s front=%s' % (c['id'][:8], tags, front))

# 2. Get 5 most recent multiple cards
r3 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&select=id,front,tags&order=created_at.desc&limit=5',
    headers=h, timeout=30
)
print('\n=== 5 קלפים חדשים (multiple) ===')
for c in r3.json():
    front = (c.get('front') or '')[:60]
    tags = c['tags']
    print('  id=%s tags=%s front=%s' % (c['id'][:8], tags, front))

# 3. Total multiple cards
r4 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&select=id&limit=1',
    headers={**h, 'Prefer': 'count=exact', 'Range': '0-0'}, timeout=30
)
print('\n=== ספירה ===')
print('total multiple cards:', r4.headers.get('content-range'))

# 4. Look for cards with 'cat:ברכות' in tags using contains
# PostgREST jsonb contains syntax: tags=cs.["cat:ברכות"]
tag_to_find = 'cat:\u05d1\u05e8\u05db\u05d5\u05ea'
encoded = '["%s"]' % tag_to_find
r5 = requests.get(
    SUPABASE_URL + '/rest/v1/cards?type=eq.multiple&tags=cs.' + requests.utils.quote(encoded) + '&select=id,tags&limit=3',
    headers=h, timeout=30
)
print('\n=== קלפים עם cat:ברכות ===')
print('status:', r5.status_code)
print(r5.text[:300])
