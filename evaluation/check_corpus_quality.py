#!/usr/bin/env python3
"""Fast, dependency-free corpus quality gate.

Verifies from a clean checkout — without ML dependencies — that:
- the committed corpus reproduces the manifest hash (determinism),
- the hosted Worker bundle carries the same corpus,
- every chunk has complete citation metadata,
- every citation page lies inside its paper's real page range,
- chunk ids are unique and exact-duplicate content is absent.

Exits non-zero on any violation so CI can gate on it.
"""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
from pathlib import Path
import json
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
CORPUS_PATH = ROOT_DIR / "data" / "corpus.json"
MANIFEST_PATH = ROOT_DIR / "data" / "corpus-manifest.json"
WORKER_CORPUS_PATH = ROOT_DIR / "worker" / "src" / "generated" / "corpus.json"
WORKER_MANIFEST_PATH = ROOT_DIR / "worker" / "src" / "generated" / "manifest.json"

REQUIRED_FIELDS = (
    "id", "paper_id", "document", "title", "authors", "year",
    "page", "section", "pdf_url", "text", "content_hash",
)


def main() -> int:
    failures: list[str] = []
    corpus_text = CORPUS_PATH.read_text(encoding="utf-8")
    corpus = json.loads(corpus_text)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    recomputed = sha256(corpus_text.encode("utf-8")).hexdigest()
    if recomputed != manifest["corpus_sha256"]:
        failures.append(
            f"corpus.json hash {recomputed} does not match manifest {manifest['corpus_sha256']}",
        )
    if len(corpus) != manifest["chunk_count"]:
        failures.append(
            f"corpus has {len(corpus)} chunks but manifest records {manifest['chunk_count']}",
        )

    page_ranges = {
        paper["id"]: paper["pages"] for paper in manifest["included_papers"]
    }
    if len(page_ranges) != manifest["paper_count"]:
        failures.append("manifest paper_count disagrees with included_papers")

    missing_metadata = 0
    invalid_pages = 0
    for chunk in corpus:
        if any(
            chunk.get(field) in (None, "", [])
            for field in REQUIRED_FIELDS
        ):
            missing_metadata += 1
        pages = page_ranges.get(chunk.get("paper_id"))
        if pages is None or not 1 <= chunk.get("page", 0) <= pages:
            invalid_pages += 1

    ids = [chunk["id"] for chunk in corpus]
    duplicate_ids = [value for value, count in Counter(ids).items() if count > 1]
    duplicate_hashes = [
        value for value, count in Counter(chunk["content_hash"] for chunk in corpus).items()
        if count > 1
    ]

    metrics = {
        "chunk_count": len(corpus),
        "missing_metadata_rate": missing_metadata / len(corpus),
        "citation_page_accuracy": 1 - invalid_pages / len(corpus),
        "duplicate_id_count": len(duplicate_ids),
        "duplicate_content_count": len(duplicate_hashes),
    }

    if missing_metadata:
        failures.append(f"{missing_metadata} chunks are missing citation metadata")
    if invalid_pages:
        failures.append(f"{invalid_pages} chunks cite pages outside their paper")
    if duplicate_ids:
        failures.append(f"duplicate chunk ids: {duplicate_ids[:5]}")
    if duplicate_hashes:
        failures.append(f"{len(duplicate_hashes)} exact duplicate chunk bodies")

    worker_corpus = json.loads(WORKER_CORPUS_PATH.read_text(encoding="utf-8"))
    worker_manifest = json.loads(WORKER_MANIFEST_PATH.read_text(encoding="utf-8"))
    if worker_corpus != corpus:
        failures.append("worker/src/generated/corpus.json is out of sync with data/corpus.json")
    if worker_manifest.get("corpusSha256") not in (manifest["corpus_sha256"],):
        failures.append("worker generated manifest hash is out of sync")

    print(json.dumps(metrics, indent=2))
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print("Corpus quality gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
