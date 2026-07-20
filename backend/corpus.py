from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote
import json
import math
import re

import fitz


ROOT_DIR = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT_DIR / "data" / "pdfs"
PAPERS_PATH = ROOT_DIR / "data" / "papers.json"
CORPUS_PATH = ROOT_DIR / "data" / "corpus.json"
MANIFEST_PATH = ROOT_DIR / "data" / "corpus-manifest.json"

TARGET_TOKENS = 360
MAX_TOKENS = 450
OVERLAP_TOKENS = 60

WORD_PATTERN = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*")
NUMBERED_HEADING = re.compile(
    r"^(?:[1-9]|1\d)(?:\.\d+){0,3}\.?\s+[A-Z][^.!?]{1,100}$"
)


@dataclass(frozen=True)
class Line:
    text: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    page_width: float
    page_height: float
    max_font_size: float
    bold: bool


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalized_line_key(text: str) -> str:
    text = normalize_space(text).lower()
    text = re.sub(r"\b\d+\b", "#", text)
    return text.strip(" -–—|•")


def approximate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(len(WORD_PATTERN.findall(text)), math.ceil(len(text) / 4))


def slugify(text: str, max_length: int = 44) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_length].rstrip("-") or "untitled"


def load_papers(path: Path = PAPERS_PATH) -> list[dict[str, Any]]:
    papers = json.loads(path.read_text(encoding="utf-8"))
    required = {"id", "filename", "title", "authors", "year", "pdf_url", "include"}
    ids: set[str] = set()

    for paper in papers:
        missing = required.difference(paper)
        if missing:
            raise ValueError(f"Paper metadata is missing {sorted(missing)}: {paper}")
        if paper["id"] in ids:
            raise ValueError(f"Duplicate paper id: {paper['id']}")
        ids.add(paper["id"])

    return papers


