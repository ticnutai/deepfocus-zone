"""
Merge תלמוד בבלי tree into ש"ס tree.

Final structure: ש"ס → סדר → מסכת → דף

Steps:
1. For each of 27 masechets under תלמוד בבלי:
   a. Find its Seder under ש"ס
   b. If masechet with same name exists under Seder: merge daf sub-categories + cards
   c. Else: move masechet (update parent_id to Seder)
2. Update card tags for all cards tagged cat:תלמוד בבלי:
   - Remove cat:תלמוד בבלי, add cat:ש"ס + cat:<seder_name>
3. Soft-delete the now-empty תלמוד בבלי root
4. Soft-delete the duplicate ללא סיווג (empty one: 8f52c063)
"""

import requests, sys
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

URL  = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
        "ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYs"
        "ImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc")

print("Logging in...")
r = requests.post(URL+'/auth/v1/token?grant_type=password',
    headers={'apikey': ANON, 'Content-Type': 'application/json'},
    json={'email': 'jj1212t@gmail.com', 'password': '543211'})
r.raise_for_status()
token = r.json()['access_token']
uid   = r.json()['user']['id']
print(f"Logged in as {uid}")

hdrs = {
    'Authorization': f'Bearer {token}',
    'apikey': ANON,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}
hdrs_read = {
    'Authorization': f'Bearer {token}',
    'apikey': ANON,
}

def get_all(path, params=""):
    all_rows, offset = [], 0
    while True:
        r = requests.get(URL+f'/rest/v1/{path}?{params}&limit=1000&offset={offset}', headers=hdrs_read)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows

def patch(table, row_id, data, retries=3):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.patch(
                URL + f'/rest/v1/{table}?id=eq.{row_id}',
                headers=hdrs,
                json=data,
                timeout=20,
            )
            if r.ok:
                return True
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except requests.RequestException as e:
            last_err = str(e)

        if attempt < retries:
            continue

    print(f"  ❌ PATCH {table} {row_id}: {last_err}")
    return False

def soft_delete(table, row_id):
    now = datetime.now(timezone.utc).isoformat()
    return patch(table, row_id, {'deleted_at': now})

# ── Known IDs ──────────────────────────────────────────────────────────────
BAVLI_ROOT_ID  = '7a0151f6-27e0-4919-8927-f4f2e4708045'
SHAS_ROOT_ID   = 'c75a7f77-e9a0-4cf7-9530-18a9a0287dd2'
LELO_DEAD_ID   = '8f52c063-3492-4d51-9e70-ec66dcadd520'  # empty ללא סיווג

# Masechet → Seder name mapping
MASECHET_TO_SEDER = {
    # זרעים
    'ברכות':       'זרעים',
    # מועד
    'שבת':         'מועד',
    'עירובין':     'מועד',
    'פסחים':       'מועד',
    'שקלים':       'מועד',
    'יומא':        'מועד',
    'סוכה':        'מועד',
    'ביצה':        'מועד',
    'ראש השנה':    'מועד',
    'תענית':       'מועד',
    'מגילה':       'מועד',
    'מועד קטן':    'מועד',
    'חגיגה':       'מועד',
    # נשים
    'יבמות':       'נשים',
    'כתובות':      'נשים',
    'נזיר':        'נשים',
    'סוטה':        'נשים',
    'גיטין':       'נשים',
    'קידושין':     'נשים',
    # נזיקין
    'בבא קמא':     'נזיקין',
    'בבא מציעא':   'נזיקין',
    'בבא בתרא':    'נזיקין',
    'סנהדרין':     'נזיקין',
    'מכות':        'נזיקין',
    'עבודה זרה':   'נזיקין',
    # קדשים
    'זבחים':       'קדשים',
    'חולין':       'קדשים',
}

# ── Load all active categories ─────────────────────────────────────────────
print("\nLoading all categories...")
cats = get_all('categories', f'select=id,name,parent_id&user_id=eq.{uid}&deleted_at=is.null')
print(f"  Total active: {len(cats)}")

by_id   = {c['id']: c for c in cats}
by_name_and_parent = {}
for c in cats:
    key = (c['name'], c['parent_id'])
    by_name_and_parent[key] = c

def children_of(parent_id):
    return [c for c in cats if c['parent_id'] == parent_id]

# ── Find Seder IDs under ש"ס ───────────────────────────────────────────────
seder_id = {}
for c in children_of(SHAS_ROOT_ID):
    seder_id[c['name']] = c['id']
print(f"\nSedarim under ש\"ס: {list(seder_id.keys())}")

# Build masechet lookup under each Seder
masechet_in_seder = {}  # masechet_name → id (for those already in ש"ס tree)
for seder_name, sid in seder_id.items():
    for mc in children_of(sid):
        masechet_in_seder[mc['name']] = mc['id']
print(f"Masechets already under Sedarim: {sorted(masechet_in_seder.keys())}")

# ── Process each masechet under תלמוד בבלי ────────────────────────────────
bavli_masechets = children_of(BAVLI_ROOT_ID)
print(f"\nMasechets in תלמוד בבלי: {len(bavli_masechets)}")

