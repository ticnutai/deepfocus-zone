import requests, sys, json
sys.stdout.reconfigure(encoding='utf-8')
URL = 'https://htsuoqvafayyffyxjhhh.supabase.co'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
r = requests.post(URL+'/auth/v1/token?grant_type=password', json={'email':'jj1212t@gmail.com','password':'543211'}, headers={'apikey':KEY}, timeout=30)
tok = r.json()['access_token']
H = {'Authorization': 'Bearer '+tok, 'apikey': KEY}

uid = r.json()['user']['id']
print('Logged in user ID:', uid)

r2 = requests.get(URL+'/rest/v1/cards?type=eq.multiple&select=id,user_id,tags', headers={**H,'Range':'0-4'}, timeout=30)
data = r2.json()
for c in data:
    print(f"Card {c['id'][:8]} user_id={c.get('user_id')} tags={c.get('tags')}")

r3 = requests.get(URL+'/rest/v1/cards?type=eq.multiple&user_id=eq.'+uid+'&select=id', headers={**H,'Prefer':'count=exact','Range':'0-0'}, timeout=30)
print('Cards with correct user_id:', r3.headers.get('content-range'))

r4 = requests.get(URL+'/rest/v1/cards?type=eq.multiple&user_id=is.null&select=id', headers={**H,'Prefer':'count=exact','Range':'0-0'}, timeout=30)
print('Cards with NULL user_id:', r4.headers.get('content-range'))
