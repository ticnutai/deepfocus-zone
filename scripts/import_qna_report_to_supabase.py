#!/usr/bin/env python3
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

SUPABASE_URL = "https://hgjfpwdugvvtrfhycejv.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
    "InJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQi"
    "OjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy"
    "451NO0N37rz7yjcpXYc"
)
ADMIN_EMAIL = "jj1212t@gmail.com"
ADMIN_PASSWORD = "543211"
ROOT_CAT_NAME = "תלמוד בבלי"


def normalize_text(s: str) -> str:
    return " ".join((s or "").split()).strip()


def normalize_question_key(s: str) -> str:
    return (s or "").strip()


def login() -> Tuple[str, str]:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"apikey": ANON_KEY},
        timeout=30,
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["user"]["id"]


def hdrs(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def get_all(token: str, table: str, select: str = "*") -> list[dict]:
    rows, offset, page_size = [], 0, 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?select={select}",
            headers={**hdrs(token), "Range": f"{offset}-{offset + page_size - 1}", "Prefer": "count=none"},
            timeout=30,
        )
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


def insert_rows(token: str, table: str, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**hdrs(token), "Prefer": "return=representation"},
        data=json.dumps(rows, ensure_ascii=False),
        timeout=90,
    )
    if not r.ok:
        raise RuntimeError(f"[{table}] insert failed {r.status_code}: {r.text[:300]}")
    return r.json()


def find_category_id(token: str, user_id: str, name: str, parent_id: Optional[str]) -> Optional[str]:
    parent_filter = "is.null" if parent_id is None else f"eq.{parent_id}"
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/categories?select=id&user_id=eq.{user_id}&name=eq.{name}&parent_id={parent_filter}",
        headers=hdrs(token),
        timeout=30,
    )
    if not r.ok:
        return None
    rows = r.json()
    if not rows:
        return None
    return rows[0].get("id")


def ensure_deck(token: str, user_id: str) -> str:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/decks?user_id=eq.{user_id}&select=id,name",
        headers=hdrs(token),
        timeout=30,
    )
    r.raise_for_status()
    decks = r.json()
    for d in decks:
        if d["name"] == 'ש"ס':
            return d["id"]
    if decks:
        return decks[0]["id"]

    deck_id = str(uuid.uuid4())
    insert_rows(token, "decks", [{
        "id": deck_id,
        "user_id": user_id,
        "name": 'ש"ס',
        "description": "ייבוא אוטומטי ממעבדת שאלות",
        "color": "gold",
        "category_ids": [],
        "include_sub_categories": True,
    }])
    return deck_id


def find_existing_deck(token: str, user_id: str) -> Optional[str]:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/decks?user_id=eq.{user_id}&select=id,name",
        headers=hdrs(token),
        timeout=30,
    )
    r.raise_for_status()
    decks = r.json()
    for d in decks:
        if d["name"] == 'ש"ס':
            return d["id"]
    if decks:
        return decks[0]["id"]
    return None


class CatManager:
    def __init__(self, token: str, user_id: str):
        self.token = token
        self.user_id = user_id
        self._map: Dict[Tuple[str, Optional[str]], str] = {}
        for r in get_all(token, "categories", "id,name,parent_id"):
            self._map[(r["name"], r.get("parent_id"))] = r["id"]

    def ensure(self, name: str, parent_id: Optional[str]) -> str:
        key = (name, parent_id)
        if key in self._map:
            return self._map[key]
        cid = str(uuid.uuid4())
        try:
            insert_rows(self.token, "categories", [{
                "id": cid,
                "user_id": self.user_id,
                "name": name,
                "parent_id": parent_id,
                "sort_order": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }])
            self._map[key] = cid
            return cid
        except RuntimeError as exc:
            msg = str(exc)
            if "23505" in msg or "409" in msg:
                existing = find_category_id(self.token, self.user_id, name, parent_id)
                if existing:
                    self._map[key] = existing
                    return existing
            raise


def load_existing_deck_questions(token: str, user_id: str, deck_id: str) -> set[str]:
    keys = set()
    offset, page_size = 0, 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/cards?select=question&user_id=eq.{user_id}&deck_id=eq.{deck_id}",
            headers={**hdrs(token), "Range": f"{offset}-{offset + page_size - 1}", "Prefer": "count=none"},
            timeout=30,
        )
        r.raise_for_status()
        chunk = r.json()
        for row in chunk:
            q = normalize_question_key(row.get("question") or "")
            if q:
                keys.add(q)
        if len(chunk) < page_size:
            break
        offset += page_size
    return keys


