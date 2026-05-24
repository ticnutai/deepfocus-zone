#!/usr/bin/env python3
import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

Q_RE = re.compile(r"^\(?\s*([א-ת]{1,3})\s*\)?[\).]\s*(.+)$")
A_RE_WITH_WORD = re.compile(r"^(?:תשובה|תשובות)\s*([א-ת]{1,3})\s*[:\-\.\)]\s*(.*)$")
A_RE_PLAIN = re.compile(r"^\(?\s*([א-ת]{1,3})\s*\)?[:\-\.]\s*(.+)$")
ANS_SECTION_RE = re.compile(r"(תשובות|התשובות|פתרונות)")


@dataclass
class DocPilotResult:
    file: str
    masechet: str
    range_label: str
    total_questions: int
    total_answers: int
    matched_pairs: int
    unmatched_question_keys: List[str]
    unmatched_answer_keys: List[str]
    pairs: List[Dict[str, str]]
    sample_pairs: List[Dict[str, str]]


def normalize_hebrew_key(key: str) -> str:
    return "".join(ch for ch in key if "א" <= ch <= "ת")


def read_docx_paragraphs(docx_path: Path) -> List[str]:
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml_data = zf.read("word/document.xml")

    root = ET.fromstring(xml_data)
    paragraphs: List[str] = []
    for p in root.findall(f".//{{{W_NS}}}p"):
        runs = []
        for t in p.findall(f".//{{{W_NS}}}t"):
            runs.append(t.text or "")
        line = "".join(runs)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            paragraphs.append(line)
    return paragraphs


def parse_file_name(file_name: str) -> Tuple[str, str]:
    stem = Path(file_name).stem
    stem = re.sub(r"^גיבוי של\s*", "", stem)
    if " - " not in stem:
        return stem, "לא_זוהה"

    left, right = stem.split(" - ", 1)
    left_parts = left.split()
    if not left_parts:
        return stem, right.strip()

    if len(left_parts) == 1:
        return left_parts[0], right.strip()

    masechet = " ".join(left_parts[:-1]).strip()
    start = left_parts[-1].strip()
    end = right.strip()
    return masechet, f"{start}-{end}"


def extract_section_lines(lines: List[str]) -> Tuple[List[str], List[str]]:
    ans_idx = -1
    for i, line in enumerate(lines):
        if ANS_SECTION_RE.search(line):
            ans_idx = i
            break

    if ans_idx == -1:
        return lines, lines
    return lines[:ans_idx], lines[ans_idx:]


def parse_questions(lines: List[str]) -> Dict[str, str]:
    questions: Dict[str, str] = {}
    current_key: Optional[str] = None

    for line in lines:
        m = Q_RE.match(line)
        if m:
            key = normalize_hebrew_key(m.group(1))
            text = m.group(2).strip()
            current_key = key
            questions[current_key] = text
            continue

        if current_key is not None:
            questions[current_key] = (questions[current_key] + " " + line).strip()

    return questions


def parse_answers(lines: List[str], strict_with_word: bool) -> Dict[str, str]:
    answers: Dict[str, str] = {}
    current_key: Optional[str] = None

    for line in lines:
        m = A_RE_WITH_WORD.match(line)
        if m:
            key = normalize_hebrew_key(m.group(1))
            text = m.group(2).strip()
            current_key = key
            answers[current_key] = text
            continue

        if not strict_with_word:
            m2 = A_RE_PLAIN.match(line)
            if m2:
                key = normalize_hebrew_key(m2.group(1))
                text = m2.group(2).strip()
                current_key = key
                answers[current_key] = text
                continue

        if current_key is not None:
            answers[current_key] = (answers[current_key] + " " + line).strip()

    return answers


def pair_qna(questions: Dict[str, str], answers: Dict[str, str]) -> Tuple[List[Tuple[str, str, str]], List[str], List[str]]:
    pairs: List[Tuple[str, str, str]] = []
    q_keys = set(questions.keys())
    a_keys = set(answers.keys())
    matched = sorted(q_keys.intersection(a_keys))

    for key in matched:
        pairs.append((key, questions[key], answers[key]))

    return pairs, sorted(q_keys - a_keys), sorted(a_keys - q_keys)


def process_docx(docx_path: Path) -> DocPilotResult:
    lines = read_docx_paragraphs(docx_path)
    q_lines, a_lines = extract_section_lines(lines)

    questions = parse_questions(q_lines)
    # If no explicit answers section, be strict and look only for lines beginning with "תשובה".
    strict = q_lines == a_lines
    answers = parse_answers(a_lines, strict_with_word=strict)

    pairs, unmatched_q, unmatched_a = pair_qna(questions, answers)
    masechet, range_label = parse_file_name(docx_path.name)

    all_pairs = []
    for key, q, a in pairs:
        all_pairs.append({"key": key, "question": q, "answer": a})

    sample = all_pairs[:5]

    return DocPilotResult(
        file=str(docx_path),
        masechet=masechet,
        range_label=range_label,
        total_questions=len(questions),
        total_answers=len(answers),
        matched_pairs=len(pairs),
        unmatched_question_keys=unmatched_q,
        unmatched_answer_keys=unmatched_a,
        pairs=all_pairs,
        sample_pairs=sample,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Pilot extract Q/A pairs from DOCX files")
    parser.add_argument("--files", nargs="+", required=True, help="DOCX files to process")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    results: List[DocPilotResult] = []
    for raw in args.files:
        p = Path(raw)
        if not p.exists():
            raise FileNotFoundError(f"Missing file: {p}")
        results.append(process_docx(p))

    payload = {
        "summary": {
            "files": len(results),
            "total_questions": sum(r.total_questions for r in results),
            "total_answers": sum(r.total_answers for r in results),
            "total_matched_pairs": sum(r.matched_pairs for r in results),
        },
        "results": [r.__dict__ for r in results],
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(payload["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
