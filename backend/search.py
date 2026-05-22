from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer


ROOT_DIR = Path(__file__).resolve().parents[1]
CHROMA_DIR = ROOT_DIR / "data" / "chroma"
COLLECTION_NAME = "technical_papers"


def search_papers(query: str, n_results: int = 5) -> list[dict]:
    model = SentenceTransformer("all-MiniLM-L6-v2")
    query_embedding = model.encode([query]).tolist()[0]

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_collection(name=COLLECTION_NAME)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results,
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

    return output


def main() -> None:
    print("Technical Paper Search")
    print("Type a question, or type 'quit' to exit.")

    while True:
        query = input("\nQuestion: ").strip()

        if query.lower() in {"quit", "exit"}:
            break

        results = search_papers(query)

        print("\nTop results:")
        for index, result in enumerate(results, start=1):
            print("=" * 80)
            print(f"{index}. {result['document']} — page {result['page']}")
            print(f"Distance: {result['distance']:.4f}")
            print(result["snippet"][:900] + "...")


if __name__ == "__main__":
    main()