#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any
import argparse
import json
import os

import requests


ROOT_DIR = Path(__file__).resolve().parents[1]
CORPUS_PATH = ROOT_DIR / "data" / "corpus.json"
DEFAULT_OUTPUT = ROOT_DIR / "worker" / "vectors.ndjson"
MODEL = "@cf/baai/bge-small-en-v1.5"
DIMENSIONS = 384
BATCH_SIZE = 25


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def embed_batch(
    texts: list[str],
    *,
    account_id: str,
    api_token: str,
) -> list[list[float]]:
    response = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{MODEL}",
        headers={"Authorization": f"Bearer {api_token}"},
        json={"text": texts, "pooling": "cls"},
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("success"):
        raise RuntimeError(f"Workers AI embedding request failed: {payload.get('errors')}")
    embeddings = payload.get("result", {}).get("data", [])
    if len(embeddings) != len(texts):
        raise RuntimeError("Workers AI returned an unexpected embedding count.")
    if any(len(embedding) != DIMENSIONS for embedding in embeddings):
        raise RuntimeError("Workers AI returned an unexpected embedding dimension.")
    return embeddings


def vector_record(chunk: dict[str, Any], values: list[float]) -> dict[str, Any]:
    # Vectorize ids are limited to 64 bytes; the sha256 content hash fits
    # exactly and is unique (enforced by evaluation/check_corpus_quality.py).
    return {
        "id": chunk["content_hash"],
        "values": values,
        "metadata": {
            "paper_id": chunk["paper_id"],
            "page": chunk["page"],
            "section": chunk["section"][:200],
            "content_hash": chunk["content_hash"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Vectorize NDJSON with the production Workers AI model."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--confirm-remote",
        action="store_true",
        help="Acknowledge that this calls the account's Workers AI Free allocation.",
    )
    args = parser.parse_args()
    if not args.confirm_remote:
        raise SystemExit("Refusing remote inference without --confirm-remote.")

    account_id = required_environment("CLOUDFLARE_ACCOUNT_ID")
    api_token = required_environment("CLOUDFLARE_API_TOKEN")
    corpus: list[dict[str, Any]] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = []

    for start in range(0, len(corpus), BATCH_SIZE):
        batch = corpus[start : start + BATCH_SIZE]
        embeddings = embed_batch(
            [chunk["text"] for chunk in batch],
            account_id=account_id,
            api_token=api_token,
        )
        records.extend(
            vector_record(chunk, embedding)
            for chunk, embedding in zip(batch, embeddings)
        )
        print(f"Embedded {min(start + BATCH_SIZE, len(corpus))}/{len(corpus)} chunks")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in records),
        encoding="utf-8",
    )
    print(f"Wrote {len(records)} vectors to {args.output}")


if __name__ == "__main__":
    main()
