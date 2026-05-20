import requests, sys
URL = 'https://htsuoqvafayyffyxjhhh.supabase.co'
KEY = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs'
       'InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ'
       'iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc'
       'Go7jVgobNsv7Fan0LIXxQ')

sys.stdout.reconfigure(encoding='utf-8')
r = requests.post(f'{URL}/auth/v1/token?grant_type=password',
                  json={'email': 'jj1212t@gmail.com', 'password': '543211'},
                  headers={'apikey': KEY})
print('login', r.status_code)
tok = r.json()['access_token']
H = {'Authorization': f'Bearer {tok}', 'apikey': KEY}

cats = requests.get(f'{URL}/rest/v1/categories?select=id,name,parent_id', headers=H).json()
cards = requests.get(f'{URL}/rest/v1/cards?select=id,question,tags,deck_id', headers=H).json()
print(f'cats={len(cats)}  cards={len(cards)}')

# Find הוריות category and its descendants
horiyot_cats = [c for c in cats if 'הוריות' in c['name'] or 'נזיקין' in c['name']]
print('\n=== Categories matching הוריות/נזיקין ===')
by_id = {c['id']: c for c in cats}
for c in horiyot_cats:
    parent = by_id.get(c.get('parent_id'))
    pname = parent['name'] if parent else '(root)'
    print(f"  {c['name']!r:50}  parent={pname!r}")

# Build subtree of name 'הוריות'
horiyot = next((c for c in cats if c['name'] == 'הוריות' or c['name'].endswith(' · הוריות')), None)
nezikin = next((c for c in cats if c['name'] == 'נזיקין' or c['name'].endswith(' · נזיקין')), None)

def subtree_names(root_id):
    out = set()
    def walk(pid):
        for c in cats:
            if c.get('parent_id') == pid:
                out.add(c['name'])
                walk(c['id'])
    if root_id:
        out.add(by_id[root_id]['name'])
        walk(root_id)
    return out

if horiyot:
    s = subtree_names(horiyot['id'])
    print(f"\n=== הוריות subtree names ({len(s)}) ===")
    for n in s: print('  ', n)
    matches = []
    for c in cards:
        ctags = [t[4:] for t in (c.get('tags') or []) if t.startswith('cat:')]
        if any(n in s for n in ctags):
            matches.append((c['id'][:8], c['question'][:40], ctags))
    print(f"\n=== Cards matching הוריות subtree: {len(matches)} ===")
    for m in matches: print('  ', m)

if nezikin:
    s = subtree_names(nezikin['id'])
    print(f"\n=== נזיקין subtree names ({len(s)}) ===")
    for n in s: print('  ', n)
    matches = []
    for c in cards:
        ctags = [t[4:] for t in (c.get('tags') or []) if t.startswith('cat:')]
        if any(n in s for n in ctags):
            matches.append((c['id'][:8], c['question'][:40], ctags))
    print(f"\n=== Cards matching נזיקין subtree: {len(matches)} ===")
    for m in matches: print('  ', m)
