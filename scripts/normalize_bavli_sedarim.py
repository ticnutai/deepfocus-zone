#!/usr/bin/env python3
"""
Normalize Bavli category tree:
- Keep only intended roots: תלמוד בבלי, טור, ללא סיווג (does not delete roots).
- Ensure six Sedarim under תלמוד בבלי.
- Merge abbreviation categories into canonical masechtot (בק->בבא קמא, במ->בבא מציעא, בב->בבא בתרא, רה->ראש השנה, עז->עבודה זרה).
- Move masechtot under their matching Seder.
- Merge duplicates by (name,parent) during moves.

Usage:
  python scripts/normalize_bavli_sedarim.py --dry-run
  python scripts/normalize_bavli_sedarim.py --execute
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
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

ROOT_BAVLI = "תלמוד בבלי"
SEDARIM = ["זרעים", "מועד", "נשים", "נזיקין", "קדשים", "טהרות"]

ABBREV_TO_FULL = {
    "בק": "בבא קמא",
    "במ": "בבא מציעא",
    "בב": "בבא בתרא",
    "רה": "ראש השנה",
    "עז": "עבודה זרה",
}

MASECHET_TO_SEDER = {
    # זרעים
    "ברכות": "זרעים",
    # מועד
    "שבת": "מועד",
    "עירובין": "מועד",
    "פסחים": "מועד",
    "שקלים": "מועד",
    "יומא": "מועד",
    "סוכה": "מועד",
    "ביצה": "מועד",
    "ראש השנה": "מועד",
    "תענית": "מועד",
    "מגילה": "מועד",
    "מועד קטן": "מועד",
    "חגיגה": "מועד",
    # נשים
    "יבמות": "נשים",
    "כתובות": "נשים",
    "נדרים": "נשים",
    "נזיר": "נשים",
    "סוטה": "נשים",
    "גיטין": "נשים",
    "קידושין": "נשים",
    "נידה": "נשים",
    # נזיקין
    "בבא קמא": "נזיקין",
    "בבא מציעא": "נזיקין",
    "בבא בתרא": "נזיקין",
    "סנהדרין": "נזיקין",
    "מכות": "נזיקין",
    "שבועות": "נזיקין",
    "עבודה זרה": "נזיקין",
    "הוריות": "נזיקין",
    # קדשים
    "זבחים": "קדשים",
    "מנחות": "קדשים",
    "חולין": "קדשים",
    "בכורות": "קדשים",
    "ערכין": "קדשים",
    "תמורה": "קדשים",
    "כריתות": "קדשים",
    "מעילה": "קדשים",
    "תמיד": "קדשים",
    "מידות": "קדשים",
    "קינים": "קדשים",
}


@dataclass
class Category:
    id: str
    name: str
    parent_id: Optional[str]
    created_at: Optional[str]


class Runner:
    def __init__(self, execute: bool):
        self.execute = execute
        self.token, self.user_id = self.login()
        self.now = datetime.now(timezone.utc).isoformat()
        self.stats = defaultdict(int)
        self.reload_categories()

    def login(self) -> Tuple[str, str]:
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"apikey": ANON_KEY},
            timeout=30,
        )
        r.raise_for_status()
        d = r.json()
        return d["access_token"], d["user"]["id"]

    def headers(self, write: bool = False) -> dict:
        base = {"Authorization": f"Bearer {self.token}", "apikey": ANON_KEY}
        if write:
            base["Content-Type"] = "application/json"
            base["Prefer"] = "return=representation"
        return base

    def reload_categories(self):
        rows: List[Category] = []
        offset = 0
        while True:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/categories",
                params={
                    "select": "id,name,parent_id,created_at",
                    "user_id": f"eq.{self.user_id}",
                    "deleted_at": "is.null",
                    "limit": 1000,
                    "offset": offset,
                },
                headers=self.headers(),
                timeout=30,
            )
            r.raise_for_status()
            chunk = r.json()
            rows.extend(
                Category(
                    id=x["id"],
                    name=x["name"],
                    parent_id=x.get("parent_id"),
                    created_at=x.get("created_at"),
                )
                for x in chunk
            )
            if len(chunk) < 1000:
                break
            offset += 1000

        self.categories = rows
        self.by_id: Dict[str, Category] = {c.id: c for c in rows}
        self.children: Dict[Optional[str], List[Category]] = defaultdict(list)
        for c in rows:
            self.children[c.parent_id].append(c)

        self.by_key: Dict[Tuple[str, Optional[str]], List[Category]] = defaultdict(list)
        for c in rows:
            self.by_key[(c.name, c.parent_id)].append(c)

    def pick_keep(self, cats: List[Category]) -> Category:
        return sorted(cats, key=lambda x: x.created_at or "")[0]

    def patch_category(self, cat_id: str, payload: dict):
        if not self.execute:
            return
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/categories?id=eq.{cat_id}&user_id=eq.{self.user_id}",
            headers=self.headers(write=True),
            json=payload,
            timeout=30,
        )
        if not r.ok:
            raise RuntimeError(f"PATCH categories failed {r.status_code}: {r.text[:300]}")

    def patch_cards_category(self, old_id: str, new_id: str):
        if not self.execute:
            return
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/cards?user_id=eq.{self.user_id}&category_id=eq.{old_id}",
            headers=self.headers(write=True),
            json={"category_id": new_id},
            timeout=30,
        )
        if r.ok:
            self.stats["cards_repointed"] += 1
            return

        # Some deployments store category relation only in tags and do not have cards.category_id.
        if r.status_code == 400 and "PGRST204" in r.text and "category_id" in r.text:
            self.stats["cards_category_column_missing"] += 1
            return

        raise RuntimeError(f"PATCH cards failed {r.status_code}: {r.text[:300]}")

    def soft_delete_category(self, cat_id: str):
        if not self.execute:
            return
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/categories?id=eq.{cat_id}&user_id=eq.{self.user_id}",
            headers=self.headers(write=True),
            json={"deleted_at": self.now},
            timeout=30,
        )
        if not r.ok:
            raise RuntimeError(f"soft delete failed {r.status_code}: {r.text[:300]}")

    def create_category(self, name: str, parent_id: Optional[str]) -> str:
        existing = self.by_key.get((name, parent_id), [])
        if existing:
            return self.pick_keep(existing).id

        if not self.execute:
            fake_id = f"DRY-{name}-{parent_id or 'root'}"
            self.stats["created_sedarim"] += 1
            return fake_id

        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/categories",
            headers=self.headers(write=True),
            json=[
                {
                    "name": name,
                    "parent_id": parent_id,
                    "user_id": self.user_id,
                    "sort_order": 0,
                    "created_at": self.now,
                }
            ],
            timeout=30,
        )
        if not r.ok:
            raise RuntimeError(f"create category failed {r.status_code}: {r.text[:300]}")
        created = r.json()[0]
        self.stats["created_sedarim"] += 1
        return created["id"]

    def merge_category(self, drop_id: str, keep_id: str):
        if drop_id == keep_id:
            return

        drop = self.by_id.get(drop_id)
        keep = self.by_id.get(keep_id)
        if not drop or not keep:
            return

        # Move/merge descendants first.
        drop_children = list(self.children.get(drop_id, []))
        for child in drop_children:
            same_under_keep = self.by_key.get((child.name, keep_id), [])
            if same_under_keep:
                keep_child = self.pick_keep(same_under_keep)
                self.merge_category(child.id, keep_child.id)
            else:
                self.patch_category(child.id, {"parent_id": keep_id})
                self.stats["reparented_children"] += 1

        # Move direct cards bound by category_id.
        self.patch_cards_category(drop_id, keep_id)

        # Soft-delete duplicate node.
        self.soft_delete_category(drop_id)
        self.stats["merged_categories"] += 1

        if not self.execute:
            return

        self.reload_categories()

    def ensure_single_root(self, root_name: str) -> str:
        roots = [c for c in self.children.get(None, []) if c.name == root_name]
        if not roots:
            raise RuntimeError(f"Missing root category: {root_name}")
        keep = self.pick_keep(roots)
        for c in roots:
            if c.id != keep.id:
                self.merge_category(c.id, keep.id)
        if self.execute:
            self.reload_categories()
        return keep.id

    def normalize(self):
        bavli_root_id = self.ensure_single_root(ROOT_BAVLI)

        # Ensure six sedarim under Bavli root.
        seder_ids: Dict[str, str] = {}
        for seder in SEDARIM:
            seder_id = self.create_category(seder, bavli_root_id)
            seder_ids[seder] = seder_id
        if self.execute:
            self.reload_categories()
            for seder in SEDARIM:
                seder_ids[seder] = self.pick_keep(self.by_key[(seder, bavli_root_id)]).id

        # Merge shorthand categories into canonical masechet categories.
        for short_name, full_name in ABBREV_TO_FULL.items():
            shorts = list(self.by_key.get((short_name, bavli_root_id), []))
            if not shorts:
                continue

            full_candidates = list(self.by_key.get((full_name, bavli_root_id), []))
            if full_candidates:
                full_keep = self.pick_keep(full_candidates)
            else:
                seder = MASECHET_TO_SEDER.get(full_name)
                parent_id = seder_ids.get(seder, bavli_root_id)
                full_keep_id = self.create_category(full_name, parent_id)
                if self.execute:
                    self.reload_categories()
                    full_keep = self.pick_keep(self.by_key[(full_name, parent_id)])
                else:
                    full_keep = Category(id=full_keep_id, name=full_name, parent_id=parent_id, created_at=None)

            for sc in shorts:
                self.merge_category(sc.id, full_keep.id)

        if self.execute:
            self.reload_categories()

        # Move/merge all known masechtot under their seder.
        for masechet, seder in MASECHET_TO_SEDER.items():
            target_parent = seder_ids[seder]

            # Any instance under Bavli root should be moved/merged under seder.
            under_root = list(self.by_key.get((masechet, bavli_root_id), []))
            under_target = list(self.by_key.get((masechet, target_parent), []))

            target_keep: Optional[Category] = self.pick_keep(under_target) if under_target else None

            if not target_keep and under_root:
                # Move first root occurrence to target parent.
                mover = self.pick_keep(under_root)
                self.patch_category(mover.id, {"parent_id": target_parent})
                self.stats["moved_masechtot"] += 1
                if self.execute:
                    self.reload_categories()
                    target_keep = self.pick_keep(self.by_key[(masechet, target_parent)])
                else:
                    target_keep = Category(id=mover.id, name=masechet, parent_id=target_parent, created_at=mover.created_at)

            if not target_keep:
                # Masechet absent; skip creation intentionally.
                continue

            # Merge extra copies under target.
            all_target = list(self.by_key.get((masechet, target_parent), []))
            for c in all_target:
                if c.id != target_keep.id:
                    self.merge_category(c.id, target_keep.id)

            # Merge remaining copies under root into target.
            all_root_now = list(self.by_key.get((masechet, bavli_root_id), []))
            for c in all_root_now:
                self.merge_category(c.id, target_keep.id)

            if self.execute:
                self.reload_categories()

        # Final duplicate sweep under Bavli tree for known names.
        if self.execute:
            self.reload_categories()

        duplicate_groups = 0
        for (name, parent_id), group in list(self.by_key.items()):
            if len(group) <= 1:
                continue
            duplicate_groups += 1
            keep = self.pick_keep(group)
            for c in group:
                if c.id != keep.id:
                    self.merge_category(c.id, keep.id)

        self.stats["duplicate_groups_seen"] = duplicate_groups

        if self.execute:
            self.reload_categories()

        roots = [c.name for c in self.children.get(None, [])]
        print("ROOTS:", roots)
        print("BAVLI_CHILDREN:", [c.name for c in self.children.get(bavli_root_id, [])])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="Apply changes")
    ap.add_argument("--dry-run", action="store_true", help="Preview only")
    args = ap.parse_args()

    execute = args.execute and not args.dry_run
    runner = Runner(execute=execute)
    print(f"mode={'EXECUTE' if execute else 'DRY-RUN'} user_id={runner.user_id}")
    runner.normalize()
    print("STATS:", dict(runner.stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
