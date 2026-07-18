from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable
import re


TOKEN_PATTERN = re.compile(r"[a-zA-Z0-9_+-]+")


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def reciprocal_rank_fusion(
    result_lists: Iterable[list[dict[str, Any]]],
    *,
    id_key: str = "id",
    rank_constant: int = 60,
) -> list[dict[str, Any]]:
    """Fuse ranked result lists without assuming comparable score scales."""
    fused_scores: defaultdict[str, float] = defaultdict(float)
    ranks: defaultdict[str, list[int | None]] = defaultdict(list)
    items: dict[str, dict[str, Any]] = {}
    materialized = list(result_lists)

    for list_index, results in enumerate(materialized):
        present: set[str] = set()
        for rank, result in enumerate(results, start=1):
            item_id = str(result[id_key])
            present.add(item_id)
            fused_scores[item_id] += 1.0 / (rank_constant + rank)
            items.setdefault(item_id, {}).update(result)
            while len(ranks[item_id]) < list_index:
                ranks[item_id].append(None)
            ranks[item_id].append(rank)

        for item_id in items:
            if item_id not in present and len(ranks[item_id]) == list_index:
                ranks[item_id].append(None)

    output: list[dict[str, Any]] = []
    for item_id, item in items.items():
        item_ranks = ranks[item_id]
        while len(item_ranks) < len(materialized):
            item_ranks.append(None)
        output.append(
            {
                **item,
                "rrf_score": fused_scores[item_id],
                "retriever_ranks": item_ranks,
            }
        )

    return sorted(output, key=lambda item: (-item["rrf_score"], item[id_key]))


def token_jaccard(left: str, right: str) -> float:
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def deduplicate_overlapping_results(
    results: list[dict[str, Any]],
    *,
    threshold: float = 0.72,
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []

    for candidate in results:
        duplicate = any(
            candidate.get("paper_id") == existing.get("paper_id")
            and candidate.get("page") == existing.get("page")
            and token_jaccard(
                str(candidate.get("text", candidate.get("snippet", ""))),
                str(existing.get("text", existing.get("snippet", ""))),
            )
            >= threshold
            for existing in kept
        )
        if not duplicate:
            kept.append(candidate)

    return kept
