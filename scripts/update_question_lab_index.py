#!/usr/bin/env python3
import argparse
import json
from datetime import datetime
from pathlib import Path


def infer_label(file_name: str) -> str:
    stem = Path(file_name).stem
    stem = stem.replace("_qna_report", "").replace("pilot_", "")
    return stem.replace("_", " ").strip() or file_name


def build_index(reports_dir: Path) -> dict:
    reports = []
    for f in sorted(reports_dir.glob("*_qna_report.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        reports.append(
            {
                "id": f.stem,
                "label": infer_label(f.name),
                "file": f"/data/reports/{f.name}",
                "updated_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            }
        )

    if not reports:
        # Backward-compatible fallback to the existing pilot file.
        fallback = reports_dir.parent / "pilot_docx_qna_report.json"
        if fallback.exists():
            reports.append(
                {
                    "id": "pilot_docx_qna_report",
                    "label": "pilot docx qna",
                    "file": "/data/pilot_docx_qna_report.json",
                    "updated_at": datetime.fromtimestamp(fallback.stat().st_mtime).isoformat(),
                }
            )

    return {
        "version": 1,
        "generated_at": datetime.now().isoformat(),
        "reports": reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate question-lab report index")
    parser.add_argument("--public-data", default="public/data", help="Path to public/data")
    args = parser.parse_args()

    public_data = Path(args.public_data)
    reports_dir = public_data / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    index = build_index(reports_dir)
    out = public_data / "question-lab-index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} with {len(index['reports'])} report(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
