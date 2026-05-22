from pathlib import Path
import json
import re

import fitz  # PyMuPDF
import chromadb
from sentence_transformers import SentenceTransformer


ROOT_DIR = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT_DIR / "data" / "pdfs"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
CHROMA_DIR = ROOT_DIR / "data" / "chroma"

COLLECTION_NAME = "technical_papers"


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 150) -> list[str]:
    words = text.split()
    chunks = []

    if not words:
        return chunks

    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        chunks.append(chunk)

        if end >= len(words):
            break

        start = end - overlap

    return chunks


def extract_pdf_chunks() -> list[dict]:
    all_chunks = []

    pdf_files = sorted(PDF_DIR.glob("*.pdf"))

    if not pdf_files:
        raise FileNotFoundError(f"No PDFs found in {PDF_DIR}")

    for pdf_path in pdf_files:
        print(f"Reading: {pdf_path.name}")
        doc = fitz.open(pdf_path)

        for page_index, page in enumerate(doc):
            page_text = clean_text(page.get_text())

            if not page_text:
                continue

            chunks = chunk_text(page_text)

            for chunk_index, chunk in enumerate(chunks):
                all_chunks.append(
                    {
                        "id": f"{pdf_path.stem}-p{page_index + 1}-c{chunk_index + 1}",
                        "document": pdf_path.name,
                        "page": page_index + 1,
                        "text": chunk,
                    }
                )

    return all_chunks


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    chunks = extract_pdf_chunks()

    processed_path = PROCESSED_DIR / "chunks.json"
    processed_path.write_text(json.dumps(chunks, indent=2), encoding="utf-8")

    print(f"Saved {len(chunks)} chunks to {processed_path}")

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
                "document": chunk["document"],
                "page": chunk["page"],
            }
            for chunk in chunks
        ],
    )

    print(f"Created Chroma collection: {COLLECTION_NAME}")
    print("Ingestion complete.")


if __name__ == "__main__":
    main()