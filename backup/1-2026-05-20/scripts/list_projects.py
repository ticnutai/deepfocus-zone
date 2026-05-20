import requests

PAT = "sbp_v0_7d035602aaa48c59cc245948fd58d86872199690"

r = requests.get(
    "https://api.supabase.com/v1/projects",
    headers={"Authorization": f"Bearer {PAT}"},
    timeout=15
)
print(f"Status: {r.status_code}")
data = r.json()
for p in data:
    print(f"  {p['id']} — {p['name']}")
