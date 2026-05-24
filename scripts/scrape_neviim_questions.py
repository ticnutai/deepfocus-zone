"""
מערכת איסוף שאלות אמריקאיות בנביא/תנ"ך + חילוץ מיקום (ספר/פרק/פסוק).

מה הסקריפט עושה:
1. קורא רשימת מקורות מ-JSON.
2. מוריד HTML מכל מקור.
3. מנסה לזהות שאלות אמריקאיות (שאלה + אפשרויות א/ב/ג/ד).
4. מחלץ הפניה מקראית: ספר, פרק, פסוק.
5. שומר פלט אחיד ל-JSON + דוח איכות.

שימוש:
  python scripts/scrape_neviim_questions.py
  python scripts/scrape_neviim_questions.py --sources scripts/neviim_sources.json --out output/neviim_questions/questions.json

דרישות:
  pip install requests beautifulsoup4
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import urljoin

import requests
from neviim_extraction_model import extract_reference as model_extract_reference

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NeviimQuestionCollector/1.0)",
    "Accept-Language": "he,en;q=0.8",
}


@dataclass
class QuestionRecord:
    source_id: str
    source_name: str
    source_type: str
    source_url: str
    question_text: str
    options: list[str]
    canonical_book: Optional[str]
    chapter: Optional[int]
    verse: Optional[int]
    verse_end: Optional[int]
    reference_confidence: float
    reference_strategy: Optional[str]


@dataclass
class ResourceLink:
    source_id: str
    source_url: str
    link_text: str
    link_url: str
    kind: str


def fetch_html(url: str, timeout: int = 25) -> tuple[Optional[str], Optional[str], Optional[int]]:
    try:
        response = requests.get(url, headers=HEADERS, timeout=timeout)
    except Exception:
        return None, None, None
    if response.status_code >= 400:
        return None, None, response.status_code
    response.encoding = response.apparent_encoding or "utf-8"
    return response.text, response.url, response.status_code


def extract_candidate_question_blocks(page_text: str) -> list[str]:
    lines = [ln.strip() for ln in page_text.splitlines()]
    lines = [ln for ln in lines if ln]

    candidates: list[str] = []
    buffer: list[str] = []

    for ln in lines:
        buffer.append(ln)
        if "?" in ln or "?" in " ".join(buffer):
            block = " ".join(buffer[-6:])
            if len(block) > 20:
                candidates.append(block)

    # הסרת כפילויות
    seen = set()
    uniq = []
    for c in candidates:
        key = re.sub(r"\s+", " ", c)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(key)
    return uniq


def extract_resource_links(html: str, base_url: str, source_id: str) -> list[ResourceLink]:
    if not BeautifulSoup:
        return []

    soup = BeautifulSoup(html, "html.parser")
    links: list[ResourceLink] = []

    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        text = a.get_text(" ", strip=True)
        if not href:
            continue
        full = urljoin(base_url, href)

        lowered = (text + " " + full).lower()
        if any(k in lowered for k in ["שאלה", "שאלון", "בגרות", "quiz", "מבחן", ".pdf", "pdf"]):
            kind = "pdf_or_exam_link" if ".pdf" in lowered or "בגרות" in lowered else "question_link"
            links.append(
                ResourceLink(
                    source_id=source_id,
                    source_url=base_url,
                    link_text=text[:240],
                    link_url=full,
                    kind=kind,
                )
            )

    # dedupe
    out = []
    seen = set()
    for r in links:
        key = (r.link_url, r.kind)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def parse_source(source: dict) -> tuple[list[QuestionRecord], list[ResourceLink], dict]:
    source_id = source["id"]
    source_name = source.get("name", source_id)
    source_type = source.get("type", "unknown")
    url = source["url"]

    html, final_url, status = fetch_html(url)
    if not html:
        return [], [], {
            "source_id": source_id,
            "url": url,
            "status": status,
            "notes": "fetch_failed_or_blocked",
            "questions_found": 0,
        }

    if BeautifulSoup:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text("\n")
    else:
        text = re.sub(r"<[^>]+>", " ", html)

    blocks = extract_candidate_question_blocks(text)
    questions: list[QuestionRecord] = []

    tanach_keywords = ["תנ\"ך", "תנך", "נביא", "נביאים", "פסוק", "פרק", "בגרות"]
    noisy_keywords = ["יוטיוב", "אינסטגרם", "פייסבוק", "וירוסים", "רוגלות", "סרטונים", "וואטסאפ"]

    for block in blocks:
        # סינון ראשוני: חייבת להיות שאלה
        if "?" not in block:
            continue
        if len(block) < 25:
            continue

        extraction = model_extract_reference(block)
        options = extraction.options
        book = extraction.canonical_book
        chapter = extraction.chapter
        verse = extraction.verse_start
        verse_end = extraction.verse_end
        confidence = extraction.confidence
        strategy = extraction.strategy

        has_tanach_hint = bool(book) or any(k in block for k in tanach_keywords)
        has_noise = any(k in block for k in noisy_keywords)

        # משאיר רק שאלות שנראות קשורות לנביא/תנ"ך.
        if has_noise:
            continue
        if not has_tanach_hint:
            continue
        if not options and confidence < 0.3:
            continue

        questions.append(
            QuestionRecord(
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_url=final_url or url,
                question_text=block[:1200],
                options=options,
                canonical_book=book,
                chapter=chapter,
                verse=verse,
                verse_end=verse_end,
                reference_confidence=confidence,
                reference_strategy=strategy,
            )
        )

    resources = extract_resource_links(html, final_url or url, source_id)

    summary = {
        "source_id": source_id,
        "url": final_url or url,
        "status": status,
        "questions_found": len(questions),
        "resource_links_found": len(resources),
    }
    return questions, resources, summary


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Neviim/Tanakh multiple-choice questions and extract references")
    parser.add_argument("--sources", default="scripts/neviim_sources.json", help="Path to sources JSON")
    parser.add_argument("--out", default="output/neviim_questions/questions.json", help="Questions output JSON")
    parser.add_argument("--csv-out", default="output/neviim_questions/questions.csv", help="Questions output CSV")
    parser.add_argument("--resources-out", default="output/neviim_questions/resource_links.json", help="Resource links output JSON")
    parser.add_argument("--report", default="output/neviim_questions/report.json", help="Summary report JSON")
    parser.add_argument("--only-full-ref", action="store_true", help="Keep only records with canonical_book + chapter + verse")
    args = parser.parse_args()

    with open(args.sources, "r", encoding="utf-8") as f:
        sources = json.load(f)

    all_questions: list[QuestionRecord] = []
    all_resources: list[ResourceLink] = []
    source_summaries = []

    for src in sources:
        print(f"[*] Scraping: {src.get('name', src['id'])}")
        qs, resources, summary = parse_source(src)
        all_questions.extend(qs)
        all_resources.extend(resources)
        source_summaries.append(summary)
        print(f"    questions={summary.get('questions_found', 0)}, resources={summary.get('resource_links_found', 0)}")
        time.sleep(0.3)

    # dedupe שאלות לפי מקור+טקסט
    unique_questions: list[QuestionRecord] = []
    seen_q = set()
    for q in all_questions:
        key = (q.source_id, re.sub(r"\s+", " ", q.question_text.strip()))
        if key in seen_q:
            continue
        seen_q.add(key)
        unique_questions.append(q)

    questions_with_full_ref = [q for q in unique_questions if q.canonical_book and q.chapter and q.verse]
    questions_with_partial_ref = [q for q in unique_questions if q.canonical_book and (q.chapter is not None) and (q.verse is None)]

    output_questions = questions_with_full_ref if args.only_full_ref else unique_questions

    ensure_dir(os.path.dirname(args.out) or ".")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump([asdict(q) for q in output_questions], f, ensure_ascii=False, indent=2)

    with open(args.csv_out, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "source_id",
                "source_name",
                "source_type",
                "source_url",
                "question_text",
                "option_a",
                "option_b",
                "option_c",
                "option_d",
                "option_e",
                "canonical_book",
                "chapter",
                "verse",
                "verse_end",
                "reference_confidence",
                "reference_strategy",
            ],
        )
        writer.writeheader()
        for q in output_questions:
            row = {
                "source_id": q.source_id,
                "source_name": q.source_name,
                "source_type": q.source_type,
                "source_url": q.source_url,
                "question_text": q.question_text,
                "option_a": q.options[0] if len(q.options) > 0 else "",
                "option_b": q.options[1] if len(q.options) > 1 else "",
                "option_c": q.options[2] if len(q.options) > 2 else "",
                "option_d": q.options[3] if len(q.options) > 3 else "",
                "option_e": q.options[4] if len(q.options) > 4 else "",
                "canonical_book": q.canonical_book,
                "chapter": q.chapter,
                "verse": q.verse,
                "verse_end": q.verse_end,
                "reference_confidence": q.reference_confidence,
                "reference_strategy": q.reference_strategy,
            }
            writer.writerow(row)

    with open(args.resources_out, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in all_resources], f, ensure_ascii=False, indent=2)

    report = {
        "total_questions": len(unique_questions),
        "total_questions_output": len(output_questions),
        "questions_with_full_ref": len(questions_with_full_ref),
        "questions_with_partial_ref": len(questions_with_partial_ref),
        "total_resource_links": len(all_resources),
        "sources": source_summaries,
        "notes": [
            "זיהוי ההפניה מבוסס היוריסטיקות טקסטואליות ודורש בקרת איכות ידנית.",
            "בקישורי PDF מומלץ שלב OCR/פענוח נוסף כדי לחלץ שאלות בצורה מלאה.",
        ],
    }

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n=== Done ===")
    print(f"Questions: {args.out}")
    print(f"Questions CSV: {args.csv_out}")
    print(f"Resource links: {args.resources_out}")
    print(f"Report: {args.report}")
    print(f"Total questions: {len(unique_questions)}")
    print(f"Total questions in output: {len(output_questions)}")
    print(f"With full reference: {len(questions_with_full_ref)}")


if __name__ == "__main__":
    main()
