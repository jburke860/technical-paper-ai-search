#!/usr/bin/env python3
from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from corpus import build_corpus  # noqa: E402


def main() -> None:
    corpus, manifest = build_corpus()
    print(
        f"Built {len(corpus)} chunks from {manifest['paper_count']} unique papers."
    )
    print(f"Corpus SHA-256: {manifest['corpus_sha256']}")
    if manifest["excluded_files"]:
        print(f"Excluded {len(manifest['excluded_files'])} configured file(s).")


if __name__ == "__main__":
    main()
