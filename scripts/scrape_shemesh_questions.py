"""
Scraper for shemeshbegivon.com questions.

Fetches all American-style Gemara questions from the public Firestore REST API.
Output: questions_by_tractate.json  (and per-tractate JSON files in output/)

Data structure in Firestore:
  tractates/{tractate}_b                       – tractate metadata
  tractates/{tractate}_b/pages/{page}/questions/q{n}  – correct_answer, num_of_choices
  hebrew_strings/{tractate}_b_{page}           – question text & answer choices
    fields: q1, q1_a1, q1_a2, q1_a3, q1_a4, q2, q2_a1, ...
"""

import json
import os
import time
import requests

API_KEY = "AIzaSyAZ_oGVhcLdZ7x1FUyU_LRFNQENuBRgTro"
PROJECT = "shemesh-test"
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output", "shemesh_questions")

os.makedirs(OUTPUT_DIR, exist_ok=True)


def firestore_get(path: str, params: dict | None = None) -> dict | None:
    url = f"{BASE_URL}/{path}"
    p = {"key": API_KEY}
    if params:
        p.update(params)
    resp = requests.get(url, params=p, timeout=15)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def firestore_list(path: str, page_size: int = 300) -> list[dict]:
    """Paginate through all documents in a collection."""
    results = []
    params = {"key": API_KEY, "pageSize": page_size}
    url = f"{BASE_URL}/{path}"
    while True:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        docs = data.get("documents", [])
        results.extend(docs)
        token = data.get("nextPageToken")
        if not token:
            break
        params["pageToken"] = token
    return results


def doc_id(doc: dict) -> str:
    """Extract last path segment as document ID."""
    return doc["name"].split("/")[-1]


def str_val(field: dict) -> str:
    return field.get("stringValue", "")


def int_val(field: dict) -> int:
    return int(field.get("integerValue", 0))


def parse_strings_doc(fields: dict, num_questions: int) -> list[dict]:
    """
    Build a list of question objects from a hebrew_strings document.
    Each item: {id, question, choices: [str,...], correct_answer_index (0-based)}
    """
    questions = []
    # Find max question number from keys like q1, q2, q3...
    q_nums = set()
    for key in fields:
        if key.startswith("q") and "_" not in key:
            try:
                q_nums.add(int(key[1:]))
            except ValueError:
                pass

    for n in sorted(q_nums):
        q_key = f"q{n}"
        q_text_field = fields.get(q_key)
        if not q_text_field:
            continue
        q_text = str_val(q_text_field)

        choices = []
        i = 1
        while True:
            a_key = f"q{n}_a{i}"
            a_field = fields.get(a_key)
            if not a_field:
                break
            choices.append(str_val(a_field))
            i += 1

        questions.append({
            "id": q_key,
            "question": q_text,
            "choices": choices,
        })
    return questions


def get_correct_answers(tractate_doc_id: str, page: int) -> dict:
    """
    Returns {q_id: correct_answer_index (0-based)} for all questions on a page.
    """
    path = f"tractates/{tractate_doc_id}/pages/{page}/questions"
    try:
        docs = firestore_list(path)
    except Exception:
        return {}
    answers = {}
    for doc in docs:
        q_id = doc_id(doc)
        fields = doc.get("fields", {})
        ca = fields.get("correct_answer")
        if ca:
            # correct_answer is 1-based in Firestore
            answers[q_id] = int_val(ca) - 1
    return answers


def scrape_tractate(tractate: dict) -> list[dict]:
    """
    Returns list of page-dicts:
      {tractate, page, questions: [{id, question, choices, correct_answer_index}]}
    """
    fields = tractate.get("fields", {})
    name_field = fields.get("name")
    total_pages_field = fields.get("total_pages_in_tractate")
    if not name_field or not total_pages_field:
        return []

    tractate_name = str_val(name_field)
    total_pages = int_val(total_pages_field)
    tractate_doc = doc_id(tractate)  # e.g. "megillah_b"

    print(f"  Tractate: {tractate_name} ({tractate_doc}), {total_pages} pages")

    all_pages = []
    # Talmud daf numbers start at 2
    for page in range(2, 2 + total_pages):
        strings_key = f"{tractate_name}_b_{page}"
        strings_doc = firestore_get(f"hebrew_strings/{strings_key}")
        if not strings_doc:
            continue  # page not yet uploaded

        fields_data = strings_doc.get("fields", {})
        if not fields_data:
            continue

        # Parse question text and choices
        questions = parse_strings_doc(fields_data, total_pages)
        if not questions:
            continue

        # Attach correct answers
        correct = get_correct_answers(tractate_doc, page)
        for q in questions:
            q_id = q["id"]
            if q_id in correct:
                q["correct_answer_index"] = correct[q_id]

        all_pages.append({
            "tractate": tractate_name,
            "daf": page,
            "questions": questions,
        })
        # Polite rate limiting
        time.sleep(0.05)

    return all_pages


def main():
    print("Fetching tractate list...")
    tractate_docs = firestore_list("tractates")
    # Only keep bavli (suffix _b)
    bavli = [t for t in tractate_docs if doc_id(t).endswith("_b")]
    print(f"Found {len(bavli)} Bavli tractates")

    all_data = {}

    for tractate in bavli:
        name = str_val(tractate.get("fields", {}).get("name", {}))
        pages = scrape_tractate(tractate)
        if pages:
            all_data[name] = pages
            # Save per-tractate file
            out_path = os.path.join(OUTPUT_DIR, f"{name}.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(pages, f, ensure_ascii=False, indent=2)
            print(f"    Saved {len(pages)} pages -> {out_path}")

    # Save combined file
    combined_path = os.path.join(OUTPUT_DIR, "questions_by_tractate.json")
    with open(combined_path, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    total_q = sum(
        sum(len(p["questions"]) for p in pages)
        for pages in all_data.values()
    )
    print(f"\nDone! {len(all_data)} tractates, {total_q} questions total.")
    print(f"Combined file: {combined_path}")


if __name__ == "__main__":
    main()