def register_local_pdf(filename: str, path: Path = PAPERS_PATH) -> dict[str, Any]:
    """Add a locally uploaded PDF to the deterministic corpus configuration."""
    filename = Path(filename).name
    papers = load_papers(path)
    for paper in papers:
        if paper["filename"] == filename:
            return paper

    existing_ids = {paper["id"] for paper in papers}
    base_id = slugify(Path(filename).stem)
    paper_id = base_id
    suffix = 2
    while paper_id in existing_ids:
        paper_id = f"{base_id}-{suffix}"
        suffix += 1

    paper = {
        "id": paper_id,
        "filename": filename,
        "title": normalize_space(Path(filename).stem.replace("_", " ")),
        "authors": [],
        "year": 0,
        "topics": ["uploaded"],
        "source_url": None,
        "pdf_url": f"/pdfs/{quote(filename)}",
        "include": True,
    }
    papers.append(paper)
    path.write_text(
        json.dumps(papers, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return paper


def extract_lines(document: fitz.Document) -> list[list[Line]]:
    pages: list[list[Line]] = []

    for page_index, page in enumerate(document):
        page_lines: list[Line] = []
        page_dict = page.get_text("dict", sort=True)
        height = float(page.rect.height)

        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for raw_line in block.get("lines", []):
                spans = raw_line.get("spans", [])
                text = normalize_space("".join(span.get("text", "") for span in spans))
                if not text:
                    continue
                bbox = raw_line.get("bbox", (0, 0, 0, 0))
                page_lines.append(
                    Line(
                        text=text,
                        page=page_index + 1,
                        x0=float(bbox[0]),
                        y0=float(bbox[1]),
                        x1=float(bbox[2]),
                        y1=float(bbox[3]),
                        page_width=float(page.rect.width),
                        page_height=height,
                        max_font_size=max(
                            (float(span.get("size", 0)) for span in spans),
                            default=0,
                        ),
                        bold=any(
                            "bold" in str(span.get("font", "")).lower()
                            for span in spans
                        ),
                    )
                )
        pages.append(page_lines)

    return pages


def repeated_margin_keys(pages: list[list[Line]]) -> set[str]:
    counts: Counter[str] = Counter()

    for lines in pages:
        page_keys: set[str] = set()
        for line in lines:
            near_margin = (
                line.y0 <= line.page_height * 0.18
                or line.y1 >= line.page_height * 0.89
            )
            key = normalized_line_key(line.text)
            if near_margin and 2 <= len(key) <= 120:
                page_keys.add(key)
        counts.update(page_keys)

    threshold = max(3, math.ceil(len(pages) * 0.30))
    return {key for key, count in counts.items() if count >= threshold}


def strip_repeated_margins(pages: list[list[Line]]) -> list[list[Line]]:
    repeated = repeated_margin_keys(pages)
    cleaned: list[list[Line]] = []

    for lines in pages:
        cleaned.append(
            [
                line
                for line in lines
                if not (
                    normalized_line_key(line.text) in repeated
                    and (
                        line.y0 <= line.page_height * 0.18
                        or line.y1 >= line.page_height * 0.89
                    )
                )
                and not line.text.strip().isdigit()
            ]
        )

    return cleaned


def body_font_size(pages: list[list[Line]]) -> float:
    sizes = [
        round(line.max_font_size, 1)
        for lines in pages
        for line in lines
        if len(line.text) >= 35 and line.max_font_size > 0
    ]
    if not sizes:
        return 10.0
    return Counter(sizes).most_common(1)[0][0]


def is_heading(line: Line, body_size: float) -> bool:
    text = line.text.strip()
    words = WORD_PATTERN.findall(text)

    if not words or len(words) > 14 or len(text) > 120:
        return False
    if text.endswith((".", ",", ";", ":")) and not NUMBERED_HEADING.match(text):
        return False
    if text.lower().startswith(
        ("figure ", "table ", "copyright ", "doi:", "arxiv:")
    ):
        return False

    numbered = bool(NUMBERED_HEADING.match(text))
    alpha_words = [word for word in words if word.isalpha() and len(word) >= 2]
    symbol_count = sum(not character.isalnum() and not character.isspace() for character in text)
    symbol_heavy = symbol_count > max(3, len(text) * 0.16)
    uppercase = (
        len(alpha_words) >= 2
        and text.isupper()
        and line.max_font_size >= body_size + 1.0
    )
    large_title = line.max_font_size >= body_size + 1.5 and not symbol_heavy
    looks_like_sentence_fragment = bool(
        re.match(r"^(?:\d+(?:\.\d+)*\.?)\s+(?:then|and|but|the)\b", text, re.I)
        or re.search(r"\b(?:will|was|were|is|are)\s+be\b", text, re.I)
    )
    return (
        (numbered and not looks_like_sentence_fragment and not symbol_heavy)
        or uppercase
        or large_title
    )


def join_body_lines(lines: Iterable[str]) -> str:
    output = ""
    for raw_line in lines:
        line = normalize_space(raw_line)
        if not line:
            continue
        if output.endswith("-") and line[0].islower():
            output = output[:-1] + line
        elif output:
            output += " " + line
        else:
            output = line
    return normalize_space(output)


def split_sentences(text: str) -> list[str]:
    text = normalize_space(text)
    if not text:
        return []
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])", text)
    return [sentence.strip() for sentence in sentences if sentence.strip()]


def split_oversized_sentence(sentence: str) -> list[str]:
    if approximate_tokens(sentence) <= MAX_TOKENS:
        return [sentence]

    words = sentence.split()
    pieces: list[str] = []
    current: list[str] = []

    for word in words:
        candidate = " ".join([*current, word])
        if current and approximate_tokens(candidate) > TARGET_TOKENS:
            pieces.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        pieces.append(" ".join(current))
    return pieces


