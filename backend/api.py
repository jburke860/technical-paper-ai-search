from pathlib import Path
from typing import Any
import re
import shutil

import chromadb
import requests
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

from ingest import main as rebuild_index


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
    question: str
    n_results: int = 5


class SearchResult(BaseModel):
    id: str
    document: str
    page: int
    snippet: str
    distance: float | None = None
    bm25_score: float | None = None
    hybrid_score: float | None = None


class SearchResponse(BaseModel):
    question: str
    results: list[SearchResult]


class AnswerRequest(BaseModel):
    question: str
    n_results: int = 5


class AnswerResponse(BaseModel):
    question: str
    answer: str
    sources: list[SearchResult]


class UploadResponse(BaseModel):
    filename: str
    message: str


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9_+-]+", text.lower())


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
            "document": metadata["document"],
            "page": metadata["page"],
            "snippet": document_text,
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

    vector_n = max(n_results * 4, 10)
    vector_results = collection.query(
        query_embeddings=[query_embedding],
        n_results=vector_n,
    )

    candidate_map: dict[str, dict[str, Any]] = {}

    vector_ids = vector_results["ids"][0]
    vector_docs = vector_results["documents"][0]
    vector_metas = vector_results["metadatas"][0]
    vector_distances = vector_results["distances"][0]

    for item_id, text, metadata, distance in zip(
        vector_ids, vector_docs, vector_metas, vector_distances
    ):
        candidate_map[item_id] = {
            "id": item_id,
            "document": metadata["document"],
            "page": metadata["page"],
            "snippet": text,
            "distance": float(distance),
            "vector_score": 1.0 / (1.0 + float(distance)),
            "bm25_score": 0.0,
        }

    query_tokens = tokenize(question)
    bm25_scores = bm25_index.get_scores(query_tokens)

    top_bm25_indexes = sorted(
        range(len(bm25_scores)),
        key=lambda index: bm25_scores[index],
        reverse=True,
    )[:vector_n]

    max_bm25 = max([float(bm25_scores[index]) for index in top_bm25_indexes] + [1.0])

    for index in top_bm25_indexes:
        item = bm25_items[index]
        item_id = item["id"]
        normalized_bm25 = float(bm25_scores[index]) / max_bm25

        if item_id not in candidate_map:
            candidate_map[item_id] = {
                "id": item_id,
                "document": item["document"],
                "page": item["page"],
                "snippet": item["snippet"],
                "distance": None,
                "vector_score": 0.0,
                "bm25_score": normalized_bm25,
            }
        else:
            candidate_map[item_id]["bm25_score"] = normalized_bm25

    ranked = []

    for candidate in candidate_map.values():
        hybrid_score = (
            0.70 * candidate["vector_score"]
            + 0.30 * candidate["bm25_score"]
        )

        ranked.append(
            {
                "id": candidate["id"],
                "document": candidate["document"],
                "page": candidate["page"],
                "snippet": candidate["snippet"],
                "distance": candidate["distance"],
                "bm25_score": candidate["bm25_score"],
                "hybrid_score": hybrid_score,
            }
        )

    ranked.sort(key=lambda item: item["hybrid_score"], reverse=True)

    return ranked[:n_results]


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

    PDF_DIR.mkdir(parents=True, exist_ok=True)
    destination = PDF_DIR / file.filename

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    rebuild_index()
    reload_indexes()

    return {
        "filename": file.filename,
        "message": "PDF uploaded and index rebuilt successfully.",
    }