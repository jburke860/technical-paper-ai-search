// Local-only helper used once at launch time to embed the curated corpus
// with the exact production model. Run with `wrangler dev` (never deployed);
// the AI binding proxies through the wrangler login session.

type EmbedRequest = { texts: string[] };

type EmbeddingOutput = { data?: number[][] };

const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

export default {
  async fetch(request: Request, env: { AI: Ai }): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST a JSON body of { texts: string[] }.", { status: 405 });
    }
    const { texts } = (await request.json()) as EmbedRequest;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 25) {
      return new Response("texts must contain 1-25 strings.", { status: 422 });
    }
    const output = (await env.AI.run(EMBEDDING_MODEL, {
      text: texts,
      pooling: "cls",
    })) as EmbeddingOutput;
    return Response.json({ data: output.data ?? [] });
  },
};
