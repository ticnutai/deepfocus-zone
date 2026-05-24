"""
מוריד קבצי PDF מקובץ קישורים שנוצר על ידי expand_neviim_resource_links.py.

קלט:
  output/neviim_questions/pdf_links.json

פלט:
  output/neviim_questions/pdfs/
  output/neviim_questions/downloaded_pdfs.json

שימוש:
  python scripts/download_neviim_pdfs.py
"""

from __future__ import annotations

import argparse
import json
import os
from urllib.parse import urlparse

import requests


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NeviimPdfDownloader/1.0)",
}


def safe_filename_from_url(url: str, idx: int) -> str:
    parsed = urlparse(url)
    base = os.path.basename(parsed.path) or f"file_{idx}.pdf"
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    return base.replace(" ", "_")


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download PDF links discovered by Neviim pipeline")
    parser.add_argument("--in", dest="in_file", default="output/neviim_questions/pdf_links.json")
    parser.add_argument("--dir", default="output/neviim_questions/pdfs")
    parser.add_argument("--report", default="output/neviim_questions/downloaded_pdfs.json")
    args = parser.parse_args()

    with open(args.in_file, "r", encoding="utf-8") as f:
        links = json.load(f)

    ensure_dir(args.dir)

    report = []

    for i, item in enumerate(links, start=1):
        url = item.get("link_url")
        if not url:
            continue

        filename = safe_filename_from_url(url, i)
        target = os.path.join(args.dir, filename)

        try:
            r = requests.get(url, headers=HEADERS, timeout=45)
            status = r.status_code
            if status >= 400:
                report.append({
                    "url": url,
                    "status": status,
                    "saved": False,
                    "path": target,
                })
                continue

            content_type = (r.headers.get("content-type") or "").lower()
            is_pdf = "pdf" in content_type or url.lower().endswith(".pdf")

            if not is_pdf:
                report.append({
                    "url": url,
                    "status": status,
                    "saved": False,
                    "path": target,
                    "reason": f"not_pdf_content_type:{content_type}",
                })
                continue

            with open(target, "wb") as out:
                out.write(r.content)

            report.append({
                "url": url,
                "status": status,
                "saved": True,
                "path": target,
                "bytes": len(r.content),
            })
        except Exception as ex:
            report.append({
                "url": url,
                "status": None,
                "saved": False,
                "path": target,
                "reason": str(ex),
            })

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    ok = sum(1 for r in report if r.get("saved"))
    print("=== Done ===")
    print(f"Downloaded: {ok}/{len(report)}")
    print(f"Report: {args.report}")


if __name__ == "__main__":
    main()
