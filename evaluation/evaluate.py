#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import argparse
import json
import sys

import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from retrieval import deduplicate_overlapping_results, reciprocal_rank_fusion, tokenize  # noqa: E402


CORPUS_PATH = ROOT_DIR / "data" / "corpus.json"
MANIFEST_PATH = ROOT_DIR / "data" / "corpus-manifest.json"
QUESTIONS_PATH = ROOT_DIR / "evaluation" / "questions.json"
BASELINE_PATH = ROOT_DIR / "evaluation" / "baseline.json"
MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K = 5
CANDIDATE_K = 20


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def is_relevant(result: dict[str, Any], expected: list[dict[str, Any]]) -> bool:
    return any(
        result["paper_id"] == target["paper_id"]
        and result["page"] in target["pages"]
        for target in expected
    )


def evaluate() -> dict[str, Any]:
    corpus: list[dict[str, Any]] = load_json(CORPUS_PATH)
    manifest: dict[str, Any] = load_json(MANIFEST_PATH)
    questions: list[dict[str, Any]] = load_json(QUESTIONS_PATH)
    texts = [chunk["text"] for chunk in corpus]

    model = SentenceTransformer(MODEL_NAME)
    corpus_embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    bm25 = BM25Okapi([tokenize(text) for text in texts])

    question_results: list[dict[str, Any]] = []
    reciprocal_ranks: list[float] = []
    recalls: list[float] = []

    for question in questions:
        query_embedding = model.encode(
            question["question"],
            normalize_embeddings=True,
        )
        vector_scores = np.dot(corpus_embeddings, query_embedding)
        vector_indexes = np.argsort(-vector_scores)[:CANDIDATE_K]
        vector_ranked = [
            {**corpus[int(index)], "vector_score": float(vector_scores[index])}
            for index in vector_indexes
        ]

        keyword_scores = bm25.get_scores(tokenize(question["question"]))
        keyword_indexes = np.argsort(-keyword_scores)[:CANDIDATE_K]
        keyword_ranked = [
            {**corpus[int(index)], "bm25_score": float(keyword_scores[index])}
            for index in keyword_indexes
            if float(keyword_scores[index]) > 0
        ]

        ranked = deduplicate_overlapping_results(
            reciprocal_rank_fusion([vector_ranked, keyword_ranked])
        )
        top_results = ranked[:TOP_K]
        first_relevant_rank = next(
            (
                rank
                for rank, result in enumerate(top_results, start=1)
                if is_relevant(result, question["expected"])
            ),
            None,
        )
        recall = 1.0 if first_relevant_rank is not None else 0.0
        reciprocal_rank = 1.0 / first_relevant_rank if first_relevant_rank else 0.0
        recalls.append(recall)
        reciprocal_ranks.append(reciprocal_rank)
        question_results.append(
            {
                "id": question["id"],
                "recall_at_5": recall,
                "reciprocal_rank": reciprocal_rank,
                "first_relevant_rank": first_relevant_rank,
                "top_results": [
                    {
                        "id": result["id"],
                        "paper_id": result["paper_id"],
                        "page": result["page"],
                        "section": result["section"],
                        "rrf_score": round(float(result["rrf_score"]), 8),
                    }
                    for result in top_results
                ],
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL_NAME,
        "retrieval": "Reciprocal Rank Fusion of dense cosine and BM25 rankings",
        "question_count": len(questions),
        "corpus_chunk_count": len(corpus),
        "corpus_sha256": manifest["corpus_sha256"],
        "top_k": TOP_K,
        "metrics": {
            "recall_at_5": sum(recalls) / len(recalls),
            "mean_reciprocal_rank_at_5": sum(reciprocal_ranks) / len(reciprocal_ranks),
        },
        "questions": question_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate hybrid corpus retrieval.")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Write the measured results to evaluation/baseline.json.",
    )
    args = parser.parse_args()
    results = evaluate()
    print(json.dumps({key: results[key] for key in ("question_count", "corpus_chunk_count", "metrics")}, indent=2))
    if args.write_baseline:
        BASELINE_PATH.write_text(
            json.dumps(results, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {BASELINE_PATH.relative_to(ROOT_DIR)}")


if __name__ == "__main__":
    main()
