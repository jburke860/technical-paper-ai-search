from pathlib import Path
from typing import Any

import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer


ROOT_DIR = Path(__file__).resolve().parents[1]
CHROMA_DIR = ROOT_DIR / "data" / "chroma"
COLLECTION_NAME = "technical_papers"

app = FastAPI(
    title="Technical Paper AI Search API",
    description="Local semantic search API for public technical PDFs.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading embedding model...")
model = SentenceTransformer("all-MiniLM-L6-v2")

print("Connecting to Chroma...")
client = chromadb.PersistentClient(path=str(CHROMA_DIR))
collection = client.get_collection(name=COLLECTION_NAME)


class SearchRequest(BaseModel):
    question: str
    n_results: int = 5


class SearchResult(BaseModel):
    id: str
    document: str
    page: int
    snippet: str
    distance: float


class SearchResponse(BaseModel):
    question: str
    results: list[SearchResult]


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "Technical Paper AI Search API is running.",
    }


@app.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> dict[str, Any]:
    query_embedding = model.encode([request.question]).tolist()[0]

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=request.n_results,
    )

    output = []

    ids = results["ids"][0]
    documents = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    for item_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
        output.append(
            {
                "id": item_id,
                "document": metadata["document"],
                "page": metadata["page"],
                "snippet": text,
                "distance": distance,
            }
        )

    return {
        "question": request.question,
        "results": output,
    }