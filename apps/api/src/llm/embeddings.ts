const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

// Bounds a backend that accepts the connection and then never responds — see the matching
// note on LLM_CALL_TIMEOUT_MS in llm/index.ts for why this can't just rely on fetch() rejecting.
const EMBED_TIMEOUT_MS = 60_000;

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { embedding: number[] };
  return data.embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
