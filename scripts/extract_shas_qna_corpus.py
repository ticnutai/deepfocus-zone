#!/usr/bin/env python3
import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

Q_RE = re.compile(r"^\(?\s*([א-ת]{1,3})\s*\)?[\).]\s*(.+)$")
A_RE_WITH_WORD = re.compile(r"^(?:תשובה|תשובות|התשובה|התשובות)\s*([א-ת]{1,3})\s*[:\-\.\)]\s*(.*)$")
A_RE_PLAIN = re.compile(r"^\(?\s*([א-ת]{1,3})\s*\)?[:\-\.]\s*(.+)$")
ANS_SECTION_RE = re.compile(r"(תשובות|התשובות|פתרונות)")


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def normalize_key(s: str) -> str:
    return "".join(ch for ch in (s or "") if "א" <= ch <= "ת")


def parse_file_name(file_name: str, fallback_masechet: str) -> Tuple[str, str]:
    stem = Path(file_name).stem
    stem = re.sub(r"^גיבוי של\s*", "", stem)
    if " - " not in stem:
        return fallback_masechet, stem

    left, right = stem.split(" - ", 1)
    left_parts = left.split()
    if len(left_parts) <= 1:
        return fallback_masechet, f"{left.strip()}-{right.strip()}"

    masechet = " ".join(left_parts[:-1]).strip()
    start = left_parts[-1].strip()
    return masechet or fallback_masechet, f"{start}-{right.strip()}"


def read_docx_lines(path: Path) -> List[str]:
    with zipfile.ZipFile(path, "r") as zf:
        xml_data = zf.read("word/document.xml")
    root = ET.fromstring(xml_data)
    lines: List[str] = []
    for p in root.findall(f".//{{{W_NS}}}p"):
        runs = [t.text or "" for t in p.findall(f".//{{{W_NS}}}t")]
        line = normalize_text("".join(runs))
        if line:
            lines.append(line)
    return lines


def read_pdf_lines(path: Path) -> List[str]:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:
        raise RuntimeError("pypdf is required for PDF fallback. Install with: pip install pypdf") from exc

    reader = PdfReader(str(path))
    text_parts: List[str] = []
    for page in reader.pages:
        text_parts.append(page.extract_text() or "")
    raw = "\n".join(text_parts)
    lines = [normalize_text(x) for x in raw.splitlines()]
    return [x for x in lines if x]


def split_sections(lines: List[str]) -> Tuple[List[str], List[str]]:
    idx = -1
    for i, line in enumerate(lines):
        if ANS_SECTION_RE.search(line):
            idx = i
            break
    if idx == -1:
        return lines, lines
    return lines[:idx], lines[idx:]


def parse_questions(lines: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    current: Optional[str] = None
    for line in lines:
        m = Q_RE.match(line)
        if m:
            k = normalize_key(m.group(1))
            out[k] = normalize_text(m.group(2))
            current = k
            continue
        if current:
            out[current] = normalize_text(out[current] + " " + line)
    return out


def parse_answers(lines: List[str], strict_with_word: bool) -> Dict[str, str]:
    out: Dict[str, str] = {}
    current: Optional[str] = None
    for line in lines:
        m = A_RE_WITH_WORD.match(line)
        if m:
            k = normalize_key(m.group(1))
            out[k] = normalize_text(m.group(2))
            current = k
            continue
        if not strict_with_word:
            m2 = A_RE_PLAIN.match(line)
            if m2:
                k = normalize_key(m2.group(1))
                out[k] = normalize_text(m2.group(2))
                current = k
                continue
        if current:
            out[current] = normalize_text(out[current] + " " + line)
    return out


def extract_pairs(path: Path) -> Tuple[List[Dict[str, str]], int, int]:
    if path.suffix.lower() == ".docx":
        lines = read_docx_lines(path)
    else:
        lines = read_pdf_lines(path)

    q_lines, a_lines = split_sections(lines)
    strict = q_lines == a_lines
    q = parse_questions(q_lines)
    a = parse_answers(a_lines, strict_with_word=strict)

    pairs: List[Dict[str, str]] = []
    for k, q_text in q.items():
        ans = a.get(k)
        if ans:
            pairs.append({"key": k, "question": q_text, "answer": ans})
    return pairs, len(q), len(a)


def choose_sources(root: Path) -> List[Path]:
    docx_files = sorted(root.rglob("*.docx"))
    pdf_files = sorted(root.rglob("*.pdf"))

    by_stem = {str(p.with_suffix("")).lower(): p for p in docx_files}
    chosen = list(docx_files)
    for p in pdf_files:
        k = str(p.with_suffix("")).lower()
        if k not in by_stem:
            chosen.append(p)
    return sorted(chosen)


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract full corpus Q/A from DOCX with PDF fallback")
    ap.add_argument("--root", required=True, help="Root folder of source files")
    ap.add_argument("--out", required=True, help="Output report JSON path")
    args = ap.parse_args()

    root = Path(args.root)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    files = choose_sources(root)

    results = []
    rows = []
    failed = []
    dedupe = set()

    for p in files:
        fallback_masechet = p.parent.name
        masechet, range_label = parse_file_name(p.name, fallback_masechet)
        try:
            pairs, q_total, a_total = extract_pairs(p)
        except Exception as exc:
            failed.append({"file": str(p), "error": str(exc)})
            continue

        uniq_pairs = []
        for pair in pairs:
            q_norm = normalize_text(pair["question"]).lower()
            key = f"{masechet}::{range_label}::{q_norm}"
            if key in dedupe:
                continue
            dedupe.add(key)
            uniq_pairs.append(pair)
            rows.append({
                "masechet": masechet,
                "range_label": range_label,
                "question": pair["question"],
                "answer": pair["answer"],
                "source_file": str(p),
            })

        results.append({
            "file": str(p),
            "source_type": p.suffix.lower().lstrip("."),
            "masechet": masechet,
            "range_label": range_label,
            "total_questions": q_total,
            "total_answers": a_total,
            "matched_pairs": len(uniq_pairs),
            "pairs": uniq_pairs,
            "sample_pairs": uniq_pairs[:5],
        })

    payload = {
        "summary": {
            "scanned_files": len(files),
            "processed_files": len(results),
            "failed_files": len(failed),
            "unique_pairs": len(rows),
        },
        "results": results,
        "rows": rows,
        "failed": failed,
    }

    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