def chunk_section(text: str) -> list[str]:
    units = [
        piece
        for sentence in split_sentences(text)
        for piece in split_oversized_sentence(sentence)
    ]
    chunks: list[str] = []
    current: list[str] = []

    for unit in units:
        candidate = " ".join([*current, unit])
        if current and approximate_tokens(candidate) > MAX_TOKENS:
            chunks.append(normalize_space(" ".join(current)))
            overlap: list[str] = []
            overlap_size = 0
            for prior in reversed(current):
                overlap.insert(0, prior)
                overlap_size = approximate_tokens(" ".join(overlap))
                if overlap_size >= OVERLAP_TOKENS:
                    break
            current = overlap + [unit]
        else:
            current.append(unit)

        if approximate_tokens(" ".join(current)) >= TARGET_TOKENS:
            chunks.append(normalize_space(" ".join(current)))
            overlap = []
            for prior in reversed(current):
                overlap.insert(0, prior)
                if approximate_tokens(" ".join(overlap)) >= OVERLAP_TOKENS:
                    break
            current = overlap

    trailing = normalize_space(" ".join(current))
    if trailing:
        if chunks and approximate_tokens(trailing) < 90:
            merged = normalize_space(chunks[-1] + " " + trailing)
            if approximate_tokens(merged) <= MAX_TOKENS:
                chunks[-1] = merged
            else:
                chunks.append(trailing)
        else:
            chunks.append(trailing)

    return chunks


MAX_HIGHLIGHT_BOXES = 30
BOX_MERGE_GAP = 7.0


def merge_line_rects(
    rects: list[tuple[float, float, float, float]],
    page_width: float,
    page_height: float,
) -> list[dict[str, float]]:
    """Merge vertically adjacent same-column line rects into fewer boxes and
    normalize them to page-fraction coordinates for the PDF viewer overlay."""
    merged: list[list[float]] = []
    for x0, y0, x1, y1 in rects:
        if merged:
            last = merged[-1]
            overlap = min(last[2], x1) - max(last[0], x0)
            same_column = overlap > 0.5 * min(last[2] - last[0], x1 - x0)
            if same_column and -1.0 <= y0 - last[3] <= BOX_MERGE_GAP:
                merged[-1] = [min(last[0], x0), last[1], max(last[2], x1), max(last[3], y1)]
                continue
        merged.append([x0, y0, x1, y1])
    return [
        {
            "x": round(x0 / page_width, 4),
            "y": round(y0 / page_height, 4),
            "width": round((x1 - x0) / page_width, 4),
            "height": round((y1 - y0) / page_height, 4),
        }
        for x0, y0, x1, y1 in merged[:MAX_HIGHLIGHT_BOXES]
    ]


def chunk_highlight_boxes(chunk_text: str, lines: list[Line]) -> list[dict[str, float]]:
    """Locate the page lines whose text the chunk contains and return their
    merged bounding boxes. Hyphenated line breaks are matched by prefix since
    join_body_lines() reassembles the split word."""
    rects: list[tuple[float, float, float, float]] = []
    for line in lines:
        probe = normalize_space(line.text).rstrip("-")
        if len(probe) < 12:
            continue
        if probe in chunk_text or probe[:60] in chunk_text:
            rects.append((line.x0, line.y0, line.x1, line.y1))
    if not rects:
        return []
    return merge_line_rects(rects, lines[0].page_width, lines[0].page_height)


