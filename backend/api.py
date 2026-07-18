from pathlib import Path
from typing import Any
import shutil

import chromadb
import requests
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

from ingest import main as rebuild_index
from corpus import register_local_pdf
from retrieval import deduplicate_overlapping_results, reciprocal_rank_fusion, tokenize


ROOT_DIR = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT_DIR / "data" / "pdfs"
CHROMA_DIR = ROOT_DIR / "data" / "chroma"
COLLECTION_NAME = "technical_papers"

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = "llama3.2:3b"


app = FastAPI(
    title="Technical Paper AI Search API",
    description="Local semantic and hybrid search API for public technical PDFs.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading embedding model...")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

print("Connecting to Chroma...")
client = chromadb.PersistentClient(path=str(CHROMA_DIR))

collection = None
bm25_index = None
bm25_items: list[dict[str, Any]] = []


class SearchRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    n_results: int = Field(default=5, ge=1, le=10)


class SearchResult(BaseModel):
    id: str
    paper_id: str
    document: str
    title: str
    authors: list[str]
    year: int
    page: int
    section: str
    pdf_url: str
    source_url: str | None = None
    snippet: str
    distance: float | None = None
    bm25_score: float | None = None
    hybrid_score: float | None = None
    vector_rank: int | None = None
    keyword_rank: int | None = None
    rrf_score: float


class SearchResponse(BaseModel):
    question: str
    results: list[SearchResult]


class AnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    n_results: int = Field(default=5, ge=1, le=10)


class AnswerResponse(BaseModel):
    question: str
    answer: str
    sources: list[SearchResult]


class UploadResponse(BaseModel):
    filename: str
    message: str


def load_collection() -> None:
    global collection
    collection = client.get_collection(name=COLLECTION_NAME)


def build_bm25_index() -> None:
    global bm25_index, bm25_items

    if collection is None:
        load_collection()

    all_data = collection.get(include=["documents", "metadatas"])

    ids = all_data["ids"]
    documents = all_data["documents"]
    metadatas = all_data["metadatas"]

    bm25_items = []
    tokenized_corpus = []

    for item_id, document_text, metadata in zip(ids, documents, metadatas):
        item = {
            "id": item_id,
            "paper_id": metadata.get("paper_id", metadata["document"]),
            "document": metadata["document"],
            "title": metadata.get("title", metadata["document"]),
            "authors": [
                author
                for author in metadata.get("authors", "").split("; ")
                if author
            ],
            "year": int(metadata.get("year", 0)),
            "page": metadata["page"],
            "section": metadata.get("section", "Document overview"),
            "pdf_url": metadata.get("pdf_url", ""),
            "source_url": metadata.get("source_url") or None,
            "snippet": document_text,
            "text": document_text,
        }
        bm25_items.append(item)
        tokenized_corpus.append(tokenize(document_text))

    bm25_index = BM25Okapi(tokenized_corpus)


def reload_indexes() -> None:
    load_collection()
    build_bm25_index()


def hybrid_search(question: str, n_results: int = 5) -> list[dict[str, Any]]:
    if collection is None or bm25_index is None:
        reload_indexes()

    query_embedding = embedding_model.encode([question]).tolist()[0]

    vector_n = min(max(n_results * 4, 10), collection.count())
    vector_results = collection.query(
        query_embeddings=[query_embedding],
        n_results=vector_n,
    )

    vector_ids = vector_results["ids"][0]
    vector_docs = vector_results["documents"][0]
    vector_metas = vector_results["metadatas"][0]
    vector_distances = vector_results["distances"][0]

    vector_ranked = []
    for item_id, text, metadata, distance in zip(
        vector_ids, vector_docs, vector_metas, vector_distances
    ):
        vector_ranked.append(
            {
                "id": item_id,
                "paper_id": metadata.get("paper_id", metadata["document"]),
                "document": metadata["document"],
                "title": metadata.get("title", metadata["document"]),
                "authors": [
                    author
                    for author in metadata.get("authors", "").split("; ")
                    if author
                ],
                "year": int(metadata.get("year", 0)),
                "page": metadata["page"],
                "section": metadata.get("section", "Document overview"),
                "pdf_url": metadata.get("pdf_url", ""),
                "source_url": metadata.get("source_url") or None,
                "snippet": text,
                "text": text,
                "distance": float(distance),
            }
        )

    query_tokens = tokenize(question)
    bm25_scores = bm25_index.get_scores(query_tokens)

    top_bm25_indexes = sorted(
        range(len(bm25_scores)),
        key=lambda index: bm25_scores[index],
        reverse=True,
    )[:vector_n]
    keyword_ranked = [
        {**bm25_items[index], "bm25_score": float(bm25_scores[index])}
        for index in top_bm25_indexes
        if float(bm25_scores[index]) > 0
    ]

    ranked = reciprocal_rank_fusion([vector_ranked, keyword_ranked])
    ranked = deduplicate_overlapping_results(ranked)

    output = []
    for candidate in ranked[:n_results]:
        retriever_ranks = candidate.pop("retriever_ranks")
        rrf_score = float(candidate["rrf_score"])
        candidate.pop("text", None)
        output.append(
            {
                **candidate,
                "distance": candidate.get("distance"),
                "bm25_score": candidate.get("bm25_score"),
                "hybrid_score": rrf_score,
                "vector_rank": retriever_ranks[0],
                "keyword_rank": retriever_ranks[1],
                "rrf_score": rrf_score,
            }
        )

    return output


def call_ollama(question: str, sources: list[dict[str, Any]]) -> str:
    context_blocks = []

    for index, source in enumerate(sources, start=1):
        snippet = source["snippet"]
        if len(snippet) > 1500:
            snippet = snippet[:1500] + "..."

        context_blocks.append(
            f"Source {index}: {source['document']}, page {source['page']}\n{snippet}"
        )

    context = "\n\n".join(context_blocks)

    prompt = f"""
You are a technical research assistant. Answer the user's question using only the provided sources.

Rules:
- Be concise and technical.
- Do not invent facts not supported by the sources.
- If the sources are insufficient, say that the retrieved sources do not fully answer the question.
- Include source references in the answer using this format: [Source 1], [Source 2].

User question:
{question}

Retrieved sources:
{context}

Answer:
""".strip()

    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.2,
                },
            },
            timeout=120,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not connect to Ollama. Make sure Ollama is running "
                "and the llama3.2:3b model is installed."
            ),
        ) from error

    data = response.json()
    return data.get("response", "").strip()


@app.on_event("startup")
def startup() -> None:
    reload_indexes()


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "Technical Paper AI Search API is running.",
    }


@app.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> dict[str, Any]:
    results = hybrid_search(request.question, request.n_results)

    return {
        "question": request.question,
        "results": results,
    }


@app.post("/answer", response_model=AnswerResponse)
def answer(request: AnswerRequest) -> dict[str, Any]:
    sources = hybrid_search(request.question, request.n_results)
    generated_answer = call_ollama(request.question, sources)

    return {
        "question": request.question,
        "answer": generated_answer,
        "sources": sources,
    }


@app.post("/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    safe_filename = Path(file.filename).name
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    destination = PDF_DIR / safe_filename

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    register_local_pdf(safe_filename)
    rebuild_index()
    reload_indexes()

    return {
        "filename": safe_filename,
        "message": "PDF uploaded and index rebuilt successfully.",
    }