def is_cards_duplicate_conflict(exc: RuntimeError) -> bool:
    msg = str(exc)
    return "23505" in msg and "cards_unique_question_per_deck" in msg


def default_srs() -> dict:
    return {"interval": 1, "easeFactor": 2.5, "repetitions": 0, "due": datetime.now(timezone.utc).isoformat()}


def default_stats() -> dict:
    return {"totalReviews": 0, "correct": 0, "incorrect": 0}


def prepare_rows(report_rows: List[dict]) -> List[dict]:
    dedupe = {}
    for row in report_rows:
        q = normalize_text(row.get("question", ""))
        a = normalize_text(row.get("answer", ""))
        m = normalize_text(row.get("masechet", ""))
        rg = normalize_text(row.get("range_label", ""))
        if not q or not a or not m or not rg:
            continue
        key = f"{m}::{rg}::{q.lower()}"
        if key not in dedupe:
            dedupe[key] = {
                "masechet": m,
                "range_label": rg,
                "question": q,
                "answer": a,
            }
    return list(dedupe.values())


def run(token: str, user_id: str, rows: List[dict], execute: bool) -> dict:
    prepared = prepare_rows(rows)
    cats = CatManager(token, user_id) if execute else None

    deck_id = ensure_deck(token, user_id) if execute else (find_existing_deck(token, user_id) or "DRY_DECK")
    existing = load_existing_deck_questions(token, user_id, deck_id) if deck_id != "DRY_DECK" else set()
    in_run_seen = set(existing)

    to_insert = []
    duplicate = 0
    missing = 0

    root_id = None
    if execute and cats:
        root_id = cats.ensure(ROOT_CAT_NAME, None)

    now = datetime.now(timezone.utc).isoformat()

    for row in prepared:
        m = row["masechet"]
        rg = row["range_label"]
        q = row["question"]
        a = row["answer"]
        if not a:
            missing += 1
            continue

        range_tag = f"cat:{rg}"
        question_key = normalize_question_key(q)
        if question_key in in_run_seen:
            duplicate += 1
            continue

        tags = [f"cat:{ROOT_CAT_NAME}", f"cat:{m}", range_tag, "source:question-lab"]

        if execute and cats and root_id:
            m_id = cats.ensure(m, root_id)
            cats.ensure(rg, m_id)

        to_insert.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "deck_id": deck_id,
            "type": "flashcard",
            "question": q,
            "answer": a,
            "options": None,
            "correct_indices": None,
            "correct_boolean": None,
            "explanation": None,
            "tags": tags,
            "srs": default_srs(),
            "stats": default_stats(),
            "created_at": now,
        })
        in_run_seen.add(question_key)

    inserted = 0
    if execute and to_insert:
        chunk = 250
        for i in range(0, len(to_insert), chunk):
            batch = to_insert[i:i + chunk]
            try:
                insert_rows(token, "cards", batch)
                inserted += len(batch)
            except RuntimeError as exc:
                if not is_cards_duplicate_conflict(exc):
                    raise
                for card in batch:
                    try:
                        insert_rows(token, "cards", [card])
                        inserted += 1
                    except RuntimeError as row_exc:
                        if is_cards_duplicate_conflict(row_exc):
                            duplicate += 1
                            continue
                        raise

    return {
        "prepared_rows": len(prepared),
        "to_insert": len(to_insert),
        "inserted": inserted,
        "duplicates": duplicate,
        "missing_answers": missing,
        "execute": execute,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Import extracted Q/A report to Supabase")
    ap.add_argument("--report", required=True, help="Path to extracted report json")
    ap.add_argument("--dry-run-first", action="store_true", help="Run dry-run summary before execute")
    ap.add_argument("--execute", action="store_true", help="Actually insert into DB")
    args = ap.parse_args()

    payload = json.loads(Path(args.report).read_text(encoding="utf-8"))
    rows = payload.get("rows") or []

    token, user_id = login()

    if args.dry_run_first:
        dry = run(token, user_id, rows, execute=False)
        print("DRY-RUN:", json.dumps(dry, ensure_ascii=False))

    if args.execute:
        real = run(token, user_id, rows, execute=True)
        print("COMMIT:", json.dumps(real, ensure_ascii=False))
    else:
        print("No execute flag. Finished dry-run only.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
