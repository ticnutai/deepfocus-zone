"""Resume-safe yeshiva import: skips question texts that already exist for this user."""
import json, uuid, re, sys, time, hashlib
from datetime import datetime, timezone
import requests

SUPABASE_URL = "https://htsuoqvafayyffyxjhhh.supabase.co"
ANON_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
            "InJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQ"
            "iOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjc"
            "Go7jVgobNsv7Fan0LIXxQ")
ADMIN_EMAIL="jj1212t@gmail.com"; ADMIN_PASSWORD="543211"
ROOT_CAT="תלמוד בבלי"; SOURCE_TAG="source:yeshiva"
DATA_FILE="scripts/yeshiva_all.json"

HEB_VAL={"א":1,"ב":2,"ג":3,"ד":4,"ה":5,"ו":6,"ז":7,"ח":8,"ט":9,"י":10,
 "כ":20,"ך":20,"ל":30,"מ":40,"ם":40,"נ":50,"ן":50,"ס":60,"ע":70,
 "פ":80,"ף":80,"צ":90,"ץ":90,"ק":100,"ר":200,"ש":300,"ת":400}
def heb_to_int(s):
    s=s.replace("'","").replace('"',"").replace("׳","").replace("״","")
    if not s: return None
    if s=="טו": return 15
    if s=="טז": return 16
    total=0
    for ch in s:
        if ch in HEB_VAL: total+=HEB_VAL[ch]
    return total or None

DAF_RE=re.compile(r"\(([^()]{1,40})\)\s*$")
def parse_daf(t):
    m=DAF_RE.search(t)
    if not m: return (None,None)
    inside=m.group(1).strip()
    mm=re.search(r"([א-ת]{1,4})\s*([.:׃])",inside)
    if mm:
        n=heb_to_int(mm.group(1))
        return (n, 1 if mm.group(2)=="." else 2) if n else (None,None)
    mm=re.fullmatch(r"([א-ת]{1,4})",inside)
    if mm:
        n=heb_to_int(mm.group(1)); return (n,1) if n else (None,None)
    return (None,None)

_H=["","ק","ר","ש","ת","תק","תר","תש","תת","תתק"]
_T=["","י","כ","ל","מ","נ","ס","ע","פ","צ"]
_O=["","א","ב","ג","ד","ה","ו","ז","ח","ט"]
def to_heb(n):
    if n<=0: return str(n)
    h=n//100; r=n%100; res=_H[h]
    if r==15: res+="טו"
    elif r==16: res+="טז"
    else: res+=_T[r//10]+_O[r%10]
    return res
def daf_name(n): return f"דף {to_heb(n)}"

def login():
    r=requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email":ADMIN_EMAIL,"password":ADMIN_PASSWORD},
        headers={"apikey":ANON_KEY},timeout=30); r.raise_for_status()
    d=r.json(); return d["access_token"], d["user"]["id"]
def hdrs(t): return {"Authorization":f"Bearer {t}","apikey":ANON_KEY,
    "Content-Type":"application/json","Prefer":"return=representation"}
def get_all(t,table,select="*"):
    rows,off,ps=[],0,1000
    while True:
        r=requests.get(f"{SUPABASE_URL}/rest/v1/{table}?select={select}",
            headers={**hdrs(t),"Range":f"{off}-{off+ps-1}","Prefer":"count=none"},timeout=60)
        r.raise_for_status(); c=r.json(); rows.extend(c)
        if len(c)<ps: break
        off+=ps
    return rows
def insert_rows(t,table,rows):
    if not rows: return []
    r=requests.post(f"{SUPABASE_URL}/rest/v1/{table}",headers=hdrs(t),
        data=json.dumps(rows),timeout=60)
    if not r.ok: raise RuntimeError(f"insert {table} {r.status_code}: {r.text[:300]}")
    return r.json()
def srs(): return {"interval":1,"easeFactor":2.5,"repetitions":0,
    "due":datetime.now(timezone.utc).isoformat()}
def stats(): return {"totalReviews":0,"correct":0,"incorrect":0}

def main():
    data=json.load(open(DATA_FILE,encoding="utf-8"))
    tok,uid=login()
    print(f"user_id={uid}")
    print("Loading existing categories + question hashes...")
    cats=get_all(tok,"categories","id,name,parent_id")
    cat_map={(r["name"],r.get("parent_id")):r["id"] for r in cats}
    existing_qs=get_all(tok,"cards","question")
    seen=set()
    for c in existing_qs:
        seen.add(c["question"].strip())
    print(f"  {len(cats)} cats, {len(seen)} existing question texts")

    def ensure(name,parent,sort=0):
        k=(name,parent)
        if k in cat_map: return cat_map[k]
        nid=str(uuid.uuid4())
        insert_rows(tok,"categories",[{"id":nid,"user_id":uid,"name":name,
            "parent_id":parent,"sort_order":sort,
            "created_at":datetime.now(timezone.utc).isoformat()}])
        cat_map[k]=nid; return nid

    root=ensure(ROOT_CAT,None,0)
    total=skipped=0; mo=0
    for masechet,tests in data.items():
        mo+=1
        mid=ensure(masechet,root,mo)
        by_daf={}; unparsed=[]
        for tid,td in tests.items():
            if not isinstance(td,dict) or "questions" not in td: continue
            for q in td["questions"]:
                d,_=parse_daf(q["question"])
                (by_daf.setdefault(d,[]) if d else unparsed).append(q) if d else unparsed.append(q)
        cards=[]; now=datetime.now(timezone.utc).isoformat()
        for d in sorted(by_daf.keys()):
            label=daf_name(d); did=ensure(label,mid,d)
            tags=[f"cat:{ROOT_CAT}",f"cat:{masechet}",f"cat:{label}",SOURCE_TAG]
            for q in by_daf[d]:
                qt=q["question"].strip()
                if qt in seen: skipped+=1; continue
                seen.add(qt)
                ci=[q["correct_index"]] if "correct_index" in q else (
                    [c-1 for c in q["correct"]] if "correct" in q else [0])
                cards.append({"id":str(uuid.uuid4()),"user_id":uid,"deck_id":None,
                    "type":"multiple","question":q["question"],"answer":None,
                    "options":q["answers"],"correct_indices":ci,
                    "correct_boolean":None,"explanation":None,"tags":tags,
                    "srs":srs(),"stats":stats(),"sort_order":0,"created_at":now})
        for q in unparsed:
            qt=q["question"].strip()
            if qt in seen: skipped+=1; continue
            seen.add(qt)
            ci=[q["correct_index"]] if "correct_index" in q else (
                [c-1 for c in q["correct"]] if "correct" in q else [0])
            tags=[f"cat:{ROOT_CAT}",f"cat:{masechet}",SOURCE_TAG]
            cards.append({"id":str(uuid.uuid4()),"user_id":uid,"deck_id":None,
                "type":"multiple","question":q["question"],"answer":None,
                "options":q["answers"],"correct_indices":ci,
                "correct_boolean":None,"explanation":None,"tags":tags,
                "srs":srs(),"stats":stats(),"sort_order":0,"created_at":now})
        ins=0
        for i in range(0,len(cards),200):
            insert_rows(tok,"cards",cards[i:i+200]); ins+=len(cards[i:i+200])
            time.sleep(0.05)
        total+=ins
        print(f"  {masechet}: +{ins} cards (skipped dups so far:{skipped})")
    print(f"\nDONE total inserted={total} skipped={skipped}")
if __name__=="__main__": main()