def paper_chunks(paper: dict[str, Any], pdf_path: Path) -> list[dict[str, Any]]:
    document = fitz.open(pdf_path)
    pages = strip_repeated_margins(extract_lines(document))
    body_size = body_font_size(pages)
    chunks: list[dict[str, Any]] = []
    current_section = "Document overview"
    seen_hashes: set[str] = set()

    for page_number, lines in enumerate(pages, start=1):
        section_lines: list[str] = []
        sections: list[tuple[str, str]] = []

        def flush() -> None:
            nonlocal section_lines
            text = join_body_lines(section_lines)
            if text:
                sections.append((current_section, text))
            section_lines = []

        line_index = 0
        while line_index < len(lines):
            line = lines[line_index]
            standalone_number = bool(re.fullmatch(r"\d+(?:\.\d+){0,3}\.?", line.text))
            combined_heading: Line | None = None
            if standalone_number and line_index + 1 < len(lines):
                following = lines[line_index + 1]
                following_words = WORD_PATTERN.findall(following.text)
                if 2 <= len(following_words) <= 12:
                    combined_heading = Line(
                        text=f"{line.text.rstrip('.')} {following.text}",
                        page=line.page,
                        x0=min(line.x0, following.x0),
                        y0=line.y0,
                        x1=max(line.x1, following.x1),
                        y1=following.y1,
                        page_width=line.page_width,
                        page_height=line.page_height,
                        max_font_size=max(line.max_font_size, following.max_font_size),
                        bold=line.bold or following.bold,
                    )

            heading = combined_heading or line
            in_references = current_section.strip().lower() in {"references", "bibliography"}
            if not in_references and is_heading(heading, body_size):
                flush()
                current_section = normalize_space(heading.text)
                if combined_heading is not None:
                    line_index += 1
            else:
                section_lines.append(line.text)
            line_index += 1
        flush()

        page_chunk_index = 0
        for section, text in sections:
            for chunk_text in chunk_section(text):
                if approximate_tokens(chunk_text) < 25:
                    continue
                content_hash = sha256(chunk_text.encode("utf-8")).hexdigest()
                if content_hash in seen_hashes:
                    continue
                seen_hashes.add(content_hash)
                page_chunk_index += 1
                section_slug = slugify(section)
                chunk_id = (
                    f"{paper['id']}-p{page_number:03d}-"
                    f"{section_slug}-c{page_chunk_index:02d}"
                )
                chunks.append(
                    {
                        "id": chunk_id,
                        "paper_id": paper["id"],
                        "document": paper["filename"],
                        "title": paper["title"],
                        "authors": paper["authors"],
                        "year": paper["year"],
                        "page": page_number,
                        "section": section,
                        "pdf_url": paper["pdf_url"],
                        "source_url": paper.get("source_url"),
                        "topics": paper.get("topics", []),
                        "text": chunk_text,
                        "token_estimate": approximate_tokens(chunk_text),
                        "content_hash": content_hash,
                        "highlight_boxes": chunk_highlight_boxes(chunk_text, lines),
                    }
                )

    return chunks


def build_corpus(
    papers_path: Path = PAPERS_PATH,
    pdf_dir: Path = PDF_DIR,
    corpus_path: Path = CORPUS_PATH,
    manifest_path: Path = MANIFEST_PATH,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    papers = load_papers(papers_path)
    corpus: list[dict[str, Any]] = []
    included: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []

    for paper in papers:
        pdf_path = pdf_dir / paper["filename"]
        if not pdf_path.exists():
            raise FileNotFoundError(f"Missing configured PDF: {pdf_path}")

        pdf_hash = sha256(pdf_path.read_bytes()).hexdigest()
        if not paper["include"]:
            excluded.append(
                {
                    "id": paper["id"],
                    "filename": paper["filename"],
                    "reason": paper.get("exclusion_reason", "Excluded by metadata"),
                    "duplicate_of": paper.get("duplicate_of"),
                    "sha256": pdf_hash,
                }
            )
            continue

        chunks = paper_chunks(paper, pdf_path)
        corpus.extend(chunks)
        included.append(
            {
                "id": paper["id"],
                "filename": paper["filename"],
                "pages": len(fitz.open(pdf_path)),
                "chunks": len(chunks),
                "sha256": pdf_hash,
            }
        )

    corpus.sort(key=lambda item: item["id"])
    corpus_json = json.dumps(corpus, indent=2, ensure_ascii=False) + "\n"
    corpus_path.write_text(corpus_json, encoding="utf-8")

    manifest = {
        "schema_version": 1,
        "chunking": {
            "target_tokens": TARGET_TOKENS,
            "max_tokens": MAX_TOKENS,
            "overlap_tokens": OVERLAP_TOKENS,
            "token_counting": "max(regex word count, ceil(character count / 4))",
        },
        "included_papers": included,
        "excluded_files": excluded,
        "paper_count": len(included),
        "chunk_count": len(corpus),
        "corpus_sha256": sha256(corpus_json.encode("utf-8")).hexdigest(),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return corpus, manifest