moved   = 0
merged  = 0
errors  = 0

for bm in bavli_masechets:
    masechet_name = bm['name']
    bm_id = bm['id']
    seder_name = MASECHET_TO_SEDER.get(masechet_name)

    if not seder_name:
        print(f"  ⚠️  Unknown seder for: {masechet_name} — skipping")
        errors += 1
        continue

    target_seder_id = seder_id.get(seder_name)
    if not target_seder_id:
        print(f"  ⚠️  Seder '{seder_name}' not found under ש\"ס — skipping {masechet_name}")
        errors += 1
        continue

    bm_dafim = children_of(bm_id)

    if masechet_name in masechet_in_seder:
        # ── MERGE: masechet already exists under the Seder ──────────────────
        existing_mc_id = masechet_in_seder[masechet_name]
        print(f"  MERGE  {masechet_name} ({seder_name}) — {len(bm_dafim)} dafim to merge into {existing_mc_id}")

        # Get existing dafim
        existing_dafim = children_of(existing_mc_id)
        existing_daf_names = {d['name']: d['id'] for d in existing_dafim}

        for daf in bm_dafim:
            daf_id   = daf['id']
            daf_name = daf['name']

            if daf_name in existing_daf_names:
                # Duplicate daf: redirect cards tagged cat:<daf_name> from bavli-daf
                # Actually cards use tags by name, not by category id
                # Just delete the duplicate daf (cards will match on existing daf by tag name)
                ok = soft_delete('categories', daf_id)
                if ok:
                    print(f"    del-dup-daf  {daf_name}")
            else:
                # Move daf to existing masechet
                ok = patch('categories', daf_id, {'parent_id': existing_mc_id})
                if ok:
                    print(f"    moved-daf    {daf_name} → {masechet_name}/{existing_mc_id}")

        # Delete now-empty bavli masechet
        ok = soft_delete('categories', bm_id)
        if ok:
            print(f"    del-masechet {masechet_name}")
        merged += 1

    else:
        # ── MOVE: masechet doesn't exist in ש"ס tree ──────────────────────
        print(f"  MOVE   {masechet_name} ({seder_name}) — {len(bm_dafim)} dafim → under {target_seder_id}")
        ok = patch('categories', bm_id, {'parent_id': target_seder_id})
        if ok:
            moved += 1
        else:
            errors += 1

print(f"\n✅ Masechets moved:  {moved}")
print(f"✅ Masechets merged: {merged}")
print(f"❌ Errors:           {errors}")

# ── Update card tags ───────────────────────────────────────────────────────
print("\n=== Updating card tags ===")
# Build masechet→seder lookup (including merged ones)
# We need to know for each card: which masechet is it in → which seder

# Load ALL user cards that have cat:תלמוד בבלי.
# `cards` in this project has no `deleted_at` column, so do not filter by it.
all_cards = get_all('cards', f'select=id,tags&user_id=eq.{uid}')
bavli_cards = [c for c in all_cards if 'cat:תלמוד בבלי' in (c.get('tags') or [])]
print(f"Cards tagged cat:תלמוד בבלי: {len(bavli_cards)}")

tag_updated = 0
tag_errors  = 0
updates = []

for card in bavli_cards:
    tags = list(card.get('tags') or [])
    old_tags = set(tags)

    # Remove cat:תלמוד בבלי
    tags = [t for t in tags if t != 'cat:תלמוד בבלי']

    # Add cat:ש"ס if not present
    if 'cat:ש"ס' not in tags:
        tags.append('cat:ש"ס')

    # Find which masechet this card belongs to → add seder tag
    for tag in tags:
        if tag.startswith('cat:'):
            mname = tag[4:]
            if mname in MASECHET_TO_SEDER:
                seder_name = MASECHET_TO_SEDER[mname]
                seder_tag  = f'cat:{seder_name}'
                if seder_tag not in tags:
                    tags.append(seder_tag)
                break

    if set(tags) != old_tags:
        updates.append((card['id'], tags))

print(f"Cards requiring update: {len(updates)}")

if updates:
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [
            pool.submit(patch, 'cards', card_id, {'tags': tags})
            for card_id, tags in updates
        ]

        for i, fut in enumerate(as_completed(futures), start=1):
            if fut.result():
                tag_updated += 1
            else:
                tag_errors += 1

            if i % 500 == 0:
                print(f"  ...processed {i}/{len(updates)} card updates")

print(f"✅ Cards tag-updated: {tag_updated}")
print(f"❌ Cards tag-errors:  {tag_errors}")

# ── Soft-delete תלמוד בבלי root ───────────────────────────────────────────
print("\n=== Deleting תלמוד בבלי root ===")
ok = soft_delete('categories', BAVLI_ROOT_ID)
print(f"  {'✅' if ok else '❌'} תלמוד בבלי root deleted")

# ── Soft-delete empty ללא סיווג ────────────────────────────────────────────
print("\n=== Deleting empty ללא סיווג ===")
ok = soft_delete('categories', LELO_DEAD_ID)
print(f"  {'✅' if ok else '❌'} empty ללא סיווג deleted")

print("\n=== DONE ===")
print("Refresh the app to verify the new structure.")
