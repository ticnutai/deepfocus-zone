"""
Extract potential Neviim/Tanakh multiple-choice questions from local PDFs,
then run the Neviim extraction model on each candidate.

Usage:
  python scripts/extract_neviim_questions_from_pdfs.py

Input dir:
  output/neviim_questions/pdfs

Outputs:
  output/neviim_questions/pdf_extracted_questions.json
  output/neviim_questions/pdf_extracted_questions.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from dataclasses import asdict

from neviim_extraction_model import extract_reference

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None


def read_pdf_text(path: str) -> str:
    if not PdfReader:
        raise RuntimeError("pypdf is not installed")

    reader = PdfReader(path)
    chunks: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        chunks.append(text)
    return "\n".join(chunks)


def split_candidates(text: str) -> list[str]:
    text = re.sub(r"\r", "\n", text)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    candidates: list[str] = []
    buf: list[str] = []

    for line in lines:
        buf.append(line)
        block = " ".join(buf[-8:])

        has_question_mark = "?" in block
        has_options = bool(re.search(r"(?:^|\s)[אבגדה]\s*[\)\].:-]", block))

        if has_question_mark or has_options:
            if len(block) >= 25:
                candidates.append(re.sub(r"\s+", " ", block))

    # dedupe
    seen = set()
    uniq = []
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        uniq.append(c)
    return uniq


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Neviim questions from PDFs")
    parser.add_argument("--pdf-dir", default="output/neviim_questions/pdfs")
    parser.add_argument("--out", default="output/neviim_questions/pdf_extracted_questions.json")
    parser.add_argument("--csv-out", default="output/neviim_questions/pdf_extracted_questions.csv")
    parser.add_argument("--only-full-ref", action="store_true", help="Keep only records with full book+chapter+verse")
    args = parser.parse_args()

    if not PdfReader:
        raise SystemExit("❌ Missing dependency: pypdf. Run: pip install pypdf")

    if not os.path.isdir(args.pdf_dir):
        raise SystemExit(f"❌ PDF dir not found: {args.pdf_dir}")

    records = []

    for fname in os.listdir(args.pdf_dir):
        if not fname.lower().endswith(".pdf"):
            continue

        path = os.path.join(args.pdf_dir, fname)
        try:
            text = read_pdf_text(path)
        except Exception as ex:
            print(f"[skip] {fname}: {ex}")
            continue

        candidates = split_candidates(text)

        for block in candidates:
            ext = extract_reference(block)
            if args.only_full_ref and not (ext.canonical_book and ext.chapter and ext.verse_start):
                continue

            records.append(
                {
                    "pdf_file": fname,
                    "question_text": block,
                    "option_a": ext.options[0] if len(ext.options) > 0 else "",
                    "option_b": ext.options[1] if len(ext.options) > 1 else "",
                    "option_c": ext.options[2] if len(ext.options) > 2 else "",
                    "option_d": ext.options[3] if len(ext.options) > 3 else "",
                    "option_e": ext.options[4] if len(ext.options) > 4 else "",
                    "canonical_book": ext.canonical_book,
                    "chapter": ext.chapter,
                    "verse": ext.verse_start,
                    "verse_end": ext.verse_end,
                    "reference_confidence": ext.confidence,
                    "reference_strategy": ext.strategy,
                }
            )

    # dedupe
    dedup = []
    seen = set()
    for r in records:
        key = (r["pdf_file"], r["question_text"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(r)

    ensure_dir(os.path.dirname(args.out) or ".")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(dedup, f, ensure_ascii=False, indent=2)

    with open(args.csv_out, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "pdf_file",
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
        for row in dedup:
            writer.writerow(row)

    print("=== Done ===")
    print(f"Extracted: {len(dedup)}")
    print(f"JSON: {args.out}")
    print(f"CSV: {args.csv_out}")


if __name__ == "__main__":
    main()
