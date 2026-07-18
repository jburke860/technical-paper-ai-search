#!/usr/bin/env python3
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
import json
import math
import re


ROOT_DIR = Path(__file__).resolve().parents[1]
CORPUS_PATH = ROOT_DIR / "data" / "corpus.json"
MANIFEST_PATH = ROOT_DIR / "data" / "corpus-manifest.json"
PAPERS_PATH = ROOT_DIR / "data" / "papers.json"
OUTPUT_DIR = ROOT_DIR / "worker" / "src" / "generated"
TOKEN_PATTERN = re.compile(r"[a-zA-Z0-9_+-]+")


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    corpus: list[dict[str, Any]] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    papers: list[dict[str, Any]] = json.loads(PAPERS_PATH.read_text(encoding="utf-8"))

    document_lengths: list[int] = []
    postings: defaultdict[str, list[list[int]]] = defaultdict(list)

    for document_index, chunk in enumerate(corpus):
        counts = Counter(tokenize(chunk["text"]))
        document_lengths.append(sum(counts.values()))
        for term, frequency in sorted(counts.items()):
            postings[term].append([document_index, frequency])

    bm25 = {
        "documentCount": len(corpus),
        "averageDocumentLength": (
            sum(document_lengths) / len(document_lengths) if document_lengths else 0
        ),
        "documentLengths": document_lengths,
        "k1": 1.5,
        "b": 0.75,
        "postings": dict(sorted(postings.items())),
    }
    public_papers = [paper for paper in papers if paper["include"]]
    public_manifest = {
        "schemaVersion": manifest["schema_version"],
        "paperCount": manifest["paper_count"],
        "chunkCount": manifest["chunk_count"],
        "corpusSha256": manifest["corpus_sha256"],
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT_DIR / "corpus.json", corpus)
    write_json(OUTPUT_DIR / "bm25.json", bm25)
    write_json(OUTPUT_DIR / "papers.json", public_papers)
    write_json(OUTPUT_DIR / "manifest.json", public_manifest)

    total_size = sum(path.stat().st_size for path in OUTPUT_DIR.glob("*.json"))
    print(
        f"Built Worker assets for {len(public_papers)} papers and {len(corpus)} "
        f"chunks ({math.ceil(total_size / 1024)} KiB)."
    )


if __name__ == "__main__":
    main()
