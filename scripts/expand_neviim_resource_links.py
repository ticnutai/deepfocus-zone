"""
מרחיב קישורי משאבים ומאתר קישורי שאלונים/PDF בעומק נוסף.

קלט:
  output/neviim_questions/resource_links.json

פלט:
  output/neviim_questions/expanded_resource_links.json
  output/neviim_questions/pdf_links.json

שימוש:
  python scripts/expand_neviim_resource_links.py
"""

from __future__ import annotations

import argparse
import json
import os
import time
from urllib.parse import urljoin

import requests

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NeviimLinkExpander/1.0)",
    "Accept-Language": "he,en;q=0.8",
}

KEYWORDS = ["שאלון", "בגרות", "בחינה", "מבחן", "תנ\"ך", "נביא", "פתרון", "pdf"]


def fetch(url: str, timeout: int = 25) -> tuple[str | None, str | None, int | None]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
    except Exception:
        return None, None, None
    if r.status_code >= 400:
        return None, r.url, r.status_code
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text, r.url, r.status_code


def extract_links(html: str, base_url: str) -> list[dict]:
    if not BeautifulSoup:
        return []

    soup = BeautifulSoup(html, "html.parser")
    out = []

    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        text = a.get_text(" ", strip=True)
        if not href:
            continue

        full = urljoin(base_url, href)
        combined = (text + " " + full).lower()
        if not any(k in combined for k in KEYWORDS):
            continue

        is_pdf = full.lower().endswith(".pdf") or ".pdf" in full.lower()
        out.append({
            "parent_url": base_url,
            "link_text": text[:240],
            "link_url": full,
            "kind": "pdf" if is_pdf else "candidate",
        })

    # dedupe
    seen = set()
    uniq = []
    for item in out:
        key = (item["link_url"], item["kind"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)
    return uniq


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Expand resource links and discover PDF exam/question links")
    parser.add_argument("--in", dest="in_file", default="output/neviim_questions/resource_links.json")
    parser.add_argument("--out", default="output/neviim_questions/expanded_resource_links.json")
    parser.add_argument("--pdf-out", default="output/neviim_questions/pdf_links.json")
    args = parser.parse_args()

    with open(args.in_file, "r", encoding="utf-8") as f:
        resources = json.load(f)

    expanded = []

    for rec in resources:
        url = rec.get("link_url")
        if not url:
            continue

        if url.lower().endswith(".pdf"):
            expanded.append({
                "parent_url": rec.get("source_url", ""),
                "link_text": rec.get("link_text", ""),
                "link_url": url,
                "kind": "pdf",
            })
            continue

        html, final_url, status = fetch(url)
        if not html:
            continue

        links = extract_links(html, final_url or url)
        expanded.extend(links)
        time.sleep(0.25)

    seen = set()
    uniq = []
    for item in expanded:
        key = item["link_url"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)

    pdf_links = [x for x in uniq if x["kind"] == "pdf"]

    ensure_dir(os.path.dirname(args.out) or ".")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(uniq, f, ensure_ascii=False, indent=2)

    with open(args.pdf_out, "w", encoding="utf-8") as f:
        json.dump(pdf_links, f, ensure_ascii=False, indent=2)

    print("=== Done ===")
    print(f"Expanded links: {len(uniq)} -> {args.out}")
    print(f"PDF links: {len(pdf_links)} -> {args.pdf_out}")


if __name__ == "__main__":
    main()
