from pathlib import Path
import json

import chromadb
from sentence_transformers import SentenceTransformer

from corpus import build_corpus


ROOT_DIR = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
CHROMA_DIR = ROOT_DIR / "data" / "chroma"

COLLECTION_NAME = "technical_papers"

def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    chunks, manifest = build_corpus()

    processed_path = PROCESSED_DIR / "chunks.json"
    processed_path.write_text(json.dumps(chunks, indent=2), encoding="utf-8")

    print(
        f"Saved {len(chunks)} chunks from {manifest['paper_count']} unique papers "
        f"to {processed_path}"
    )

    print("Loading embedding model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    print("Creating embeddings...")
    texts = [chunk["text"] for chunk in chunks]
    embeddings = model.encode(texts, show_progress_bar=True).tolist()

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    existing_collections = [collection.name for collection in client.list_collections()]
    if COLLECTION_NAME in existing_collections:
        client.delete_collection(COLLECTION_NAME)

    collection = client.create_collection(name=COLLECTION_NAME)

    collection.add(
        ids=[chunk["id"] for chunk in chunks],
        documents=[chunk["text"] for chunk in chunks],
        embeddings=embeddings,
        metadatas=[
            {
                "paper_id": chunk["paper_id"],
                "document": chunk["document"],
                "title": chunk["title"],
                "authors": "; ".join(chunk["authors"]),
                "year": chunk["year"],
                "page": chunk["page"],
                "section": chunk["section"],
                "pdf_url": chunk["pdf_url"],
                "source_url": chunk["source_url"] or "",
                "content_hash": chunk["content_hash"],
            }
            for chunk in chunks
        ],
    )

    print(f"Created Chroma collection: {COLLECTION_NAME}")
    print("Ingestion complete.")


if __name__ == "__main__":
    main()
